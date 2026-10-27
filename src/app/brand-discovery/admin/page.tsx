"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Submission = {
  id: string;
  brand_name: string;
  brand_category: string;
  respondent_name: string | null;
  respondent_email: string | null;
  submitted_at: string | null;
  updated_at: string;
};
type PrivateReport = {
  brand: string;
  category: string;
  generated_at: string;
  executive_summary: Record<string, unknown>;
  evidence_ledger: {
    owner_reported: Array<Record<string, unknown>>;
    independently_verified: Array<Record<string, unknown>>;
    hypotheses: Array<Record<string, unknown>>;
    unknowns: Array<Record<string, unknown>>;
    document_checklist: Array<Record<string, unknown>>;
  };
  diagnosis: { status: string; conclusions: unknown[]; guardrail: string };
  execution_plan: { status: string; actions: Array<Record<string, unknown>>; do_not_treat_as_approved_plan: boolean };
  disclaimer: string;
};
type ApiPayload = { sessions?: Submission[]; report?: PrivateReport; error?: string };

export default function BrandDiscoveryAdminPage() {
  const [sessions, setSessions] = useState<Submission[]>([]);
  const [selected, setSelected] = useState<Submission | null>(null);
  const [report, setReport] = useState<PrivateReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  const callApi = useCallback(async (payload: Record<string, unknown>): Promise<ApiPayload> => {
    const { data: authData, error: authError } = await supabase.auth.getSession();
    if (authError) throw authError;
    const token = authData.session?.access_token;
    if (!token) {
      setSignedIn(false);
      throw new Error("Please sign in using the existing Franchise Kart account login, then reopen this page.");
    }
    setSignedIn(true);
    const { data, error: invokeError } = await supabase.functions.invoke("brand-discovery-private-report", {
      body: payload,
      headers: { Authorization: `Bearer ${token}` },
    });
    if (invokeError) throw new Error(invokeError.message || "Private report service could not be reached.");
    if (data?.error) throw new Error(String(data.error));
    return data as ApiPayload;
  }, []);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await callApi({ action: "list" });
      setSessions(data.sessions ?? []);
      setNotice(`Loaded ${data.sessions?.length ?? 0} submitted questionnaire(s).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load submissions.");
    } finally {
      setLoading(false);
    }
  }, [callApi]);

  const openReport = async (session: Submission) => {
    setSelected(session);
    setReport(null);
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const data = await callApi({ action: "get_report", session_id: session.id });
      if (!data.report) throw new Error("The report response was empty.");
      setReport(data.report);
      setNotice("Private evidence report generated. Owner statements are not treated as verified facts.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate the private report.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-cyan-300">Franchise Kart · Internal workspace</p>
            <h1 className="mt-2 text-3xl font-semibold">Brand Discovery Reports</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Staff-only view of submitted questionnaires, evidence gaps and draft follow-up actions. The backend independently checks staff access; hiding this page is not the security control.</p>
          </div>
          <button onClick={() => void loadSessions()} disabled={loading} className="rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold hover:bg-white/5 disabled:opacity-50">{loading ? "Loading…" : "Refresh submissions"}</button>
        </header>

        {signedIn === false && <div className="mt-6 rounded-xl border border-amber-300/30 bg-amber-300/10 p-4 text-amber-100">Sign-in is required. Use the existing FK account login. Only email addresses configured in the server-side staff allowlist can open reports.</div>}
        {error && <div role="alert" className="mt-6 rounded-xl border border-rose-300/30 bg-rose-300/10 p-4 text-rose-100">{error}</div>}
        {notice && <div aria-live="polite" className="mt-6 rounded-xl border border-emerald-300/20 bg-emerald-300/5 p-4 text-sm text-emerald-100">{notice}</div>}

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.5fr)]">
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="text-lg font-semibold">Submitted questionnaires</h2>
            <p className="mt-1 text-xs text-slate-500">Only submitted sessions are listed.</p>
            <div className="mt-4 space-y-3">
              {sessions.length === 0 && <p className="rounded-xl border border-dashed border-white/15 p-4 text-sm text-slate-400">No submitted questionnaires found, or the service is not configured.</p>}
              {sessions.map((session) => <button key={session.id} onClick={() => void openReport(session)} className={`w-full rounded-xl border p-4 text-left transition ${selected?.id === session.id ? "border-cyan-300/50 bg-cyan-300/10" : "border-white/10 bg-slate-900/70 hover:bg-white/5"}`}>
                <span className="block font-semibold">{session.brand_name}</span>
                <span className="mt-1 block text-sm text-slate-400">{session.respondent_name || "Respondent not named"} · {session.brand_category}</span>
                <span className="mt-2 block text-xs text-slate-500">{session.submitted_at ? new Date(session.submitted_at).toLocaleString() : "Submission date unavailable"}</span>
                <span className="mt-2 block break-all text-[11px] text-slate-600">ID: {session.id}</span>
              </button>)}
            </div>
          </section>

          <section className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            {!report && <div className="grid min-h-64 place-items-center text-center"><div><div className="text-4xl">◈</div><h2 className="mt-3 text-xl font-semibold">Private report</h2><p className="mt-2 max-w-md text-sm leading-6 text-slate-400">Choose a submitted questionnaire to generate an evidence-first report. No paid AI is used by this report generator.</p></div></div>}
            {report && <div className="space-y-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-cyan-300">Internal · Do not share with respondent</p>
                <h2 className="mt-2 text-2xl font-semibold">{report.brand} — Evidence Review</h2>
                <p className="mt-1 text-sm text-slate-400">Generated {new Date(report.generated_at).toLocaleString()} · {report.category}</p>
              </div>
              <div className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-4">
                <h3 className="font-semibold text-amber-100">Interpretation guardrail</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{report.diagnosis.guardrail}</p>
                <p className="mt-2 text-xs text-slate-500">{report.disclaimer}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric label="Owner-reported answers" value={report.evidence_ledger.owner_reported.length} />
                <Metric label="Required unknowns" value={report.evidence_ledger.unknowns.length} />
                <Metric label="Verified findings" value={report.evidence_ledger.independently_verified.length} />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Owner-reported information</h3>
                <p className="mt-1 text-xs text-slate-500">Each answer remains unverified until FK checks it against evidence.</p>
                <div className="mt-3 space-y-3">
                  {report.evidence_ledger.owner_reported.map((item, index) => <article key={String(item.question_id ?? index)} className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
                    <p className="text-xs text-cyan-300">Q{String(item.question_number ?? "—")} · {String(item.section ?? "")}</p>
                    <h4 className="mt-2 font-medium">{String(item.question ?? "")}</h4>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{String(item.answer || "No answer text")}</p>
                    <p className="mt-2 text-[11px] uppercase tracking-wide text-amber-200">Owner reported · Not verified</p>
                  </article>)}
                  {report.evidence_ledger.owner_reported.length === 0 && <p className="text-sm text-slate-400">No owner answers were found.</p>}
                </div>
              </div>
              <div>
                <h3 className="text-lg font-semibold">Missing required responses</h3>
                <div className="mt-3 space-y-2">{report.evidence_ledger.unknowns.map((item, index) => <div key={String(item.question_id ?? index)} className="rounded-lg border border-white/10 p-3"><p className="text-sm font-medium">{String(item.question ?? item.question_id ?? "")}</p><p className="mt-1 text-xs text-amber-200">Missing response</p></div>)}{report.evidence_ledger.unknowns.length === 0 && <p className="text-sm text-slate-400">No required response gaps were detected by this basic check.</p>}</div>
              </div>
              <div>
                <h3 className="text-lg font-semibold">Document checklist</h3>
                <div className="mt-3 space-y-2">{report.evidence_ledger.document_checklist.map((item, index) => <div key={String(item.item ?? index)} className="flex flex-wrap justify-between gap-2 rounded-lg border border-white/10 p-3"><span className="text-sm">{String(item.item ?? "")}</span><span className="text-xs text-amber-200">Not provided / verified</span></div>)}</div>
              </div>
              <div>
                <h3 className="text-lg font-semibold">Draft evidence-gathering actions</h3>
                <p className="mt-1 text-xs text-slate-500">These are not a brand-specific diagnosis or an approved execution plan.</p>
                <div className="mt-3 space-y-3">{report.execution_plan.actions.map((action, index) => <article key={index} className="rounded-xl border border-white/10 p-4"><p className="text-xs text-cyan-300">Priority {String(action.priority ?? index + 1)}</p><p className="mt-2 font-medium">{String(action.action ?? "")}</p><p className="mt-2 text-sm text-slate-400">Owner: {String(action.owner ?? "Unassigned")}</p><p className="mt-1 text-sm text-slate-400">Timing: {String(action.timing ?? "Unspecified")}</p><p className="mt-2 text-sm leading-6 text-slate-300">Verify: {String(action.verification ?? "")}</p></article>)}</div>
              </div>
            </div>}
          </section>
        </div>
        <footer className="mt-8 border-t border-white/10 pt-4 text-xs text-slate-500">Private staff workspace · Keep owner-reported claims, verified evidence, hypotheses and unknowns separate. Human review is required before recommendations.</footer>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs text-slate-400">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p></div>;
}
