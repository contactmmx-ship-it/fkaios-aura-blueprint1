// ORCHESTRATOR-UI v3 — surfaces real agent routing (orchestrator-brain v4).
// Shows WHICH agent handled the request as a badge with its task code, and a
// visible amber warning if the router had to fall back to the department's
// first agent (should be rare — if you see it often, routing needs tuning).
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>FKAIOS — Ask the Orchestrator</title>
<style>
  :root { --bg:#0b0d12; --panel:#151821; --border:#262b38; --text:#e8eaf0; --muted:#8b92a5; --accent:#5b8cff; --green:#3ecf8e; --amber:#e6a23c; --red:#e05252; --purple:#a78bfa; --teal:#2dd4bf; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
  .wrap { max-width:760px; margin:0 auto; padding:32px 20px 80px; }
  h1 { font-size:22px; font-weight:600; margin:0 0 4px; }
  .sub { color:var(--muted); font-size:14px; margin-bottom:28px; }
  textarea { width:100%; min-height:90px; background:var(--panel); border:1px solid var(--border); border-radius:12px; color:var(--text); padding:14px 16px; font-size:15px; resize:vertical; font-family:inherit; }
  textarea:focus { outline:none; border-color:var(--accent); }
  .row-buttons { display:flex; align-items:center; gap:14px; margin-top:12px; }
  button { background:var(--accent); color:white; border:none; padding:12px 22px; border-radius:10px; font-size:14px; font-weight:600; cursor:pointer; }
  button:disabled { opacity:0.5; cursor:not-allowed; }
  .toggle-label { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--muted); cursor:pointer; user-select:none; }
  .toggle-label input { accent-color:var(--accent); width:16px; height:16px; cursor:pointer; }
  .cost-note { font-size:11.5px; color:var(--muted); margin-top:4px; }
  .examples { display:flex; flex-wrap:wrap; gap:8px; margin:10px 0 24px; }
  .ex { font-size:12.5px; color:var(--muted); background:var(--panel); border:1px solid var(--border); padding:6px 12px; border-radius:20px; cursor:pointer; }
  .ex:hover { border-color:var(--accent); color:var(--text); }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:14px; padding:20px; margin-top:20px; display:none; }
  .row { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
  .badge { font-size:11.5px; padding:4px 10px; border-radius:20px; font-weight:600; letter-spacing:0.02em; }
  .b-dept { background:#1e2a4a; color:#7ea3ff; }
  .b-agent { background:#0f3535; color:var(--teal); }
  .b-completed { background:#0f3a2a; color:var(--green); }
  .b-approval { background:#3a2e0f; color:var(--amber); }
  .b-failed { background:#3a1414; color:var(--red); }
  .b-research { background:#2a1e4a; color:var(--purple); }
  .b-fallback { background:#3a2e0f; color:var(--amber); }
  .response { white-space:pre-wrap; line-height:1.6; font-size:14.5px; }
  .meta { margin-top:16px; padding-top:14px; border-top:1px solid var(--border); font-size:12px; color:var(--muted); display:flex; gap:16px; flex-wrap:wrap; }
  .loading { color:var(--muted); font-size:14px; margin-top:16px; display:none; }
  .err { color:var(--red); font-size:14px; margin-top:16px; display:none; }
</style>
</head>
<body>
<div class="wrap">
  <h1>FKAIOS Orchestrator</h1>
  <div class="sub">Ask the system anything. It classifies, routes to the best-fit department agent, checks the Knowledge Vault, optionally runs live research, and either answers directly or files the action for your approval — it never executes money movement itself.</div>

  <textarea id="input" placeholder="e.g. What is our finance boundary rule? / Draft a follow-up for a cold lead / Help me close a negotiating franchise deal"></textarea>
  <div class="examples">
    <span class="ex">What is our finance boundary rule?</span>
    <span class="ex">Draft a follow-up message for a lead who went cold</span>
    <span class="ex">Help me close a deal with a lead negotiating the franchise fee</span>
  </div>
  <div class="row-buttons">
    <button id="ask">Ask Orchestrator</button>
    <label class="toggle-label"><input type="checkbox" id="allowResearch" checked> Allow live research (spends real Apify credits if needed)</label>
  </div>
  <div class="cost-note">Research only runs when the request genuinely needs current external data — informational questions never trigger it.</div>

  <div class="loading" id="loading">Thinking — classifying, routing to an agent, checking the vault, planning…</div>
  <div class="err" id="err"></div>

  <div class="card" id="card">
    <div class="row" id="badges"></div>
    <div class="response" id="response"></div>
    <div class="meta" id="meta"></div>
  </div>
</div>

<script>
  const SECRET = 'kjhgfdsa';
  const ENDPOINT = 'https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/orchestrator-brain?secret=' + SECRET;

  document.querySelectorAll('.ex').forEach(el => {
    el.addEventListener('click', () => { document.getElementById('input').value = el.textContent; });
  });

  document.getElementById('ask').addEventListener('click', async () => {
    const text = document.getElementById('input').value.trim();
    if (!text) return;
    const allowResearch = document.getElementById('allowResearch').checked;
    const btn = document.getElementById('ask');
    const loading = document.getElementById('loading');
    const errEl = document.getElementById('err');
    const card = document.getElementById('card');
    btn.disabled = true; loading.style.display = 'block'; errEl.style.display = 'none'; card.style.display = 'none';

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: text, requested_by: 'founder_ui', allow_research: allowResearch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');

      const badges = document.getElementById('badges');
      badges.innerHTML = '';
      badges.innerHTML += '<span class="badge b-dept">' + (data.department || 'UNKNOWN') + '</span>';
      if (data.agent) {
        badges.innerHTML += '<span class="badge b-agent">\uD83E\uDD16 ' + data.agent + (data.agent_task ? ' \u00b7 ' + data.agent_task : '') + '</span>';
      }
      if (data.routing_method === 'fallback_first_agent') {
        badges.innerHTML += '<span class="badge b-fallback">\u26A0 routing fallback</span>';
      }
      badges.innerHTML += '<span class="badge ' + (data.status === 'completed' ? 'b-completed' : data.status === 'awaiting_approval' ? 'b-approval' : 'b-failed') + '">' +
        (data.status === 'completed' ? '\u2713 Answered' : data.status === 'awaiting_approval' ? '\u23F3 Awaiting your approval' : data.status) + '</span>';
      if (data.research_performed) {
        badges.innerHTML += '<span class="badge b-research">\uD83D\uDD0D Live research: ' + data.research_result_count + ' results</span>';
      }

      document.getElementById('response').textContent = data.response || '(no response)';

      const meta = document.getElementById('meta');
      let metaParts = [];
      metaParts.push('Autonomy level: ' + data.autonomy_level);
      metaParts.push('Vault sources: ' + data.vault_sources);
      if (data.research_performed) metaParts.push('Research run: ' + (data.research_run_id ? data.research_run_id.slice(0, 8) + '\u2026' : 'n/a'));
      if (data.approval_id) metaParts.push('Approval ID: ' + data.approval_id.slice(0, 8) + '\u2026');
      meta.textContent = metaParts.join('  \u00b7  ');

      card.style.display = 'block';
    } catch (e) {
      errEl.textContent = 'Error: ' + e.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false; loading.style.display = 'none';
    }
  });
</script>
</body>
</html>`;

Deno.serve((req) => {
  return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
});
