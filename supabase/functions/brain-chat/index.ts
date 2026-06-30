import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Correlation-ID",
};

interface ChatRequest {
  message: string;
  conversationId: string;
  userId?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { message, conversationId, userId }: ChatRequest = await req.json();

    if (!message || !conversationId) {
      return new Response(JSON.stringify({ error: "Missing message or conversationId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Get last 10 messages for context
    const { data: history } = await supabase
      .from("brain_messages")
      .select("content, role, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(10);

    const contextMessages = (history || []).reverse().map((m: any) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    }));

    // 2. Fetch knowledge docs
    const { data: knowledgeDocs } = await supabase
      .from("brain_knowledge_documents")
      .select("title, content, brain_knowledge_folders(name)")
      .limit(5);

    let knowledgeContext = "";
    if (knowledgeDocs && knowledgeDocs.length > 0) {
      knowledgeContext = "\n\nRelevant knowledge:\n" +
        knowledgeDocs.map((d: any) => `- [${d.brain_knowledge_folders?.name || "General"}] ${d.title}: ${d.content?.substring(0, 200)}`).join("\n");
    }

    // 3. Fetch active agents
    const { data: agents } = await supabase
      .from("brain_agents")
      .select("name, role, capabilities, status")
      .eq("status", "active")
      .limit(5);

    let agentContext = "";
    if (agents && agents.length > 0) {
      agentContext = "\n\nActive agents:\n" +
        agents.map((a: any) => `- ${a.name} (${a.role}): ${a.capabilities?.substring(0, 100) || "General"}`).join("\n");
    }

    // 4. System prompt
    const systemPrompt = `You are the AI Brain — the central intelligence of FKAIO. You have access to the user's knowledge vault, active agents, and business context.
Capabilities: answer questions about business knowledge, provide strategic insights, help with decisions, assist with business planning.
${knowledgeContext}
${agentContext}
Guidelines: Be concise (2-4 paragraphs), reference specific documents/agents, provide actionable recommendations, professional but friendly tone.`;

    // 5. Call LLM
    const apiKey = Deno.env.get("AI_API_KEY") || Deno.env.get("OPENAI_API_KEY") || "";
    const aiModel = Deno.env.get("AI_MODEL") || "gpt-4o-mini";
    const aiBaseUrl = Deno.env.get("AI_BASE_URL") || "https://api.openai.com/v1";
    let aiResponse = "";

    if (!apiKey) {
      aiResponse = generateSmartFallback(message, knowledgeDocs, agents, history);
    } else {
      try {
        const response = await fetch(`${aiBaseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: aiModel, messages: [{ role: "system", content: systemPrompt }, ...contextMessages, { role: "user", content: message }], max_tokens: 1024, temperature: 0.7 }),
        });
        if (!response.ok) {
          console.error("AI API error:", await response.text());
          aiResponse = generateSmartFallback(message, knowledgeDocs, agents, history);
        } else {
          const data = await response.json();
          aiResponse = data.choices?.[0]?.message?.content || "I couldn't generate a response. Please try again.";
        }
      } catch {
        aiResponse = generateSmartFallback(message, knowledgeDocs, agents, history);
      }
    }

    // 6. Save messages (no user column in brain_messages)
    await supabase.from("brain_messages").insert({ conversation_id: conversationId, role: "user", content: message });
    const { data: savedAiMsg } = await supabase.from("brain_messages").insert({ conversation_id: conversationId, role: "assistant", content: aiResponse }).select().single();

    // 7. Update conversation
    await supabase.from("brain_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);

    return new Response(
      JSON.stringify({ content: aiResponse, messageId: savedAiMsg?.id || null, hasApiKey: !!apiKey }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Edge function error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function generateSmartFallback(message: string, knowledgeDocs: any[] | null, agents: any[] | null, history: any[] | null): string {
  const msg = message.toLowerCase();

  if (/^(hi|hello|hey|greetings)/i.test(msg)) {
    return `Hello! I'm your AI Brain assistant.\n\nI have access to:\n- **${knowledgeDocs?.length || 0} knowledge documents** in your vault\n- **${agents?.filter((a: any) => a.status === "active").length || 0} active agents**\n\nAsk me about your business, knowledge vault, agents, or strategy!`;
  }

  if (msg.includes("agent") || msg.includes("factory")) {
    return `Your Agent Factory has active agents:\n- **Research Agent** — Market research & analysis\n- **Content Agent** — Content creation & copywriting\n- **Analytics Agent** — Data analysis & insights\n- **Support Agent** — Customer support automation\n- **Sales Agent** — Lead qualification & outreach\n- **DevOps Agent** — Technical operations\n\nVisit Agent Factory to manage them.`;
  }

  if (msg.includes("knowledge") || msg.includes("vault") || msg.includes("document")) {
    return `Your Knowledge Vault contains:\n- **Market Research** — Industry trends, competitor analysis\n- **SOPs & Processes** — Standard operating procedures\n- **Client Materials** — Proposals, case studies\n- **Product Documentation** — Technical specs\n\nVisit Knowledge Vault to browse all documents.`;
  }

  if (msg.includes("decision") || msg.includes("strategy")) {
    return `For decisions, use the **Decision Engine** page for multi-dimensional analysis (Impact, Feasibility, Risk, Cost, Timeline, Alignment).\n\nYour vault has **${knowledgeDocs?.length || 0} documents** for reference.`;
  }

  if (msg.includes("business") || msg.includes("idea") || msg.includes("launch")) {
    return `The **Business Creator** tracks ideas through: Idea → Validating → Planning → Building → Launched.\n\nSubmit your ideas there for structured planning.`;
  }

  if (msg.includes("report") || msg.includes("staff") || msg.includes("chief")) {
    return `The **Chief of Staff** page shows all staff activity reports with performance metrics and brand-specific filtering.`;
  }

  if (msg.includes("learn") || msg.includes("insight") || msg.includes("improve")) {
    return `The **Self-Learning** module captures insights: Patterns, Optimizations, Feedback, Strategy, and Process improvements.`;
  }

  return `I understand: "${message.substring(0, 100)}"\n\nYour vault has **${knowledgeDocs?.length || 0} documents** and **${agents?.filter((a: any) => a.status === "active").length || 0} active agents**.\n\nConnect an LLM API key for full AI-powered responses.`;
}