"use client";

import { supabaseKey, supabaseUrl } from "@/lib/supabase";
import { useCallback, useEffect, useMemo, useState } from "react";

type Question = {
  id: string;
  number: number;
  prompt: string;
  type: "text" | "long_text" | "repeatable_list" | "file_or_text" | "multiple_choice" | "multi_part";
  required?: boolean;
  help_text?: string;
  options?: Array<{ value: string; label: string }>;
  selection_mode?: "single" | "multiple";
  max_selections?: number;
  optional_explanation?: boolean;
  explanation_prompt?: string;
  selection_instruction?: string;
  source_block?: string;
  parts?: Array<{ id: string; label: string; instruction: string; selection_mode: "single" | "multiple"; max_selections?: number; options: Array<{ value: string; label: string }> }>;
};
type Section = { id: string; title: string; intro?: string; why_it_matters?: string; questions: Question[] };
type Questionnaire = { sections: Section[]; question_count?: number; brand?: { name?: string }; document_checklist?: Array<{ id: string; label: string; required?: boolean; status_options: string[] }>; confidentiality_and_acknowledgement?: string };
type AnswerRow = { question_id: string; answer: unknown };
type Closure = { documents: Record<string, string>; owner_date: string; owner_signature: string; acknowledged: boolean };
const localDate = () => { const now = new Date(); return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0"); };
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

function parseChoiceAnswer(raw: string): { choices: string[]; explanation: string } {
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === "object") {
      const choices = Array.isArray(value.choices) ? value.choices.filter((v: unknown) => typeof v === "string") :
        typeof value.choice === "string" ? [value.choice] : [];
      return { choices, explanation: typeof value.explanation === "string" ? value.explanation : "" };
    }
  } catch { /* legacy/plain-text answer */ }
  return { choices: [], explanation: "" };
}
function encodeChoiceAnswer(choices: string[], explanation: string) {
  return JSON.stringify({ choices, explanation });
}
function parsePartAnswer(raw: string): Record<string, string[]> {
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === "object" && value.parts && typeof value.parts === "object") {
      return Object.fromEntries(Object.entries(value.parts).map(([key, part]: [string, any]) => [
        key, Array.isArray(part?.choices) ? part.choices.filter((v: unknown) => typeof v === "string") : [],
      ]));
    }
  } catch { /* no saved multipart answer */ }
  return {};
}
function encodePartAnswer(parts: Record<string, string[]>) {
  return JSON.stringify({ parts: Object.fromEntries(Object.entries(parts).map(([id, choices]) => [id, { choices }])) });
}
function hasAnswer(question: Question, raw: string) {
  if (question.type === "multiple_choice") return parseChoiceAnswer(raw).choices.length > 0;
  if (question.type === "multi_part") {
    const saved = parsePartAnswer(raw);
    return Boolean(question.parts?.length) && question.parts!.every((part) => (saved[part.id] ?? []).length > 0);
  }
  return raw.trim().length > 0;
}

const endpoint = () => `${supabaseUrl.replace(/\/$/, "")}/functions/v1/brand-discovery-respondent`;

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
  const [closing, setClosing] = useState(false);
  const [closure, setClosure] = useState<Closure>({ documents: {}, owner_date: "", owner_signature: "", acknowledged: false });
  const [readyForAutosave, setReadyForAutosave] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");

  const api = useCallback(async (action: string, extra: Record<string, unknown> = {}): Promise<ApiResult> => {
    const url = endpoint();
    if (!url) throw new Error("This questionnaire link is not configured yet. Please contact Franchise Kart.");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
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
        if (restored.__closure__) {
          try {
            const savedClosure = JSON.parse(restored.__closure__);
            if (savedClosure && typeof savedClosure === "object") {
              setClosure({
                documents: savedClosure.documents && typeof savedClosure.documents === "object" ? savedClosure.documents : {},
                owner_date: typeof savedClosure.owner_date === "string" ? savedClosure.owner_date : localDate(),
                owner_signature: typeof savedClosure.owner_signature === "string" ? savedClosure.owner_signature : "",
                acknowledged: savedClosure.acknowledged === true,
              });
              setClosing(true);
            }
          } catch { /* ignore an invalid draft and allow the respondent to continue */ }
        } else setClosure((previous) => ({ ...previous, owner_date: localDate() }));
        setSectionIndex(Math.min(Math.max(s.current_section ?? 0, 0), q.sections.length - 1));
        const savedSection = q.sections[Math.min(Math.max(s.current_section ?? 0, 0), q.sections.length - 1)];
        setQuestionIndex(Math.min(Math.max(s.current_question ?? 0, 0), Math.max(savedSection.questions.length - 1, 0)));
        setSubmitted(s.status === "submitted");
        setIntro(!(Object.keys(restored).length > 0));
        setResumed(Object.keys(restored).length > 0 && s.status !== "submitted");
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
  const answeredCount = flatQuestions.filter((q) => hasAnswer(q, answers[q.id] ?? "")).length;
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

  useEffect(() => {
    if (!closing || loading || submitted || !questionnaire) return;
    const timer = window.setTimeout(async () => {
      try {
        await api("save_closure", { closure });
        setNotice("Checklist and acknowledgement saved securely.");
        setError("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save the checklist.");
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [api, closure, closing, loading, questionnaire, submitted]);

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
    if (question.required !== false && !hasAnswer(question, currentAnswer)) {
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
    const targetSection = questionIndex > 0 ? sectionIndex : Math.max(sectionIndex - 1, 0);
    const targetQuestion = questionIndex > 0
      ? questionIndex - 1
      : sectionIndex > 0
        ? Math.max((sections[sectionIndex - 1]?.questions.length ?? 1) - 1, 0)
        : 0;
    try {
      // Persist the current answer while moving the stored resume pointer to
      // the question the respondent will actually see after navigating back.
      await saveCurrent(targetSection, targetQuestion);
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

  const repeatCurrentQuestion = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !question) {
      setVoiceStatus("Voice playback is not supported in this browser.");
      return;
    }
    window.speechSynthesis.cancel();
    const text = intro
      ? (section?.title ?? "Next section") + ". " + (section?.intro ?? "This section helps us understand this part of your business and why it matters for the transformation plan.")
      : question.prompt + ". " + (question.selection_instruction ?? "") + " " + (question.parts?.map((part) => part.label + ". " + part.instruction).join(". ") ?? "");
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "hi-IN";
    utterance.rate = 0.92;
    window.speechSynthesis.speak(utterance);
    setVoiceStatus("Reading aloud. Use your browser/device volume controls.");
  };

  const listenForVoiceCommand = () => {
    const browser = window as Window & {
      SpeechRecognition?: new () => any;
      webkitSpeechRecognition?: new () => any;
    };
    const Recognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceStatus("Voice commands are not supported in this browser. You can use the on-screen controls.");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "hi-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    setVoiceStatus("Listening. Say: repeat, previous, next, or stop.");
    recognition.onresult = (event: any) => {
      const transcript = String(event.results?.[0]?.[0]?.transcript ?? "").toLowerCase();
      if (/repeat|again|dobara|phir se|suniye|sunao/.test(transcript)) repeatCurrentQuestion();
      else if (/previous|back|pichla|peeche|wapas|पिछला|पीछे/.test(transcript)) void goBack();
      else if (/next|continue|agla|aage|आगे|अगला/.test(transcript)) void goNext();
      else if (/stop|band|रुको|बंद/.test(transcript)) {
        window.speechSynthesis?.cancel();
        setVoiceStatus("Voice playback stopped.");
      } else setVoiceStatus(`I heard “${transcript}”. Please use the on-screen controls or try again.`);
    };
    recognition.onerror = () => setVoiceStatus("I couldn't hear that clearly. Please try again or use the on-screen controls.");
    recognition.onend = () => {};
    recognition.start();
  };

  const beginClosure = async () => {
    if (!question || !section) return;
    if (question.required !== false && !hasAnswer(question, currentAnswer)) {
      setError("Please answer this required question before continuing.");
      return;
    }
    try {
      await saveCurrent(sectionIndex, questionIndex);
      setError("");
      setNotice("");
      setClosing(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your answer.");
    }
  };

  const submit = async () => {
    const checklist = questionnaire?.document_checklist ?? [];
    const missingDocuments = checklist.filter((item) => !closure.documents[item.id]);
    if (missingDocuments.length) {
      setError("Please mark the availability of all 20 supporting documents or records before submitting.");
      return;
    }
    if (!closure.owner_date || !/^\\d{4}-\\d{2}-\\d{2}$/.test(closure.owner_date)) {
      setError("Please enter the acknowledgement date.");
      return;
    }
    if (closure.owner_signature.trim().length < 2) {
      setError("Please type the owner's name in the signature field to acknowledge the submission.");
      return;
    }
    if (!closure.acknowledged) {
      setError("Please confirm the acknowledgement before submitting.");
      return;
    }
    try {
      await api("save_closure", { closure });
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

  if (closing) {
    const checklist = questionnaire.document_checklist ?? [];
    const declarationText = (questionnaire.confidentiality_and_acknowledgement ?? "").replace(/^## /m, "").replace(/\\*\\*/g, "");
    return <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-cyan-950 via-slate-950 to-slate-950 px-4 py-8 text-white sm:px-6">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">Franchise Kart · Final review</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{session?.brand_name ?? "Business"} Discovery</h1>
          <p className="mt-3 text-slate-300">Final step: confirm which records are available and acknowledge your responses. You can return to edit your answers before submitting.</p>
        </header>
        <section className="rounded-3xl border border-white/10 bg-slate-900/80 p-5 shadow-2xl shadow-cyan-950/20 sm:p-8">
          <h2 className="text-2xl font-semibold">Supporting Documents and Records</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">Please mark each item honestly. This records availability only; it does not upload documents. Share sensitive records with Franchise Kart through an agreed secure channel.</p>
          <div className="mt-6 space-y-4">
            {checklist.map((item, index) => <fieldset key={item.id} className="rounded-2xl border border-white/10 p-4">
              <legend className="px-2 text-sm font-medium text-slate-100">{index + 1}. {item.label}</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {item.status_options.map((status) => <label key={status} className={"flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-3 text-sm " + (closure.documents[item.id] === status ? "border-cyan-300 bg-cyan-300/10" : "border-white/10 bg-slate-950/40")}>
                  <input type="radio" name={item.id} value={status} checked={closure.documents[item.id] === status} onChange={() => setClosure((old) => ({ ...old, documents: { ...old.documents, [item.id]: status } }))} className="mt-1 accent-cyan-300" />
                  <span>{status}</span>
                </label>)}
              </div>
            </fieldset>)}
          </div>
          <div className="mt-8 rounded-2xl border border-white/10 bg-slate-950/40 p-5">
            <h2 className="text-xl font-semibold">Confidentiality and Acknowledgement</h2>
            <p className="mt-4 whitespace-pre-line text-sm leading-7 text-slate-300">{declarationText}</p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm text-slate-300">Owner
                <input value={session?.respondent_name ?? "Mr. Chitwan"} readOnly className="mt-2 w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3 text-white" />
              </label>
              <label className="block text-sm text-slate-300">Date
                <input type="date" value={closure.owner_date} onChange={(e) => setClosure((old) => ({ ...old, owner_date: e.target.value }))} className="mt-2 w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3 text-white" />
              </label>
              <label className="block text-sm text-slate-300 sm:col-span-2">Owner signature / type your full name to acknowledge
                <input value={closure.owner_signature} onChange={(e) => setClosure((old) => ({ ...old, owner_signature: e.target.value }))} maxLength={200} autoComplete="name" placeholder="Type your full name" className="mt-2 w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3 text-white" />
              </label>
              <div className="sm:col-span-2 rounded-xl border border-white/10 p-4">
                <p className="text-sm font-medium">For Franchise Kart</p>
                <p className="mt-1 text-sm text-slate-400">Internal sign-off field — completed by Franchise Kart after receipt; it is not for the owner to fill in.</p>
              </div>
            </div>
            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-cyan-300/20 bg-cyan-300/5 p-4">
              <input type="checkbox" checked={closure.acknowledged} onChange={(e) => setClosure((old) => ({ ...old, acknowledged: e.target.checked }))} className="mt-1 accent-cyan-300" />
              <span className="text-sm leading-6 text-slate-200">I confirm that I have reviewed my responses and the document-availability selections, and I acknowledge the confidentiality statement above.</span>
            </label>
          </div>
          {error && <p role="alert" className="mt-5 rounded-xl border border-rose-300/20 bg-rose-300/5 px-4 py-3 text-sm text-rose-200">{error}</p>}
          {notice && <p aria-live="polite" className="mt-5 text-sm text-emerald-300">{notice}</p>}
          <div className="mt-8 flex flex-wrap justify-between gap-3 border-t border-white/10 pt-6">
            <button onClick={() => { setClosing(false); setError(""); setNotice(""); }} disabled={saving} className="rounded-xl border border-white/15 px-5 py-3 font-medium text-slate-200 hover:bg-white/5 disabled:opacity-50">← Back to questions</button>
            <button onClick={submit} disabled={saving} className="rounded-xl bg-emerald-300 px-6 py-3 font-semibold text-slate-950 hover:bg-emerald-200 disabled:opacity-50">{saving ? "Submitting…" : "Submit completed questionnaire ✓"}</button>
          </div>
          <p className="mt-4 text-xs text-slate-500">The private Franchise Kart analysis and execution plan are not shown to the owner.</p>
        </section>
      </div>
    </main>;
  }

  const isLastQuestion = sectionIndex === sections.length - 1 && questionIndex === section.questions.length - 1;
  return <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-cyan-950 via-slate-950 to-slate-950 px-4 py-8 text-white sm:px-6">
    <div className="mx-auto max-w-3xl">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">Franchise Kart · Guided Discovery</p><h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{session?.brand_name ?? "Business"} Discovery</h1></div>
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-right"><p className="text-xs text-slate-400">Your progress</p><p className="text-xl font-semibold">{progress}%</p></div>
      </header>
      {resumed && <div className="mb-4 rounded-xl border border-cyan-300/20 bg-cyan-300/5 px-4 py-3 text-sm text-cyan-100" role="status">Welcome back. Your saved answers and last position have been restored.</div>}
      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" onClick={repeatCurrentQuestion} className="rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-200 hover:bg-white/5">🔊 Read aloud</button>
        <button type="button" onClick={listenForVoiceCommand} className="rounded-lg border border-cyan-300/30 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-300/10">🎙 Voice command</button>
        {voiceStatus && <span className="self-center text-xs text-slate-400" aria-live="polite">{voiceStatus}</span>}
      </div>
      <div className="mb-6 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-cyan-300 transition-all duration-500" style={{ width: `${progress}%` }} /></div>
      <div className="mb-5 flex items-center justify-between text-sm text-slate-400"><span>Section {sectionIndex + 1} of {sections.length}</span><span>Question {questionIndex + 1} of {section.questions.length}</span></div>
      <section className="rounded-3xl border border-white/10 bg-slate-900/80 p-6 shadow-2xl shadow-cyan-950/20 sm:p-10">
        {intro ? <div className="py-6 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-cyan-300/10 text-3xl">✦</div>
          <p className="mt-6 text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">A small step toward clarity</p>
          <h2 className="mt-3 text-3xl font-semibold">{section.title}</h2>
          <p className="mx-auto mt-4 max-w-xl leading-7 text-slate-300">{section.intro ?? "We’ll take this one question at a time. Share what you know; estimates are fine when exact figures aren’t available. Your progress is saved as you move through the questionnaire."}</p><p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-400">{section.why_it_matters ?? "Your answers help Franchise Kart understand the current reality before making recommendations. We will distinguish what you report from information that still needs evidence or verification."}</p>
          <button onClick={() => { setIntro(false); setError(""); }} className="mt-8 rounded-xl bg-cyan-300 px-7 py-3 font-semibold text-slate-950 transition hover:bg-cyan-200">Let’s begin <span aria-hidden="true">→</span></button>
        </div> : <>
          <p className="text-sm font-medium text-cyan-300">{section.title}</p>
          <h2 className="mt-4 text-2xl font-semibold leading-snug sm:text-3xl">{question.prompt}</h2>
          {question.help_text && <p className="mt-4 text-sm leading-6 text-slate-400">{question.help_text}</p>}
          <div className="mt-7">
            {question.type === "multi_part" ? <div className="space-y-6">
              {(question.parts ?? []).map((part) => {
                const saved = parsePartAnswer(currentAnswer);
                const selectedChoices = saved[part.id] ?? [];
                return <fieldset key={part.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 sm:p-5">
                  <legend className="px-2 text-base font-semibold text-cyan-100">{part.label}</legend>
                  <p className="mb-3 text-xs text-slate-400">{part.instruction}</p>
                  <div className="space-y-2">
                    {part.options.map((option) => {
                      const selected = selectedChoices.includes(option.value);
                      const inputType = part.selection_mode === "multiple" ? "checkbox" : "radio";
                      return <label key={option.value} className={"flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 transition " + (selected ? "border-cyan-300 bg-cyan-300/10" : "border-white/15 bg-slate-950/50 hover:bg-white/5")}>
                        <input type={inputType} name={question.id + "-" + part.id} value={option.value} checked={selected} onChange={() => setAnswers((a) => {
                          const all = parsePartAnswer(a[question.id] ?? "");
                          let next = all[part.id] ?? [];
                          if (part.selection_mode === "multiple") {
                            next = selected ? next.filter((v) => v !== option.value) : [...next, option.value];
                            if (part.max_selections && next.length > part.max_selections) return a;
                          } else next = [option.value];
                          return { ...a, [question.id]: encodePartAnswer({ ...all, [part.id]: next }) };
                        })} className="mt-1 accent-cyan-300" />
                        <span>{option.label}</span>
                      </label>;
                    })}
                  </div>
                </fieldset>;
              })}
            </div> : question.type === "multiple_choice" ? <div className="space-y-3">
              <p className="text-xs text-slate-400">{question.selection_mode === "multiple" ? (question.max_selections ? `Select up to ${question.max_selections}.` : "Select all that apply.") : "Select one."}</p>
              {(!question.options || question.options.length === 0) ? <p role="alert" className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-100">This choice question has no reviewed options yet. Please contact Franchise Kart rather than guessing an answer.</p> : question.options.map((option) => {
                const parsed = parseChoiceAnswer(currentAnswer);
                const selected = parsed.choices.includes(option.value);
                const inputType = question.selection_mode === "multiple" ? "checkbox" : "radio";
                const changeChoice = () => setAnswers((a) => {
                  const previous = parseChoiceAnswer(a[question.id] ?? "");
                  let choices = previous.choices;
                  if (question.selection_mode === "multiple") {
                    choices = selected ? choices.filter((v) => v !== option.value) : [...choices, option.value];
                    if (question.max_selections && choices.length > question.max_selections) return a;
                  } else choices = [option.value];
                  return { ...a, [question.id]: encodeChoiceAnswer(choices, previous.explanation) };
                });
                return <label key={option.value} className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-4 transition ${selected ? "border-cyan-300 bg-cyan-300/10" : "border-white/15 bg-slate-950/50 hover:bg-white/5"}`}>
                  <input type={inputType} name={question.id} value={option.value} checked={selected} onChange={changeChoice} className="mt-1 accent-cyan-300" />
                  <span>{option.label}</span>
                </label>;
              })}
              {question.optional_explanation && <div className="pt-2">
                <label htmlFor={`explanation-${question.id}`} className="mb-2 block text-sm text-slate-300">{question.explanation_prompt ?? "Optional explanation (if you wish)"}</label>
                <textarea id={`explanation-${question.id}`} value={parseChoiceAnswer(currentAnswer).explanation} onChange={(e) => setAnswers((a) => { const previous = parseChoiceAnswer(a[question.id] ?? ""); return { ...a, [question.id]: encodeChoiceAnswer(previous.choices, e.target.value) }; })} rows={3} placeholder="Add context if helpful…" className="w-full resize-y rounded-2xl border border-white/15 bg-slate-950/70 px-4 py-3 text-base leading-7 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20" />
              </div>}
            </div> : question.type === "text" ? <input value={currentAnswer} onChange={(e) => setAnswers((a) => ({ ...a, [question.id]: e.target.value }))} placeholder="Type your answer here…" className="w-full rounded-2xl border border-white/15 bg-slate-950/70 px-4 py-4 text-base outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20" /> :
              <textarea value={currentAnswer} onChange={(e) => setAnswers((a) => ({ ...a, [question.id]: e.target.value }))} rows={question.type === "long_text" ? 6 : 5} placeholder={question.type === "repeatable_list" ? "Add one item per line…" : question.type === "file_or_text" ? "Paste the document link or describe the information here. File upload is not enabled yet." : "Type your answer here…"} className="w-full resize-y rounded-2xl border border-white/15 bg-slate-950/70 px-4 py-4 text-base leading-7 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20" />}
            <p className="mt-2 text-xs text-slate-500">{question.required === false ? "Optional question" : "Required · You can use Hindi, English, or Hinglish."}</p>
          </div>
          {error && <p role="alert" className="mt-5 rounded-xl border border-rose-300/20 bg-rose-300/5 px-4 py-3 text-sm text-rose-200">{error}</p>}
          {notice && <p aria-live="polite" className="mt-5 text-sm text-emerald-300">{notice}</p>}
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-6">
            <button onClick={goBack} disabled={saving || (sectionIndex === 0 && questionIndex === 0)} className="rounded-xl border border-white/15 px-5 py-3 font-medium text-slate-200 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30">← Back</button>
            <div className="flex flex-wrap gap-3">
              <button onClick={async () => { try { await saveCurrent(sectionIndex, questionIndex); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Save failed."); } }} disabled={saving} className="rounded-xl border border-cyan-300/40 px-5 py-3 font-medium text-cyan-200 transition hover:bg-cyan-300/10 disabled:opacity-50">{saving ? "Saving…" : "Save progress"}</button>
              {isLastQuestion ? <button onClick={beginClosure} disabled={saving} className="rounded-xl bg-emerald-300 px-6 py-3 font-semibold text-slate-950 transition hover:bg-emerald-200 disabled:opacity-50">Review checklist & finish →</button> : <button onClick={goNext} disabled={saving} className="rounded-xl bg-cyan-300 px-6 py-3 font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-50">Save & continue →</button>}
            </div>
          </div>
        </>}
      </section>
      <footer className="mt-6 flex flex-wrap justify-between gap-3 text-xs text-slate-500"><span>Private questionnaire · Secure link access</span><span>{answeredCount} of {flatQuestions.length} questions answered · Progress saves securely</span></footer>
    </div>
  </main>;
}
