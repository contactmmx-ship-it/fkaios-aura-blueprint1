// project-review-engine v1 — real review of uploaded project deliverables
// (CRM code, app code, docs). Honest about what it can and can't actually
// inspect: text-based files (code, markdown, json, html, css, config) get a
// real Claude review of their actual content. Binary/zip/archive files
// cannot be parsed by this function — it says so plainly rather than
// fabricating a review of contents it never read.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Correlation-ID' };
function cid(): string { return crypto.randomUUID().slice(0, 8); }
function errRes(m: string, s: number, id?: string): Response { return new Response(JSON.stringify({ error: m, correlationId: id }), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
function okRes(d: unknown, id?: string): Response { return new Response(JSON.stringify({ ...(d as Record<string, unknown>), correlationId: id }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
async function verifyJWT(authHeader: string | null, supabaseUrl: string): Promise<{ userId: string } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  try {
    const parts = token.split('.'); if (parts.length !== 3) return null;
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
    if (payload.iss !== `${supabaseUrl}/auth/v1`) return null;
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return { userId: payload.sub as string };
  } catch { return null; }
}

const TEXT_EXTENSIONS = ['.txt', '.md', '.json', '.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.py', '.sql', '.yaml', '.yml', '.env.example', '.gitignore', '.csv'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const id = cid();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const authHeader = req.headers.get('Authorization');
  const db = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: authHeader ? { Authorization: authHeader } : {} } });

  try {
    const user = await verifyJWT(authHeader, supabaseUrl);
    if (!user) return errRes('Unauthorized', 401, id);
    if (req.method !== 'POST') return errRes('Method not allowed', 405, id);

    const body = await req.json() as { action?: string; submission_id?: string };
    if (body.action !== 'review') return errRes(`Unknown action: ${body.action}`, 400, id);
    if (!body.submission_id) return errRes('submission_id is required', 400, id);

    const { data: sub, error: subErr } = await db.from('project_submissions').select('*').eq('id', body.submission_id).single();
    if (subErr || !sub) return errRes('Submission not found', 404, id);

    await db.from('project_submissions').update({ ai_review_status: 'reviewing' }).eq('id', body.submission_id);

    const isTextFile = TEXT_EXTENSIONS.some((ext) => sub.file_name.toLowerCase().endsWith(ext));
    const isArchive = /\.(zip|tar|gz|rar|7z)$/i.test(sub.file_name);

    let summary: string;
    let findings: Record<string, unknown>;

    if (isArchive) {
      summary = `"${sub.file_name}" is an archive file. This function cannot parse zip/archive contents — it has NOT inspected what's inside. Manual review is required, or re-upload the specific files you want AI-reviewed individually (code files, docs) rather than zipped.`;
      findings = { file_type: 'archive', contents_inspected: false, reason: 'Archive extraction is not implemented in this reviewer.' };
    } else if (isTextFile) {
      const { data: fileData, error: dlErr } = await db.storage.from('project-submissions').download(sub.file_path);
      if (dlErr || !fileData) {
        summary = `Could not download the file for review: ${dlErr?.message ?? 'unknown error'}.`;
        findings = { file_type: 'text', contents_inspected: false, error: dlErr?.message };
      } else {
        const content = (await fileData.text()).slice(0, 15000);
        const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
        if (!apiKey) {
          summary = 'ANTHROPIC_API_KEY not configured — cannot generate a real review.';
          findings = { file_type: 'text', contents_inspected: false, error: 'no API key' };
        } else {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({
              model: 'claude-sonnet-4-6', max_tokens: 1200,
              system: `You are reviewing a real submitted project file ("${sub.title}", type: ${sub.submission_type}) for a founder. Read the actual content given. Respond with ONLY valid JSON: {"summary": string (3-5 sentences, what this file actually does/contains), "quality_notes": string, "concerns": string[] (real issues you see in the actual code/content, empty array if none), "looks_complete": boolean}`,
              messages: [{ role: 'user', content: `Filename: ${sub.file_name}\n\nContent:\n${content}` }],
            }),
          });
          if (!res.ok) {
            summary = `Review failed: ${(await res.text()).slice(0, 300)}`;
            findings = { file_type: 'text', contents_inspected: false };
          } else {
            const data = await res.json() as any;
            const text = (data.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text || '').join('\n');
            const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
            try {
              const parsed = JSON.parse(cleaned);
              summary = parsed.summary;
              findings = { file_type: 'text', contents_inspected: true, ...parsed };
            } catch {
              summary = text.slice(0, 500);
              findings = { file_type: 'text', contents_inspected: true, raw: true };
            }
          }
        }
      }
    } else {
      summary = `"${sub.file_name}" is a binary/non-text file type this reviewer doesn't parse (e.g. image, PDF, compiled binary). Logged for manual review — not AI-reviewed.`;
      findings = { file_type: 'binary', contents_inspected: false };
    }

    await db.from('project_submissions').update({ ai_review_status: 'reviewed', ai_review_summary: summary, ai_review_findings: findings, reviewed_at: new Date().toISOString() }).eq('id', body.submission_id);

    await db.from('founder_notifications').insert({
      type: 'project_review', title: `Review ready: ${sub.title}`, detail: summary.slice(0, 300),
      department_code: 'EXECUTIVE', related_id: body.submission_id,
    });

    return okRes({ submission_id: body.submission_id, ai_review_status: 'reviewed', summary, findings }, id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return errRes(msg, 500, id);
  }
});
