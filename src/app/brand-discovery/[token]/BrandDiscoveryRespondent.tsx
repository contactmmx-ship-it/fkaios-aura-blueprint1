"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Question = {
  id: string;
  number: number;
  prompt: string;
  type: "text" | "long_text" | "repeatable_list" | "file_or_text";
  required?: boolean;
  help_text?: string;
};
type Section = { id: string; title: string; questions: Question[] };
type Questionnaire = { sections: Section[]; question_count?: number; brand?: { name?: string } };
type AnswerRow = { question_id: string; answer: unknown };
type Session = {
  brand_name: string;
  brand_category: string;
  respondent_name?: string | null;
  status: string;
  current_section: number;
  current_question: number;
};
type ApiResult = {
  session?: Session;
  questionnaire?: Questionnaire;
  answers?: AnswerRow[];
  error?: string;
  message?: string;
  submitted?: boolean;
};

const endpoint = () => {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return base ? `${base.replace(/\/$/, "")}/functions/v1/brand-discovery-respondent` : "";
};

export default function BrandDiscoveryRespondent({ token }: { token: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [questionnaire, setQuestionnaire] = useState<Questionnaire | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sectionIndex, setSectionIndex] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [intro, setIntro] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [readyForAutosave, setReadyForAutosave] = useState(false);

  const api = useCallback(async (action: string, extra: Record<string, unknown> = {}): Promise<ApiResult> => {
    const url = endpoint();
    if (!url) throw new Error("This questionnaire link is not configured yet. Please contact Franchise Kart.");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ action, token, ...extra }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const messages: Record<string, string> = {
        invalid_resume_link: "This link is invalid. Please ask Franchise Kart for a fresh link.",
        resume_link_expired: "This questionnaire link has expired. Please contact Franchise Kart.",
        session_unavailable: "This questionnaire is no longer available.",
        questionnaire_not_ready: "The questionnaire is being prepared. Please try again later.",
        already_submitted: "This questionnaire has already been submitted.",
      };
      throw new Error(messages[data.error] ?? data.message ?? "We could not complete that step. Please try again.");
    }
    return data;
  }, [token]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api("get");
        if (!alive) return;
        const q = data.questionnaire;
        const s = data.session;
        if (!q?.sections?.length || !s) throw new Error("Questionnaire content is not available yet.");
        const restored: Record<string, string> = {};
        for (const row of data.answers ?? []) {
          restored[row.question_id] = typeof row.answer === "string" ? row.answer : JSON.stringify(row.answer ?? "");
        }
        setQuestionnaire(q);
        setSession(s);
        setAnswers(restored);
        setSectionIndex(Math.min(Math.max(s.current_section ?? 0, 0), q.sections.length - 1));
        const savedSection = q.sections[Math.min(Math.max(s.current_section ?? 0, 0), q.sections.length - 1)];
        setQuestionIndex(Math.min(Math.max(s.current_question ?? 0, 0), Math.max(savedSection.questions.length - 1, 0)));
        setSubmitted(s.status === "submitted");
        setIntro(!(Object.keys(restored).length > 0));
        setReadyForAutosave(true);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Unable to open this questionnaire.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [api]);

  const sections = questionnaire?.sections ?? [];
  const section = sections[sectionIndex];
  const question = section?.questions?.[questionIndex];
  const flatQuestions = useMemo(() => sections.flatMap((s) => s.questions), [sections]);
  const answeredCount = flatQuestions.filter((q) => (answers[q.id] ?? "").trim().length > 0).length;
  const progress = flatQuestions.length ? Math.round((answeredCount / flatQuestions.length) * 100) : 0;
  const currentAnswer = question ? answers[question.id] ?? "" : "";

  useEffect(() => {
    if (!readyForAutosave || loading || submitted || !question || !section || answers[question.id] === undefined) return;
    const timer = window.setTimeout(async () => {
      try {
        await api("save", {
          question_id: question.id,
          section_id: section.id,
          answer: answers[question.id],
          current_section: sectionIndex,
          current_question: questionIndex,
        });
        setNotice("Auto-saved securely.");
        setError("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Auto-save failed. Please use Save progress before leaving.");
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [answers, api, loading, question, questionIndex, readyForAutosave, section, sectionIndex, submitted]);

  const saveCurrent = useCallback(async (targetSection: number, targetQuestion: number) => {
    if (!question || !section) return;
    setSaving(true);
    setError("");
    try {
      const answer = answers[question.id] ?? "";
      await api("save", {
        question_id: question.id,
        section_id: section.id,
        answer,
        current_section: targetSection,
        current_question: targetQuestion,
      });
      setNotice("Saved securely. You can close this page and return using the same link.");
    } catch (e) {
      throw e;
    } finally {
      setSaving(false);
    }
  }, [api, answers, question, section]);

  const goNext = async () => {
    if (!question || !section) return;
    if (question.required !== false && !currentAnswer.trim()) {
      setError("Please add your answer before continuing. If you don't know the exact figure, an estimate is okay.");
      return;
    }
    const isLastQuestion = questionIndex >= section.questions.length - 1;
    const isLastSection = sectionIndex >= sections.length - 1;
    const nextSection = isLastQuestion ? Math.min(sectionIndex + 1, sections.length - 1) : sectionIndex;
    const nextQuestion = isLastQuestion ? 0 : questionIndex + 1;
    try {
      await saveCurrent(nextSection, nextQuestion);
      setError("");
      if (isLastQuestion) {
        setNotice("");
        setIntro(true);
        setSectionIndex(nextSection);
        setQuestionIndex(nextQuestion);
        if (isLastSection) setIntro(false);
      } else {
        setQuestionIndex(nextQuestion);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your answer.");
    }
  };

  const goBack = async () => {
    if (!section) return;
    try {
      await saveCurrent(sectionIndex, questionIndex);
      if (questionIndex > 0) setQuestionIndex(questionIndex - 1);
      else if (sectionIndex > 0) {
        const prev = sections[sectionIndex - 1];
        setSectionIndex(sectionIndex - 1);
        setQuestionIndex(prev.questions.length - 1);
        setIntro(false);
      }
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your answer.");
    }
  };

  const submit = async () => {
    if (!question || !section) return;
    if (question.required !== false && !currentAnswer.trim()) {
      setError("Please answer this required question before submitting.");
      return;
    }
    try {
      await saveCurrent(sectionIndex, questionIndex);
      setSaving(true);
      await api("submit");
      setSubmitted(true);
      setNotice("");
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit your questionnaire.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <main className="min-h-screen grid place-items-center bg-slate-950 p-6 text-slate-200"><p>Preparing your guided questionnaire…</p></main>;
  if (error && !questionnaire) return <main className="min-h-screen grid place-items-center bg-slate-950 p-6"><div className="max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 text-center"><p className="text-2xl font-semibold">Let’s get you connected</p><p className="mt-3 text-slate-300">{error}</p><button onClick={() => location.reload()} className="mt-6 rounded-xl bg-cyan-300 px-5 py-3 font-semibold text-slate-950">Try again</button></div></main>;
  if (submitted) return <main className="min-h-screen grid place-items-center bg-slate-950 p-6 text-white"><div className="max-w-xl rounded-3xl border border-emerald-300/20 bg-emerald-300/5 p-10 text-center"><div className="text-5xl">✓</div><h1 className="mt-5 text-3xl font-semibold">Thank you{session?.respondent_name ? `, ${session.respondent_name}` : ""}!</h1><p className="mt-4 text-lg text-slate-300">Your answers have been submitted successfully. Franchise Kart will review the information and contact you about the next steps.</p><p className="mt-5 text-sm text-slate-400">Your private Franchise Kart analysis and execution plan are not shown on this page.</p></div></main>;
  if (!questionnaire || !section || !question) return <main className="min-h-screen bg-slate-950 p-8 text-white">Questionnaire content is not available.</main>;

  const isLastQuestion = sectionIndex === sections.length - 1 && questionIndex === section.questions.length - 1;
  return <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-cyan-950 via-slate-950 to-slate-950 px-4 py-8 text-white sm:px-6">
    <div className="mx-auto max-w-3xl">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">Franchise Kart · Guided Discovery</p><h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{session?.brand_name ?? "Business"} Discovery</h1></div>
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-right"><p className="text-xs text-slate-400">Your progress</p><p className="text-xl font-semibold">{progress}%</p></div>
      </header>
      <div className="mb-6 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-cyan-300 transition-all duration-500" style={{ width: `${progress}%` }} /></div>
      <div className="mb-5 flex items-center justify-between text-sm text-slate-400"><span>Section {sectionIndex + 1} of {sections.length}</span><span>Question {questionIndex + 1} of {section.questions.length}</span></div>
      <section className="rounded-3xl border border-white/10 bg-slate-900/80 p-6 shadow-2xl shadow-cyan-950/20 sm:p-10">
        {intro ? <div className="py-6 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-cyan-300/10 text-3xl">✦</div>
          <p className="mt-6 text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">A small step toward clarity</p>
          <h2 className="mt-3 text-3xl font-semibold">{section.title}</h2>
          <p className="mx-auto mt-4 max-w-xl leading-7 text-slate-300">We’ll take this one question at a time. Share what you know; estimates are fine when exact figures aren’t available. Your progress is saved as you move through the questionnaire.</p>
          <button onClick={() => { setIntro(false); setError(""); }} className="mt-8 rounded-xl bg-cyan-300 px-7 py-3 font-semibold text-slate-950 transition hover:bg-cyan-200">Let’s begin <span aria-hidden="true">→</span></button>
        </div> : <>
          <p className="text-sm font-medium text-cyan-300">{section.title}</p>
          <h2 className="mt-4 text-2xl font-semibold leading-snug sm:text-3xl">{question.prompt}</h2>
          {question.help_text && <p className="mt-4 text-sm leading-6 text-slate-400">{question.help_text}</p>}
          <div className="mt-7">
            {question.type === "text" ? <input value={currentAnswer} onChange={(e) => setAnswers((a) => ({ ...a, [question.id]: e.target.value }))} placeholder="Type your answer here…" className="w-full rounded-2xl border border-white/15 bg-slate-950/70 px-4 py-4 text-base outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20" /> :
              <textarea value={currentAnswer} onChange={(e) => setAnswers((a) => ({ ...a, [question.id]: e.target.value }))} rows={question.type === "long_text" ? 6 : 5} placeholder={question.type === "repeatable_list" ? "Add one item per line…" : question.type === "file_or_text" ? "Paste the document link or describe the information here. File upload is not enabled yet." : "Type your answer here…"} className="w-full resize-y rounded-2xl border border-white/15 bg-slate-950/70 px-4 py-4 text-base leading-7 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20" />}
            <p className="mt-2 text-xs text-slate-500">{question.required === false ? "Optional question" : "Required · You can use Hindi, English, or Hinglish."}</p>
          </div>
          {error && <p role="alert" className="mt-5 rounded-xl border border-rose-300/20 bg-rose-300/5 px-4 py-3 text-sm text-rose-200">{error}</p>}
          {notice && <p aria-live="polite" className="mt-5 text-sm text-emerald-300">{notice}</p>}
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-6">
            <button onClick={goBack} disabled={saving || (sectionIndex === 0 && questionIndex === 0)} className="rounded-xl border border-white/15 px-5 py-3 font-medium text-slate-200 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30">← Back</button>
            <div className="flex flex-wrap gap-3">
              <button onClick={async () => { try { await saveCurrent(sectionIndex, questionIndex); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Save failed."); } }} disabled={saving} className="rounded-xl border border-cyan-300/40 px-5 py-3 font-medium text-cyan-200 transition hover:bg-cyan-300/10 disabled:opacity-50">{saving ? "Saving…" : "Save progress"}</button>
              {isLastQuestion ? <button onClick={submit} disabled={saving} className="rounded-xl bg-emerald-300 px-6 py-3 font-semibold text-slate-950 transition hover:bg-emerald-200 disabled:opacity-50">{saving ? "Submitting…" : "Submit answers ✓"}</button> : <button onClick={goNext} disabled={saving} className="rounded-xl bg-cyan-300 px-6 py-3 font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-50">Save & continue →</button>}
            </div>
          </div>
        </>}
      </section>
      <footer className="mt-6 flex flex-wrap justify-between gap-3 text-xs text-slate-500"><span>Private questionnaire · Secure link access</span><span>{answeredCount} of {flatQuestions.length} answers saved locally on this page</span></footer>
    </div>
  </main>;
}
