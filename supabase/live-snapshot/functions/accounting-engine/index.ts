import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALLOWED_CATEGORIES = [
  "salary",
  "rent",
  "marketing",
  "franchise_fee",
  "royalty",
  "utilities",
  "supplies",
  "travel",
  "food",
  "misc",
] as const;

type Category = (typeof ALLOWED_CATEGORIES)[number];

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    },
  });
}

function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

/** Parse a single CSV row respecting basic quoting. */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

/** Try to detect and normalise a date string into YYYY-MM-DD. */
function parseDate(raw: string): string | null {
  const cleaned = raw.trim();

  // Try ISO-like: 2024-03-15
  const iso = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }

  // Try DD/MM/YYYY or DD-MM-YYYY
  const dmy = cleaned.match(
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/
  );
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }

  // Try MM/DD/YYYY (US format)
  const mdy = cleaned.match(
    /^(\d{1,2})[\/](\d{1,2})[\/](\d{4})$/
  );
  if (mdy) {
    const m = parseInt(mdy[1], 10);
    const d = parseInt(mdy[2], 10);
    if (m > 12) {
      // It's actually DD/MM/YYYY
      return `${mdy[3]}-${mdy[2].padStart(2, "0")}-${mdy[1].padStart(2, "0")}`;
    }
    return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  }

  // Try DD Mon YYYY (e.g. "15 Mar 2024")
  const mon = cleaned.match(
    /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})$/i
  );
  if (mon) {
    const months: Record<string, string> = {
      jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    };
    const mm = months[mon[2].toLowerCase().slice(0, 3)];
    if (mm) return `${mon[3]}-${mm}-${mon[1].padStart(2, "0")}`;
  }

  // Try Mon DD, YYYY
  const mon2 = cleaned.match(
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2}),?\s+(\d{4})$/i
  );
  if (mon2) {
    const months: Record<string, string> = {
      jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    };
    const mm = months[mon2[1].toLowerCase().slice(0, 3)];
    if (mm) return `${mon2[3]}-${mm}-${mon2[2].padStart(2, "0")}`;
  }

  return null;
}

/** Parse a numeric amount string, handling brackets for negatives, commas, etc. */
function parseAmount(raw: string): number | null {
  let cleaned = raw.trim();

  // Indian / European number formatting: 1,23,456.00 or 1.23.456,00
  // Detect if comma is decimal separator (e.g. "1.234,56")
  if (cleaned.includes(",") && !cleaned.includes(".")) {
    cleaned = cleaned.replace(/,/g, "");
  } else if (cleaned.includes(",") && cleaned.includes(".")) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    if (lastComma > lastDot) {
      // Comma is the decimal separator: 1.234,56
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      // Dot is the decimal separator: 1,234.56
      cleaned = cleaned.replace(/,/g, "");
    }
  }

  // Handle parentheses for negative amounts: (123.45) = -123.45
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    cleaned = "-" + cleaned.slice(1, -1);
  }

  // Handle Dr/Cr suffixes
  if (/\d\s*Cr$/i.test(cleaned)) {
    cleaned = cleaned.replace(/\s*Cr$/i, "");
  } else if (/\d\s*Dr$/i.test(cleaned)) {
    cleaned = "-" + cleaned.replace(/\s*Dr$/i, "");
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/** Determine transaction type from amount or explicit field. */
function inferTransactionType(
  amount: number,
  explicitType?: string
): "credit" | "debit" {
  if (explicitType) {
    const t = explicitType.toLowerCase().trim();
    if (t === "credit" || t === "cr" || t === "income" || t === "deposit") {
      return "credit";
    }
    return "debit";
  }
  return amount >= 0 ? "credit" : "debit";
}

// ---------------------------------------------------------------------------
// Route: parse-statement
// ---------------------------------------------------------------------------

async function handleParseStatement(body: Record<string, unknown>) {
  const { bank_statement_id } = body as { bank_statement_id: string };

  if (!bank_statement_id) {
    return errorResponse("bank_statement_id is required");
  }

  // Fetch the bank statement record
  const { data: statement, error: stmtErr } = await supabase
    .from("bank_statements")
    .select("id, financial_account_id, file_type, storage_path, brand_id")
    .eq("id", bank_statement_id)
    .single();

  if (stmtErr || !statement) {
    return errorResponse("Bank statement not found", 404);
  }

  if (statement.file_type !== "csv") {
    return errorResponse("Only CSV parsing is currently supported", 400);
  }

  if (!statement.storage_path) {
    return errorResponse("Bank statement has no storage_path", 400);
  }

  // Fetch the file from Supabase Storage
  const { data: fileData, error: fileErr } = await supabase.storage
    .from("bank-statements")
    .download(statement.storage_path);

  if (fileErr || !fileData) {
    // Try alternate bucket name
    const { data: altFileData, error: altFileErr } = await supabase.storage
      .from("documents")
      .download(statement.storage_path);

    if (altFileErr || !altFileData) {
      return errorResponse("Failed to download file from storage", 500);
    }
    var fileText = await altFileData.text();
  } else {
    var fileText = await fileData.text();
  }

  // Update status to importing
  await supabase
    .from("bank_statements")
    .update({ status: "importing" })
    .eq("id", bank_statement_id);

  const lines = fileText.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    await supabase
      .from("bank_statements")
      .update({
        status: "failed",
        error_message: "File is empty",
      })
      .eq("id", bank_statement_id);
    return errorResponse("File is empty");
  }

  // Detect header row
  let headerIndex = 0;
  const firstLine = lines[0].toLowerCase();
  if (
    firstLine.includes("date") ||
    firstLine.includes("description") ||
    firstLine.includes("amount") ||
    firstLine.includes("narration") ||
    firstLine.includes("particular")
  ) {
    headerIndex = 1;
  }

  // Parse header to find column positions
  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());

  const dateIdx = headers.findIndex((h) =>
    h.includes("date") || h.includes("txn date") || h.includes("trans date")
  );
  const descIdx = headers.findIndex(
    (h) =>
      h.includes("desc") ||
      h.includes("narration") ||
      h.includes("particular") ||
      h.includes("details") ||
      h.includes("remark")
  );
  const amountIdx = headers.findIndex(
    (h) =>
      h.includes("amount") ||
      h.includes("debit") ||
      h.includes("credit") ||
      h.includes("withdrawal") ||
      h.includes("deposit")
  );
  const typeIdx = headers.findIndex(
    (h) => h.includes("type") || h.includes("dr") || h.includes("cr")
  );
  const refIdx = headers.findIndex(
    (h) => h.includes("ref") || h.includes("cheque") || h.includes("transaction ref")
  );

  // If header detection failed, assume positional: date, description, amount
  const usePositional =
    dateIdx === -1 && descIdx === -1 && amountIdx === -1;

  let imported = 0;
  let duplicates = 0;
  const errors: string[] = [];
  const transactions: Record<string, unknown>[] = [];

  for (let i = headerIndex; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);

    let rawDate: string;
    let description: string;
    let rawAmount: string;
    let explicitType: string | undefined;
    let reference: string | undefined;

    if (usePositional) {
      if (cols.length < 3) {
        errors.push(`Row ${i + 1}: insufficient columns`);
        continue;
      }
      rawDate = cols[0];
      description = cols[1];
      rawAmount = cols[2];
      if (cols.length > 3 && cols[3]) explicitType = cols[3];
      if (cols.length > 4 && cols[4]) reference = cols[4];
    } else {
      if (cols.length < 3) {
        errors.push(`Row ${i + 1}: insufficient columns`);
        continue;
      }
      rawDate = cols[dateIdx >= 0 ? dateIdx : 0] || "";
      description = cols[descIdx >= 0 ? descIdx : 1] || "";
      rawAmount = cols[amountIdx >= 0 ? amountIdx : 2] || "";
      if (typeIdx >= 0 && cols[typeIdx]) explicitType = cols[typeIdx];
      if (refIdx >= 0 && cols[refIdx]) reference = cols[refIdx];
    }

    // Some banks split debit/credit into separate columns
    // If the amount column looks like a header, try to find credit/debit columns
    if (
      rawAmount.toLowerCase().includes("amount") ||
      rawAmount.toLowerCase().includes("debit") ||
      rawAmount.toLowerCase() === "" ||
      rawAmount === "Cr" ||
      rawAmount === "Dr"
    ) {
      const debitIdx = headers.findIndex((h) =>
        h.includes("debit") || h.includes("withdrawal")
      );
      const creditIdx = headers.findIndex((h) =>
        h.includes("credit") || h.includes("deposit")
      );
      if (debitIdx >= 0 && creditIdx >= 0) {
        const debitVal = cols[debitIdx] || "";
        const creditVal = cols[creditIdx] || "";
        if (debitVal && debitVal !== "Debit" && debitVal !== "Dr") {
          rawAmount = "-" + debitVal;
          explicitType = "debit";
        } else if (creditVal && creditVal !== "Credit" && creditVal !== "Cr") {
          rawAmount = creditVal;
          explicitType = "credit";
        } else {
          errors.push(`Row ${i + 1}: could not parse amount`);
          continue;
        }
      } else {
        // Skip this row (likely a sub-header)
        continue;
      }
    }

    const parsedDate = parseDate(rawDate);
    if (!parsedDate) {
      errors.push(`Row ${i + 1}: could not parse date "${rawDate}"`);
      continue;
    }

    const amount = parseAmount(rawAmount);
    if (amount === null) {
      errors.push(`Row ${i + 1}: could not parse amount "${rawAmount}"`);
      continue;
    }

    if (amount === 0) {
      errors.push(`Row ${i + 1}: zero amount, skipping`);
      continue;
    }

    const transactionType = inferTransactionType(amount, explicitType);
    const absAmount = Math.abs(amount);

    // Check for duplicate: same date + amount + description hash
    const descHash = await crypto.subtle
      .digest(
        "SHA-256",
        new TextEncoder().encode(description.toLowerCase().trim())
      )
      .then((buf) =>
        Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
      );

    const { data: existing, error: dupErr } = await supabase
      .from("transactions")
      .select("id")
      .eq("financial_account_id", statement.financial_account_id)
      .eq("transaction_date", parsedDate)
      .eq("amount", absAmount)
      .limit(1);

    if (dupErr) {
      errors.push(`Row ${i + 1}: duplicate check failed`);
      continue;
    }

    if (existing && existing.length > 0) {
      duplicates++;
      continue;
    }

    transactions.push({
      financial_account_id: statement.financial_account_id,
      transaction_date: parsedDate,
      description: description.trim(),
      amount: absAmount,
      transaction_type: transactionType,
      reference_number: reference?.trim() || null,
      brand_id: statement.brand_id,
      source: "csv_import",
      raw_data: {
        row: i + 1,
        original_date: rawDate,
        original_amount: rawAmount,
        original_type: explicitType || null,
      },
    });
  }

  // Batch insert transactions (up to 500 at a time)
  const BATCH_SIZE = 500;
  for (let b = 0; b < transactions.length; b += BATCH_SIZE) {
    const batch = transactions.slice(b, b + BATCH_SIZE);
    const { error: insertErr } = await supabase
      .from("transactions")
      .insert(batch);

    if (insertErr) {
      errors.push(`Batch ${Math.floor(b / BATCH_SIZE) + 1}: ${insertErr.message}`);
    } else {
      imported += batch.length;
    }
  }

  // Update bank statement record
  const finalStatus = errors.length > 0 && imported === 0 ? "failed" : "completed";
  await supabase
    .from("bank_statements")
    .update({
      status: finalStatus,
      row_count: lines.length - headerIndex,
      imported_count: imported,
      duplicate_count: duplicates,
      error_message: errors.length > 0 ? errors.join("; ") : null,
    })
    .eq("id", bank_statement_id);

  return jsonResponse({
    imported,
    duplicates,
    errors,
  });
}

// ---------------------------------------------------------------------------
// Route: classify
// ---------------------------------------------------------------------------

async function handleClassify(body: Record<string, unknown>) {
  const { brand_id, limit } = body as {
    brand_id?: string;
    limit?: number;
  };

  const fetchLimit = limit || 50;

  // Build query for unclassified transactions
  let query = supabase
    .from("transactions")
    .select("id, description, amount, transaction_type")
    .is("category", null)
    .order("created_at", { ascending: false })
    .limit(fetchLimit);

  if (brand_id) {
    query = query.eq("brand_id", brand_id);
  }

  const { data: transactions, error: fetchErr } = await query;

  if (fetchErr) {
    return errorResponse(`Failed to fetch transactions: ${fetchErr.message}`, 500);
  }

  if (!transactions || transactions.length === 0) {
    return jsonResponse({ classified: 0, failed: 0, message: "No unclassified transactions found" });
  }

  // Batch classify using OpenAI
  const batchSize = 20;
  let classified = 0;
  let failed = 0;

  for (let b = 0; b < transactions.length; b += batchSize) {
    const batch = transactions.slice(b, b + batchSize);

    const prompt = `You are a financial transaction classifier for a franchise business. Classify each transaction into exactly one of these categories: ${ALLOWED_CATEGORIES.join(", ")}.

Respond ONLY with a JSON array of objects, each with "id" (UUID string) and "category" (string). No explanation, no markdown fences.

Transactions:
${JSON.stringify(
  batch.map((t) => ({
    id: t.id,
    description: t.description,
    amount: t.amount,
    type: t.transaction_type,
  })),
  null,
  0
)}`;

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0,
          max_tokens: 2000,
          messages: [
            {
              role: "system",
              content:
                "You classify financial transactions. Return only valid JSON arrays with id and category fields. Categories must be one of: " +
                ALLOWED_CATEGORIES.join(", "),
            },
            { role: "user", content: prompt },
          ],
        }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        console.error(`OpenAI API error: ${response.status} ${errBody}`);
        failed += batch.length;
        continue;
      }

      const result = await response.json();
      const content = result.choices?.[0]?.message?.content?.trim() || "";

      // Parse the response - handle markdown code fences
      let jsonStr = content;
      const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim();
      }

      const classifications: Array<{ id: string; category: string }> =
        JSON.parse(jsonStr);

      if (!Array.isArray(classifications)) {
        failed += batch.length;
        continue;
      }

      // Update each transaction's category
      for (const cls of classifications) {
        if (!cls.id || !cls.category) continue;

        const validCategory = ALLOWED_CATEGORIES.includes(
          cls.category as Category
        );
        if (!validCategory) {
          failed++;
          continue;
        }

        const { error: updateErr } = await supabase
          .from("transactions")
          .update({
            category: cls.category,
            source: "ai_classified",
            metadata: { classified_at: new Date().toISOString() },
          })
          .eq("id", cls.id);

        if (updateErr) {
          failed++;
        } else {
          classified++;
        }
      }
    } catch (err) {
      console.error("Classification error:", err);
      failed += batch.length;
    }
  }

  return jsonResponse({ classified, failed });
}

// ---------------------------------------------------------------------------
// Route: reconcile
// ---------------------------------------------------------------------------

async function handleReconcile(body: Record<string, unknown>) {
  const { brand_id, rules: ruleNames } = body as {
    brand_id?: string;
    rules?: string[];
  };

  // Fetch active reconciliation rules
  let rulesQuery = supabase
    .from("reconciliation_rules")
    .select("*")
    .eq("is_active", true)
    .order("priority", { ascending: false });

  if (ruleNames && ruleNames.length > 0) {
    rulesQuery = rulesQuery.in("name", ruleNames);
  }

  const { data: rules, error: rulesErr } = await rulesQuery;

  if (rulesErr) {
    return errorResponse(`Failed to fetch rules: ${rulesErr.message}`, 500);
  }

  if (!rules || rules.length === 0) {
    return jsonResponse({ matched: 0, unmatched: 0, message: "No active reconciliation rules found" });
  }

  // Fetch un-reconciled transactions
  let txnQuery = supabase
    .from("transactions")
    .select(
      "id, transaction_date, description, amount, transaction_type, brand_id, invoice_id, lead_id, financial_account_id"
    )
    .eq("is_reconciled", false)
    .order("transaction_date", { ascending: true })
    .limit(500);

  if (brand_id) {
    txnQuery = txnQuery.eq("brand_id", brand_id);
  }

  const { data: transactions, error: txnErr } = await txnQuery;

  if (txnErr) {
    return errorResponse(`Failed to fetch transactions: ${txnErr.message}`, 500);
  }

  if (!transactions || transactions.length === 0) {
    return jsonResponse({ matched: 0, unmatched: 0, message: "No un-reconciled transactions found" });
  }

  let matched = 0;
  let unmatched = 0;

  for (const rule of rules) {
    const conditions = rule.conditions as {
      amount_tolerance?: number;
      description_keywords?: string[];
      match_on?: string[];
      date_range_days?: number;
    };

    const amountTolerance = conditions.amount_tolerance || 0;
    const keywords = conditions.description_keywords || [];
    const matchOn = conditions.match_on || ["amount", "date", "description"];

    for (const txn of transactions) {
      // Skip already matched in this run
      const { data: alreadyMatched } = await supabase
        .from("transactions")
        .select("id")
        .eq("id", txn.id)
        .eq("is_reconciled", true)
        .single();

      if (alreadyMatched) continue;

      // Try to find matching invoice
      let matchedEntity = null;
      let matchedEntityId = null;

      if (matchOn.includes("amount") || matchOn.includes("date") || matchOn.includes("description")) {
        // Look for matching invoices
        let invoiceQuery = supabase
          .from("invoices")
          .select("id, total_amount, due_date, invoice_number, brand_id")
          .eq("brand_id", txn.brand_id);

        if (matchOn.includes("amount")) {
          invoiceQuery = invoiceQuery.gte(
            "total_amount",
            txn.amount - amountTolerance
          );
          invoiceQuery = invoiceQuery.lte(
            "total_amount",
            txn.amount + amountTolerance
          );
        }

        if (matchOn.includes("date") && conditions.date_range_days) {
          const minDate = new Date(txn.transaction_date);
          minDate.setDate(minDate.getDate() - conditions.date_range_days);
          const maxDate = new Date(txn.transaction_date);
          maxDate.setDate(maxDate.getDate() + conditions.date_range_days);
          invoiceQuery = invoiceQuery.gte("due_date", minDate.toISOString().split("T")[0]);
          invoiceQuery = invoiceQuery.lte("due_date", maxDate.toISOString().split("T")[0]);
        }

        const { data: invoices } = await invoiceQuery.limit(5);

        if (invoices && invoices.length > 0) {
          // If description keywords are specified, try to match
          if (keywords.length > 0) {
            const descLower = txn.description.toLowerCase();
            for (const inv of invoices) {
              const invText = [
                inv.invoice_number || "",
                inv.id || "",
              ]
                .join(" ")
                .toLowerCase();
              const keywordMatch = keywords.some((kw) =>
                descLower.includes(kw.toLowerCase()) || invText.includes(kw.toLowerCase())
              );
              if (keywordMatch) {
                matchedEntity = "invoice";
                matchedEntityId = inv.id;
                break;
              }
            }
            // If no keyword match but we have exact amount match and only 1 result
            if (!matchedEntityId && invoices.length === 1 && matchOn.includes("amount") && matchOn.includes("date")) {
              matchedEntity = "invoice";
              matchedEntityId = invoices[0].id;
            }
          } else {
            // No keywords: if only one match and amount matches closely
            if (invoices.length === 1 && matchOn.includes("amount")) {
              matchedEntity = "invoice";
              matchedEntityId = invoices[0].id;
            }
          }
        }
      }

      if (matchedEntityId) {
        // Find a matching counterpart transaction (e.g., if this is debit, find the credit for the same invoice)
        const { data: counterpart } = await supabase
          .from("transactions")
          .select("id")
          .eq("invoice_id", matchedEntityId)
          .neq("id", txn.id)
          .eq("is_reconciled", false)
          .limit(1);

        const { error: updateErr } = await supabase
          .from("transactions")
          .update({
            is_reconciled: true,
            reconciled_with: counterpart?.[0]?.id || null,
            invoice_id: matchedEntityId,
            metadata: {
              reconciled_via: rule.name,
              reconciled_at: new Date().toISOString(),
              rule_id: rule.id,
            },
          })
          .eq("id", txn.id);

        if (!updateErr) {
          // Also reconcile the counterpart
          if (counterpart?.[0]?.id) {
            await supabase
              .from("transactions")
              .update({
                is_reconciled: true,
                reconciled_with: txn.id,
                metadata: {
                  reconciled_via: rule.name,
                  reconciled_at: new Date().toISOString(),
                  rule_id: rule.id,
                  counterpart_reconciliation: true,
                },
              })
              .eq("id", counterpart[0].id);
          }
          matched++;
        } else {
          unmatched++;
        }
      } else {
        unmatched++;
      }
    }
  }

  return jsonResponse({ matched, unmatched });
}

// ---------------------------------------------------------------------------
// Route: revenue-snapshot
// ---------------------------------------------------------------------------

async function handleRevenueSnapshot(body: Record<string, unknown>) {
  const { brand_id, period_start, period_end } = body as {
    brand_id: string;
    period_start: string;
    period_end: string;
  };

  if (!brand_id || !period_start || !period_end) {
    return errorResponse("brand_id, period_start, and period_end are required");
  }

  // Validate dates
  const startDate = new Date(period_start);
  const endDate = new Date(period_end);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return errorResponse("Invalid date format. Use YYYY-MM-DD");
  }

  if (startDate >= endDate) {
    return errorResponse("period_start must be before period_end");
  }

  // Fetch all transactions in the period for the brand
  const { data: transactions, error: txnErr } = await supabase
    .from("transactions")
    .select("id, amount, transaction_type, category")
    .eq("brand_id", brand_id)
    .gte("transaction_date", period_start)
    .lte("transaction_date", period_end);

  if (txnErr) {
    return errorResponse(`Failed to fetch transactions: ${txnErr.message}`, 500);
  }

  // Calculate totals
  let totalRevenue = 0;
  let totalExpenses = 0;
  let franchiseFeesCollected = 0;
  let royaltiesCollected = 0;

  const categoryBreakdown: Record<string, number> = {};
  const monthlyBreakdown: Record<string, { revenue: number; expenses: number }> = {};

  for (const txn of transactions || []) {
    const monthKey = txn.id
      ? ""
      : "";
    // Use transaction_date for month key - we need to fetch it
    if (txn.transaction_type === "credit") {
      totalRevenue += Number(txn.amount);
    } else {
      totalExpenses += Number(txn.amount);
    }

    const cat = txn.category || "uncategorized";
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + Number(txn.amount);

    if (txn.category === "franchise_fee" && txn.transaction_type === "credit") {
      franchiseFeesCollected += Number(txn.amount);
    }
    if (txn.category === "royalty" && txn.transaction_type === "credit") {
      royaltiesCollected += Number(txn.amount);
    }
  }

  // Get monthly breakdown
  const { data: monthlyTxns } = await supabase
    .from("transactions")
    .select("transaction_date, amount, transaction_type")
    .eq("brand_id", brand_id)
    .gte("transaction_date", period_start)
    .lte("transaction_date", period_end);

  for (const txn of monthlyTxns || []) {
    const monthKey = txn.transaction_date!.slice(0, 7); // YYYY-MM
    if (!monthlyBreakdown[monthKey]) {
      monthlyBreakdown[monthKey] = { revenue: 0, expenses: 0 };
    }
    if (txn.transaction_type === "credit") {
      monthlyBreakdown[monthKey].revenue += Number(txn.amount);
    } else {
      monthlyBreakdown[monthKey].expenses += Number(txn.amount);
    }
  }

  // Count franchisee metrics
  const periodStart = period_start;
  const periodEnd = period_end;

  const { count: newFranchisees } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("brand_id", brand_id)
    .gte("created_at", periodStart)
    .lte("created_at", periodEnd)
    .eq("status", "converted");

  const { count: activeFranchisees } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("brand_id", brand_id)
    .eq("status", "converted");

  // Determine snapshot type based on period length
  const daysDiff =
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
  let snapshotType: "monthly" | "quarterly" | "yearly" = "monthly";
  if (daysDiff > 180) {
    snapshotType = "yearly";
  } else if (daysDiff > 60) {
    snapshotType = "quarterly";
  }

  const netProfit = totalRevenue - totalExpenses;

  const snapshotData = {
    category_breakdown: categoryBreakdown,
    monthly_breakdown: monthlyBreakdown,
    transaction_count: (transactions || []).length,
  };

  // Upsert the snapshot (handle unique constraint)
  const { data: existing, error: existingErr } = await supabase
    .from("revenue_snapshots")
    .select("id")
    .eq("brand_id", brand_id)
    .eq("period_start", period_start)
    .eq("snapshot_type", snapshotType)
    .single();

  let result;
  if (existing) {
    // Update existing snapshot
    const { data, error } = await supabase
      .from("revenue_snapshots")
      .update({
        period_end,
        total_revenue: totalRevenue,
        total_expenses: totalExpenses,
        net_profit: netProfit,
        franchise_fees_collected: franchiseFeesCollected,
        royalties_collected: royaltiesCollected,
        new_franchisees: newFranchisees || 0,
        active_franchisees: activeFranchisees || 0,
        churned_franchisees: 0,
        data: snapshotData,
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (error) {
      return errorResponse(`Failed to update snapshot: ${error.message}`, 500);
    }
    result = data;
  } else {
    // Insert new snapshot
    const { data, error } = await supabase
      .from("revenue_snapshots")
      .insert({
        brand_id,
        period_start,
        period_end,
        total_revenue: totalRevenue,
        total_expenses: totalExpenses,
        net_profit: netProfit,
        franchise_fees_collected: franchiseFeesCollected,
        royalties_collected: royaltiesCollected,
        new_franchisees: newFranchisees || 0,
        active_franchisees: activeFranchisees || 0,
        churned_franchisees: 0,
        data: snapshotData,
        snapshot_type: snapshotType,
      })
      .select()
      .single();

    if (error) {
      return errorResponse(`Failed to create snapshot: ${error.message}`, 500);
    }
    result = data;
  }

  return jsonResponse({
    snapshot: result,
    summary: {
      total_revenue: totalRevenue,
      total_expenses: totalExpenses,
      net_profit: netProfit,
      franchise_fees_collected: franchiseFeesCollected,
      royalties_collected: royaltiesCollected,
      new_franchisees: newFranchisees || 0,
      active_franchisees: activeFranchisees || 0,
    },
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed. Use POST.", 405);
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/functions\/v1\/accounting-engine\/?/, "");

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  try {
    switch (path) {
      case "parse-statement":
        return await handleParseStatement(body);
      case "classify":
        return await handleClassify(body);
      case "reconcile":
        return await handleReconcile(body);
      case "revenue-snapshot":
        return await handleRevenueSnapshot(body);
      default:
        return errorResponse(
          `Unknown route: ${path}. Valid routes: parse-statement, classify, reconcile, revenue-snapshot`,
          404
        );
    }
  } catch (err) {
    console.error("Accounting engine error:", err);
    return errorResponse(
      `Internal server error: ${err instanceof Error ? err.message : "Unknown error"}`,
      500
    );
  }
});