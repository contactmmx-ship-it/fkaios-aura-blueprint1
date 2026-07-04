// ORCHESTRATOR-UI — standalone real entry point into orchestrator-brain.
// Serves a self-contained HTML page (no build step, no Vercel ambiguity).
// Open directly at: https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/orchestrator-ui
//
// Built because the project has 13+ ambiguously-named Vercel deployments
// (fkaios, fkaios-live, fkaios-deploy, fkaios-original, fk-aios-aura-blueprint,
// fkaio-app, etc.) with no reliable way to identify which is production.
// Rather than guess and risk deploying to the wrong one, this page is served
// directly from Supabase — same place everything else already lives — giving
// a real, immediately-usable entry point with zero deployment risk.
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>FKAIOS — Ask the Orchestrator</title>
<style>
  :root { --bg:#0b0d12; --panel:#151821; --border:#262b38; --text:#e8eaf0; --muted:#8b92a5; --accent:#5b8cff; --green:#3ecf8e; --amber:#e6a23c; --red:#e05252; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
  .wrap { max-width:760px; margin:0 auto; padding:32px 20px 80px; }
  h1 { font-size:22px; font-weight:600; margin:0 0 4px; }
  .sub { color:var(--muted); font-size:14px; margin-bottom:28px; }
  textarea { width:100%; min-height:90px; background:var(--panel); border:1px solid var(--border); border-radius:12px; color:var(--text); padding:14px 16px; font-size:15px; resize:vertical; font-family:inherit; }
  textarea:focus { outline:none; border-color:var(--accent); }
  button { margin-top:12px; background:var(--accent); color:white; border:none; padding:12px 22px; border-radius:10px; font-size:14px; font-weight:600; cursor:pointer; }
  button:disabled { opacity:0.5; cursor:not-allowed; }
  .examples { display:flex; flex-wrap:wrap; gap:8px; margin:10px 0 24px; }
  .ex { font-size:12.5px; color:var(--muted); background:var(--panel); border:1px solid var(--border); padding:6px 12px; border-radius:20px; cursor:pointer; }
  .ex:hover { border-color:var(--accent); color:var(--text); }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:14px; padding:20px; margin-top:20px; display:none; }
  .row { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
  .badge { font-size:11.5px; padding:4px 10px; border-radius:20px; font-weight:600; letter-spacing:0.02em; }
  .b-dept { background:#1e2a4a; color:#7ea3ff; }
  .b-completed { background:#0f3a2a; color:var(--green); }
  .b-approval { background:#3a2e0f; color:var(--amber); }
  .b-failed { background:#3a1414; color:var(--red); }
  .response { white-space:pre-wrap; line-height:1.6; font-size:14.5px; }
  .meta { margin-top:16px; padding-top:14px; border-top:1px solid var(--border); font-size:12px; color:var(--muted); display:flex; gap:16px; flex-wrap:wrap; }
  .loading { color:var(--muted); font-size:14px; margin-top:16px; display:none; }
  .err { color:var(--red); font-size:14px; margin-top:16px; display:none; }
</style>
</head>
<body>
<div class="wrap">
  <h1>FKAIOS Orchestrator</h1>
  <div class="sub">Ask the system anything. It classifies, checks the Knowledge Vault, and either answers directly or files the action for your approval — it never executes money movement itself.</div>

  <textarea id="input" placeholder="e.g. What is our finance boundary rule? / Draft a follow-up for a franchise lead / Send Rs 30000 payment link to a vendor"></textarea>
  <div class="examples">
    <span class="ex">What is our finance boundary rule?</span>
    <span class="ex">Which departments are locked at autonomy level 4?</span>
    <span class="ex">Send a payment link for Rs 25000 to a vendor</span>
  </div>
  <br>
  <button id="ask">Ask Orchestrator</button>
  <div class="loading" id="loading">Thinking — classifying, checking the vault, planning…</div>
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
    const btn = document.getElementById('ask');
    const loading = document.getElementById('loading');
    const errEl = document.getElementById('err');
    const card = document.getElementById('card');
    btn.disabled = true; loading.style.display = 'block'; errEl.style.display = 'none'; card.style.display = 'none';

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: text, requested_by: 'founder_ui' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');

      const badges = document.getElementById('badges');
      badges.innerHTML = '';
      badges.innerHTML += '<span class="badge b-dept">' + (data.department || 'UNKNOWN') + '</span>';
      badges.innerHTML += '<span class="badge ' + (data.status === 'completed' ? 'b-completed' : data.status === 'awaiting_approval' ? 'b-approval' : 'b-failed') + '">' +
        (data.status === 'completed' ? '✓ Answered' : data.status === 'awaiting_approval' ? '⏳ Awaiting your approval' : data.status) + '</span>';

      document.getElementById('response').textContent = data.response || '(no response)';

      const meta = document.getElementById('meta');
      let metaParts = [];
      metaParts.push('Agent: ' + (data.agent || 'department default'));
      metaParts.push('Autonomy level: ' + data.autonomy_level);
      metaParts.push('Vault sources used: ' + data.vault_sources);
      if (data.approval_id) metaParts.push('Approval ID: ' + data.approval_id.slice(0, 8) + '…');
      meta.textContent = metaParts.join('  ·  ');

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
