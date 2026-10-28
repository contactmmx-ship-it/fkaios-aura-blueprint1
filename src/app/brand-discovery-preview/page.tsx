 "use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import bank from "../../../config/brand-discovery/raahat-question-bank-v1.draft.json";

type Option = { value: string; label: string };
type Part = { id: string; label: string; instruction?: string; selection_mode?: "single" | "multiple"; max_selections?: number; optional?: boolean; options: Option[] };
type Question = {
  id: string; number: number; prompt: string; type: string; required?: boolean; help_text?: string;
  options?: Option[]; selection_mode?: "single" | "multiple"; max_selections?: number; selection_instruction?: string;
  optional_explanation?: boolean; explanation_prompt?: string; parts?: Part[];
  service_options?: Option[]; status_options?: Option[]; service_instruction?: string; status_instruction?: string;
  row_label?: string; row_prompt?: string; source_block?: string; source_render_mode?: string;
};
type Section = { id: string; title: string; intro?: string; why_it_matters?: string; questions: Question[] };
type DocItem = { id: string; label: string; required?: boolean; status_options: string[] };
const config = bank as unknown as { brand: { name: string; owner: string; location: string }; sections: Section[]; question_count: number; document_checklist: DocItem[]; confidentiality_and_acknowledgement: string };
const sections = config.sections;
const questions = sections.flatMap((section, sectionIndex) => section.questions.map((question) => ({ ...question, sectionTitle: section.title, sectionIndex })));
const steps = questions.length + config.document_checklist.length + 1;
const STORE_KEY = "fk-raahat-premium-preview-v2";
const blank = (value: unknown) => value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

function Icon({ name, className = "" }: { name: string; className?: string }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className };
  const paths: Record<string, React.ReactNode> = {
    spark: <><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-2-5.8L4 11l6-2.2L12 3Z"/><path d="m19 14 1.1 2.3L22 17l-1.9.8L19 20l-.8-2.2L16 17l2.2-.7L19 14Z"/></>,
    check: <path d="m5 12 4 4L19 6"/>, arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
    back: <path d="M19 12H5m6 6-6-6 6-6"/>, lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/></>,
    mic: <><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8"/></>,
    save: <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/></>,
    help: <><circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 1 1 4.4 1.6c-1.2 1-2 1.3-2 3M12 17h.01"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z"/><path d="M4 17a2.5 2.5 0 0 1 2.5-2.5H20"/></>,
    chev: <path d="m6 9 6 6 6-6"/>, reset: <><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/></>,
  };
  return <svg {...common} aria-hidden="true">{paths[name] ?? paths.spark}</svg>;
}

export default function BrandDiscoveryPreviewPage() {
  const [index, setIndex] = useState(0);
  const [welcomeOpen, setWelcomeOpen] = useState(true);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideInput, setGuideInput] = useState("");
  const [guideBusy, setGuideBusy] = useState(false);
  const [guideChat, setGuideChat] = useState<Array<{role: "user" | "assistant"; content: string}>>([]);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [helpOpen, setHelpOpen] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [guideMessage, setGuideMessage] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [showReset, setShowReset] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [resumeAvailable, setResumeAvailable] = useState(false);
  const [validationMessage, setValidationMessage] = useState("");
  const [voiceMessage, setVoiceMessage] = useState("Voice guide is optional.");
  const [dictationMessage, setDictationMessage] = useState("");
  const [stage, setStage] = useState<"questions" | "documents" | "ack" | "complete">("questions");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.answers) setAnswers(saved.answers);
        if (saved.notes) setNotes(saved.notes);
        if (typeof saved.index === "number") setIndex(Math.max(0, Math.min(questions.length - 1, saved.index)));
        if (["questions", "documents", "ack", "complete"].includes(saved.stage)) setStage(saved.stage);
        if (saved.answers && Object.keys(saved.answers).length) { setResumeAvailable(true); setWelcomeOpen(false); }
      }
    } catch { /* Preview must still work if local storage is unavailable. */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify({ answers, notes, index, stage, savedAt: new Date().toISOString() }));
      setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch { setSavedAt("session only"); }
  }, [answers, notes, index, stage, hydrated]);

  const currentQuestion = questions[index];
  const isDoc = stage === "documents";
  const docIndex = Math.max(0, index - questions.length);
  const currentDoc = config.document_checklist[docIndex];
  const overallIndex = stage === "questions" ? index : stage === "documents" ? questions.length + docIndex : stage === "ack" ? questions.length + config.document_checklist.length : steps;
  const progress = Math.min(100, Math.round((overallIndex / steps) * 100));
  const section = currentQuestion ? sections[currentQuestion.sectionIndex] : undefined;
  const answerCount = Object.values(answers).filter((v) => !blank(v)).length;
  const sectionProgress = currentQuestion ? Math.round(((currentQuestion.number) / section!.questions.length) * 100) : 100;
  const currentAnswer = currentQuestion ? answers[currentQuestion.id] : undefined;

  const updateAnswer = (key: string, value: any) => setAnswers((old) => ({ ...old, [key]: value }));
  const toggleOption = (key: string, value: string, mode: string | undefined, max?: number) => {
    const current = Array.isArray(answers[key]) ? answers[key] : [];
    const next = current.includes(value) ? current.filter((item: string) => item !== value) :
      mode === "multiple" ? (max && current.length >= max ? current : [...current, value]) : [value];
    updateAnswer(key, next);
  };
  const say = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setVoiceMessage("This browser does not support speech playback. You can still use the full preview without voice.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "hi-IN";
    utterance.rate = 0.92;
    utterance.onstart = () => setVoiceMessage("Playing browser voice preview…");
    utterance.onend = () => setVoiceMessage("Voice preview finished.");
    utterance.onerror = () => setVoiceMessage("Voice playback unavailable in this browser.");
    window.speechSynthesis.speak(utterance);
  }, []);

  const jumpToSection = (sectionIndex: number) => {
    const first = questions.findIndex((q) => q.sectionIndex === sectionIndex);
    if (first >= 0) { setIndex(first); setStage("questions"); setShowMap(false); setGuideMessage(""); }
  };
  const hasMeaningfulAnswer = (value: any) => !blank(value) && !(Array.isArray(value) && value.every((item) => blank(item) || (typeof item === "object" && Object.values(item).every((v) => blank(v)))));
  const questionHasAnswer = (q: Question) => {
    if (q.type === "multi_part") return (q.parts ?? []).every((part) => part.optional || hasMeaningfulAnswer(answers[q.id + ":" + part.id]));
    if (q.type === "service_status") return (q.service_options ?? []).every((service) => !q.required || hasMeaningfulAnswer(answers[q.id + ":" + service.value]));
    return hasMeaningfulAnswer(answers[q.id]);
  };
  const exportPreview = () => {
    const payload = {
      title: "Raahat Brand Discovery — Preview Response Export",
      environment: "LOCAL PREVIEW ONLY — NOT SUBMITTED OR VERIFIED",
      exported_at: new Date().toISOString(),
      brand: config.brand,
      answers,
      clarifications: notes,
      questions_answered: questions.filter((q) => questionHasAnswer(q)).length,
      total_questions: questions.length,
      document_statuses: Object.fromEntries(config.document_checklist.map((d) => [d.id, answers[d.id] ?? "Not answered"])),
      acknowledgement_checked: !!answers.acknowledged,
      notice: "This file is a local preview export. It has not been submitted to Franchise Kart, emailed, reviewed, or verified."
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "raahat-brand-discovery-preview-response.json";
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  };
  const next = () => {
    setHelpOpen(false); setGuideMessage(""); setValidationMessage("");
    if (stage === "questions" && currentQuestion?.required && !questionHasAnswer(currentQuestion)) {
      setValidationMessage("Please answer this required question before continuing. If the available options do not fit, use an offered “Other”, “Not sure”, or “Prefer to discuss personally” option where available.");
      return;
    }
    if (stage === "ack" && !answers.acknowledged) {
      setValidationMessage("Please tick the acknowledgement box before finishing this preview.");
      return;
    }
    if (stage === "questions") {
      if (index < questions.length - 1) setIndex(index + 1);
      else { setStage("documents"); setIndex(questions.length); }
    } else if (stage === "documents") {
      if (docIndex < config.document_checklist.length - 1) setIndex(questions.length + docIndex + 1);
      else setStage("ack");
    } else if (stage === "ack") setStage("complete");
  };
  const previous = () => {
    setHelpOpen(false); setGuideMessage("");
    if (stage === "questions" && index > 0) setIndex(index - 1);
    else if (stage === "documents" && docIndex > 0) setIndex(questions.length + docIndex - 1);
    else if (stage === "documents") { setStage("questions"); setIndex(questions.length - 1); }
    else if (stage === "ack") { setStage("documents"); setIndex(questions.length + config.document_checklist.length - 1); }
    else if (stage === "complete") setStage("ack");
  };
  const resetPreview = () => {
    setAnswers({}); setNotes({}); setIndex(0); setStage("questions"); setShowReset(false); setWelcomeOpen(true); setResumeAvailable(false); setReviewOpen(false); setValidationMessage(""); setGuideChat([]); setGuideInput("");
    try { window.localStorage.removeItem(STORE_KEY); } catch { /* no-op */ }
  };
  const getGuideText = () => {
    if (currentQuestion?.help_text) return currentQuestion.help_text;
    if (currentQuestion?.type === "multi_part") return "Is sawaal mein alag-alag chhote parts hain. Har part ka jawab usi ke neeche select karein. Agar exact information yaad nahi hai, toh closest honest option choose karein.";
    if (currentQuestion?.type === "service_status") return "Har service ke liye jo status sach mein apply karta hai, wahi select karein. Service ka hona aur uska fully operational hona alag baatein hain.";
    if (currentQuestion?.type === "repeatable_choice") return "Har hall ya event space ke liye alag row banayein. Capacity confirm nahi hai toh verification option choose kar sakte hain.";
    return "Aap apne actual experience ke hisaab se jawab dein. Agar koi option bilkul fit nahi hota, 'Other' choose karein aur neeche optional clarification de sakte hain. Guess karna zaroori nahi hai.";
  };
  const speakCurrent = () => say(stage === "questions" && currentQuestion ? currentQuestion.prompt + ". " + (currentQuestion.selection_instruction ?? "") : stage === "documents" && currentDoc ? currentDoc.label : stage === "ack" ? "Please review the confidentiality and acknowledgement before continuing." : "Preview complete. Thank you.");
  const sendGuideMessage = async (message?: string) => {
    const text = (message ?? guideInput).trim();
    if (!text || guideBusy) return;
    const nextChat = [...guideChat, { role: "user" as const, content: text }].slice(-8);
    setGuideChat(nextChat); setGuideInput(""); setGuideBusy(true);
    try {
      const response = await fetch("/api/brand-discovery-guide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, history: guideChat.slice(-6), context: { brand: config.brand.name, section: currentQuestion?.sectionTitle ?? (stage === "documents" ? "Supporting documents" : stage === "ack" ? "Confidentiality" : "Completion"), questionNumber: currentQuestion?.number, question: currentQuestion?.prompt, helpText: currentQuestion?.help_text, questionType: currentQuestion?.type, options: currentQuestion?.options?.map((option) => option.label).slice(0, 24) } }) });
      const payload = await response.json();
      setGuideChat((old) => [...old, { role: "assistant", content: typeof payload.answer === "string" ? payload.answer : "I could not prepare guidance just now. Please use the question explanation or continue without the guide." }].slice(-12));
    } catch { const local = [currentQuestion?.help_text, currentQuestion ? `This question asks: ${currentQuestion.prompt}` : `You are in ${stage}.`, "Answer from your actual experience or records. Do not guess. A self-reported answer is not the same as a received, reviewed or verified fact. If no option fits, use Other when offered and add a separate optional clarification."].filter(Boolean).join("\\n\\n"); setGuideChat((old) => [...old, { role: "assistant", content: local }].slice(-12)); }
    finally { setGuideBusy(false); }
  };
  const startDictation = (existingText: string, onText: (value: string) => void) => {
    const w = window as any;
    const Recognition = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Recognition) { setDictationMessage("Voice typing is not supported in this browser. You can continue typing normally."); return; }
    try {
      const recognition = new Recognition();
      recognition.lang = "hi-IN";
      recognition.continuous = false;
      recognition.interimResults = false;
      setDictationMessage("Listening… speak your answer, then wait for the text to appear.");
      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results as ArrayLike<any>).map((result: any) => result[0]?.transcript ?? "").join(" ").trim();
        if (transcript) { onText([existingText.trim(), transcript].filter(Boolean).join(existingText.trim() ? " " : "")); setDictationMessage("Voice text added. Please review it before continuing."); }
        else setDictationMessage("No speech was detected. You can try again or type instead.");
      };
      recognition.onerror = () => setDictationMessage("Voice input was unavailable or permission was denied. Typing remains available.");
      recognition.onend = () => {};
      recognition.start();
    } catch { setDictationMessage("Could not start voice input. You can continue typing normally."); }
  };

  const optionButton = (key: string, option: Option, mode: string | undefined, max?: number) => {
    const selected = Array.isArray(answers[key]) && answers[key].includes(option.value);
    const disabled = !selected && mode === "multiple" && !!max && (answers[key] ?? []).length >= max;
    return <button key={option.value} type="button" disabled={disabled} aria-pressed={selected} onClick={() => toggleOption(key, option.value, mode, max)} className={"group flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-45 " + (selected ? "border-[#b9904d] bg-[#f8f1e4] shadow-[0_0_0_1px_rgba(185,144,77,.16)]" : "border-[#e8e3d9] bg-white hover:-translate-y-0.5 hover:border-[#b7c8bd] hover:bg-[#fbfcfa]")}>
      <span className={"mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border text-[11px] transition " + (mode === "multiple" ? "rounded-md" : "rounded-full") + (selected ? " border-[#967139] bg-[#967139] text-white" : " border-[#c9c6bd] bg-white text-transparent")}>{selected ? "✓" : ""}</span>
      <span className={"text-[14px] leading-6 " + (selected ? "font-medium text-[#243e33]" : "text-[#4d554f]")}>{option.label}</span>
      {selected && <span className="ml-auto pl-2 text-[#967139]"><Icon name="check" /></span>}
    </button>;
  };

  return (
    <main className="min-h-screen bg-[#f4f1e9] text-[#202c27] selection:bg-[#d7c59d]">
      {welcomeOpen && <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[#10271f]/95 p-4 backdrop-blur-md"><div className="my-6 w-full max-w-3xl overflow-hidden rounded-[32px] border border-[#c9ad72]/35 bg-[#f8f6ef] shadow-[0_30px_100px_rgba(0,0,0,.35)]"><div className="bg-[#173329] px-7 py-8 text-white sm:px-11 sm:py-10"><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#c6ad78]/50 font-serif text-lg text-[#e2c98e]">FK</div><div><p className="text-[10px] font-semibold uppercase tracking-[.27em] text-[#d4bd87]">Franchise Kart · Brand Intelligence</p><p className="mt-1 text-xs text-white/60">Private discovery preview for Raahat</p></div></div><p className="mt-10 text-[10px] font-bold uppercase tracking-[.28em] text-[#d5bd86]">A guided owner conversation</p><h1 className="mt-3 max-w-2xl font-serif text-4xl leading-tight tracking-[-.03em] sm:text-5xl">Your story first.<br/><span className="italic text-[#d7c18e]">The right growth plan follows.</span></h1><p className="mt-5 max-w-2xl text-sm leading-7 text-white/70">This discovery journey helps us understand the people, property, guest experience, operating realities and ambitions behind Raahat. Move at your own pace, revisit chapters and save progress in this browser.</p></div><div className="grid gap-4 px-7 py-7 sm:grid-cols-3 sm:px-11"><div className="rounded-2xl border border-[#e7e0d1] bg-white p-4"><p className="font-serif text-2xl text-[#2c513b]">01</p><p className="mt-2 text-sm font-semibold text-[#33463a]">Tell your story</p><p className="mt-1 text-xs leading-5 text-[#7b8177]">One question at a time, with plain-language guidance.</p></div><div className="rounded-2xl border border-[#e7e0d1] bg-white p-4"><p className="font-serif text-2xl text-[#2c513b]">02</p><p className="mt-2 text-sm font-semibold text-[#33463a]">Share what you know</p><p className="mt-1 text-xs leading-5 text-[#7b8177]">Honest answers are better than guesses.</p></div><div className="rounded-2xl border border-[#e7e0d1] bg-white p-4"><p className="font-serif text-2xl text-[#2c513b]">03</p><p className="mt-2 text-sm font-semibold text-[#33463a]">Review before finishing</p><p className="mt-1 text-xs leading-5 text-[#7b8177]">Edit answers and export your local preview.</p></div></div><div className="flex flex-wrap items-center justify-between gap-4 px-7 pb-8 sm:px-11"><p className="max-w-md text-[11px] leading-5 text-[#8a8b80]">Preview only: no response is submitted, no email is sent and no live AI service is connected.</p><button type="button" onClick={() => setWelcomeOpen(false)} className="inline-flex items-center gap-3 rounded-full bg-[#1b3b2b] px-6 py-4 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-[#2a5540]">Begin the discovery <Icon name="arrow"/></button></div></div></div>}
      <div className="relative overflow-hidden bg-[#142d25] text-white">
        <div className="pointer-events-none absolute -right-24 -top-36 h-[420px] w-[420px] rounded-full border border-white/10" />
        <div className="pointer-events-none absolute -right-4 -top-16 h-[300px] w-[300px] rounded-full border border-[#b99a60]/30" />
        <div className="relative mx-auto max-w-[1440px] px-5 pb-7 pt-5 sm:px-8 lg:px-12">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#c6ad78]/50 bg-white/5 font-serif text-lg text-[#e2c98e]">FK</div>
              <div><p className="text-[10px] font-semibold uppercase tracking-[.27em] text-[#d4bd87]">Franchise Kart</p><p className="mt-0.5 text-sm text-white/70">Brand Intelligence · Owner Discovery</p></div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-[#d5bd86]/40 bg-[#d5bd86]/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.16em] text-[#f1dfb5]"><span className="h-1.5 w-1.5 rounded-full bg-[#d5bd86]" /> Preview environment</span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/65"><Icon name="lock" /> Private by design</span>
            </div>
          </div>
          <div className="grid gap-7 py-8 md:grid-cols-[1fr_auto] md:items-end md:py-11">
            <div className="max-w-3xl">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[.28em] text-[#d5bd86]">A thoughtful conversation, not a form</p>
              <h1 className="font-serif text-4xl font-medium leading-[1.08] tracking-[-.035em] sm:text-5xl lg:text-6xl">Every detail has a story.<br/><span className="italic text-[#d7c18e]">Let’s understand yours.</span></h1>
              <p className="mt-5 max-w-2xl text-sm leading-7 text-white/65 sm:text-base">A guided discovery journey to understand Raahat’s history, guest experience, operations, financial realities and future ambition—one thoughtful step at a time.</p>
            </div>
            <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[.045] p-4 md:min-w-[245px]">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[#d5bd86]/50 bg-[#d5bd86]/10 font-serif text-2xl text-[#e2c98e]">R</div>
              <div><p className="font-serif text-xl">{config.brand.name}</p><p className="mt-1 text-xs text-white/55">{config.brand.location} · {config.brand.category}</p><p className="mt-2 text-[10px] uppercase tracking-[.15em] text-[#d5bd86]">Prepared for {config.brand.owner}</p></div>
            </div>
          </div>
        </div>
      </div>

      <div className="sticky top-0 z-30 border-b border-[#e4ded1] bg-[#f8f6f0]/95 shadow-[0_5px_20px_rgba(27,42,34,.04)] backdrop-blur-xl">
        <div className="mx-auto max-w-[1440px] px-5 py-3 sm:px-8 lg:px-12">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3"><div className="text-xs font-semibold tabular-nums text-[#263e32]">{progress}%</div><div className="h-1.5 w-36 overflow-hidden rounded-full bg-[#e4dfd3] sm:w-64"><div className="h-full rounded-full bg-gradient-to-r from-[#2d5b45] to-[#c2a366] transition-all duration-500" style={{ width: progress + "%" }}/></div><span className="hidden text-xs text-[#7d8177] sm:inline">{stage === "questions" ? "Discovery journey" : stage === "documents" ? "Supporting documents" : stage === "ack" ? "Final acknowledgement" : "Preview completed"}</span></div>
            <div className="flex items-center gap-3 text-xs text-[#7b8178]"><span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#639277]"/>{savedAt ? "Saved locally " + savedAt : "Preparing preview save…"}</span><button type="button" onClick={() => setShowReset(true)} className="rounded-full border border-[#ded8ca] p-2 text-[#68746b] transition hover:bg-white" aria-label="Reset preview"><Icon name="reset"/></button></div>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1440px] gap-6 px-4 py-6 sm:px-8 sm:py-9 lg:grid-cols-[270px_minmax(0,1fr)_260px] lg:gap-7 lg:px-12">
        <aside className="space-y-4">
          <div className="rounded-3xl border border-[#e5dfd2] bg-white p-5 shadow-[0_8px_28px_rgba(28,42,33,.035)]">
            <div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#9b875a]">Your journey</p><Icon name="grid" className="text-[#a08a5d]"/></div>
            <p className="mt-3 font-serif text-2xl">Discovery map</p>
            <p className="mt-1 text-xs leading-5 text-[#85877e]">16 chapters · {questions.length} questions</p>
            <button type="button" onClick={() => setShowMap(!showMap)} className="mt-4 flex w-full items-center justify-between rounded-xl bg-[#f6f4ee] px-3 py-2.5 text-left text-xs font-semibold text-[#405347]"><span>{showMap ? "Close chapter navigator" : "Explore chapters"}</span><Icon name="chev" className={showMap ? "rotate-180 transition" : "transition"}/></button>
            {showMap && <div className="mt-3 max-h-[480px] space-y-1 overflow-y-auto pr-1">
              {sections.map((s, i) => <button key={s.id} type="button" onClick={() => jumpToSection(i)} className={"flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition " + (currentQuestion?.sectionIndex === i && stage === "questions" ? "bg-[#e9efe8] text-[#234b36]" : "text-[#6f776e] hover:bg-[#f8f6f1]")}>
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current/20 text-[10px] font-semibold">{String(i+1).padStart(2,"0")}</span><span className="text-xs leading-5">{s.title}</span>
              </button>)}
            </div>}
            {!showMap && <div className="mt-5 space-y-3">
              {sections.slice(0, 4).map((s, i) => <button key={s.id} type="button" onClick={() => jumpToSection(i)} className="flex w-full items-center gap-3 text-left"><span className={"flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold " + (currentQuestion?.sectionIndex === i && stage === "questions" ? "bg-[#254b38] text-white" : "bg-[#f1efe8] text-[#7e857b]")}>{String(i+1).padStart(2,"0")}</span><span className={"text-xs leading-5 " + (currentQuestion?.sectionIndex === i && stage === "questions" ? "font-semibold text-[#294936]" : "text-[#777d73]")}>{s.title}</span><span className="ml-auto text-[10px] text-[#a3a398]">{s.questions.length}</span></button>)}
              <button type="button" onClick={() => setShowMap(true)} className="pl-10 text-xs font-semibold text-[#927849] hover:underline">View all 16 chapters →</button>
            </div>}
          </div>
          <div className="rounded-3xl bg-[#e8ece4] p-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#315642]"><Icon name="lock"/></div>
            <p className="mt-3 font-serif text-lg text-[#294735]">Your information matters.</p>
            <p className="mt-2 text-xs leading-6 text-[#647267]">Your responses are intended for the agreed discovery process. Internal Franchise Kart analysis is separate and will not be shown in the owner questionnaire.</p>
          </div>
        </aside>

        <section className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
            <div><p className="text-[10px] font-bold uppercase tracking-[.22em] text-[#9a8354]">{stage === "questions" ? "Chapter " + String((currentQuestion?.sectionIndex ?? 0)+1).padStart(2,"0") + " / 16" : stage === "documents" ? "Supporting material" : stage === "ack" ? "Closing step" : "Journey complete"}</p><p className="mt-1 text-xs text-[#85877c]">{stage === "questions" && currentQuestion ? "Question " + (index + 1) + " of " + questions.length : stage === "documents" ? "Document " + (docIndex + 1) + " of " + config.document_checklist.length : stage === "ack" ? "Confidentiality & acknowledgement" : "Thank you for your time"}</p></div>
            <button type="button" onClick={speakCurrent} className="inline-flex items-center gap-2 rounded-full border border-[#d9d2c3] bg-white px-3 py-2 text-xs font-semibold text-[#52675a] transition hover:border-[#a99a76]"><Icon name="mic"/> Listen to this step</button>
          </div>

          <div className="overflow-hidden rounded-[28px] border border-[#e2dccf] bg-white shadow-[0_18px_60px_rgba(31,45,35,.07)]">
            <div className="h-1.5 bg-[#f0ede5]"><div className="h-full bg-gradient-to-r from-[#244e38] via-[#6d8a65] to-[#c6a76a] transition-all duration-500" style={{ width: (stage === "questions" ? sectionProgress : 100) + "%" }}/></div>
            <div className="p-5 sm:p-8 lg:p-10">
              {stage === "questions" && currentQuestion && section && <>
                <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
                  <div className="max-w-2xl"><div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#f3f0e7] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.15em] text-[#8e784c]"><Icon name="spark" className="h-3.5 w-3.5"/>{section.title}</div><h2 className="font-serif text-2xl leading-tight tracking-[-.025em] text-[#233b2e] sm:text-3xl lg:text-[34px]">{currentQuestion.prompt}</h2>{currentQuestion.help_text && <p className="mt-4 max-w-2xl text-sm leading-7 text-[#747b72]">{currentQuestion.help_text}</p>}</div>
                  <div className="flex h-[58px] w-[58px] shrink-0 flex-col items-center justify-center rounded-2xl border border-[#e9e0cd] bg-[#faf7ef]"><span className="font-serif text-xl text-[#8f7442]">{String(currentQuestion.number).padStart(2,"0")}</span><span className="text-[8px] uppercase tracking-[.14em] text-[#9c9586]">Question</span></div>
                </div>
                {section.why_it_matters && <div className="mb-6 rounded-2xl border-l-2 border-[#c5a66b] bg-[#faf8f2] px-4 py-3"><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#987c48]">Why we ask</p><p className="mt-1 text-xs leading-6 text-[#77786d]">{section.why_it_matters}</p></div>}
                {currentQuestion.selection_instruction && <p className="mb-3 text-xs font-semibold text-[#6c756a]">{currentQuestion.selection_instruction}{currentQuestion.max_selections ? " (up to " + currentQuestion.max_selections + ")" : ""}</p>}

                {currentQuestion.type === "multiple_choice" && <div className="space-y-2.5">{(currentQuestion.options ?? []).map((o) => optionButton(currentQuestion.id, o, currentQuestion.selection_mode, currentQuestion.max_selections))}</div>}

                {currentQuestion.type === "multi_part" && <div className="space-y-5">{(currentQuestion.parts ?? []).map((part, partIndex) => <div key={part.id} className="rounded-2xl border border-[#e7e2d7] bg-[#fdfcf9] p-4 sm:p-5"><div className="mb-3 flex items-start gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#e9eee6] text-xs font-bold text-[#47664e]">{String.fromCharCode(65+partIndex)}</span><div><p className="text-sm font-semibold text-[#33463a]">{part.label}</p>{part.instruction && <p className="mt-1 text-xs leading-5 text-[#81847b]">{part.instruction}</p>}</div></div><div className="space-y-2">{part.options.map((o) => optionButton(currentQuestion.id + ":" + part.id, o, part.selection_mode, part.max_selections))}</div>{currentQuestion.explanation_part_ids?.includes(part.id) && <textarea value={notes[currentQuestion.id + ":" + part.id] ?? ""} onChange={(e) => setNotes((old) => ({...old, [currentQuestion.id + ":" + part.id]: e.target.value}))} rows={2} placeholder="Optional clarification…" className="mt-3 w-full rounded-xl border border-[#e5dfd3] bg-white px-3 py-3 text-sm outline-none focus:border-[#a68b56]"/>}</div>)}</div>}

                {currentQuestion.type === "service_status" && <div className="space-y-3"><p className="text-xs text-[#727a70]">{currentQuestion.service_instruction}</p>{(currentQuestion.service_options ?? []).map((service) => <div key={service.value} className="rounded-2xl border border-[#e7e2d7] p-4"><p className="mb-3 text-sm font-semibold text-[#33463a]">{service.label}</p><div className="flex flex-wrap gap-2">{(currentQuestion.status_options ?? []).map((status) => { const key = currentQuestion.id + ":" + service.value; const active = answers[key] === status.value; return <button key={status.value} type="button" aria-pressed={active} onClick={() => updateAnswer(key, active ? "" : status.value)} className={"rounded-full border px-3 py-2 text-xs transition " + (active ? "border-[#2e5c42] bg-[#eaf0e8] font-semibold text-[#2e5c42]" : "border-[#e3ded3] text-[#6e766c] hover:bg-[#faf8f3]")}>{status.label}</button>;})}</div></div>)}</div>}

                {currentQuestion.type === "repeatable_choice" && <div className="space-y-3"><p className="mb-3 text-xs leading-5 text-[#727a70]">{currentQuestion.row_prompt}</p>{(Array.isArray(currentAnswer) ? currentAnswer : [{ name: "", choice: "" }]).map((row: any, rowIndex: number) => <div key={rowIndex} className="rounded-2xl border border-[#e7e2d7] bg-[#fdfcf9] p-4"><div className="mb-3 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[.12em] text-[#927b4e]">Space {String(rowIndex+1).padStart(2,"0")}</p>{rowIndex > 0 && <button type="button" onClick={() => updateAnswer(currentQuestion.id, currentAnswer.filter((_: any, i: number) => i !== rowIndex))} className="text-xs text-[#9b5e4e]">Remove</button>}</div><input value={row.name} onChange={(e) => {const old = Array.isArray(currentAnswer) ? [...currentAnswer] : [{name:"",choice:""}];old[rowIndex]={...old[rowIndex],name:e.target.value};updateAnswer(currentQuestion.id,old);}} placeholder={currentQuestion.row_label ?? "Hall or event space name"} className="mb-3 w-full rounded-xl border border-[#e3ded3] bg-white px-3 py-3 text-sm outline-none focus:border-[#a68b56]"/><div className="space-y-2">{(currentQuestion.options ?? []).map((o) => <button key={o.value} type="button" aria-pressed={row.choice === o.value} onClick={() => {const old = Array.isArray(currentAnswer) ? [...currentAnswer] : [{name:"",choice:""}];old[rowIndex]={...old[rowIndex],choice:o.value};updateAnswer(currentQuestion.id,old);}} className={"w-full rounded-xl border px-3 py-2.5 text-left text-xs " + (row.choice === o.value ? "border-[#b9904d] bg-[#f8f1e4] font-semibold" : "border-[#e7e2d7] hover:bg-white")}>{row.choice === o.value ? "✓ " : "○ "}{o.label}</button>)}</div></div>)}<button type="button" onClick={() => updateAnswer(currentQuestion.id, [...(Array.isArray(currentAnswer) ? currentAnswer : [{name:"",choice:""}]), {name:"",choice:""}])} className="rounded-xl border border-dashed border-[#c9b990] px-4 py-3 text-xs font-semibold text-[#816c43] hover:bg-[#faf7ef]">+ Add another hall or event space</button></div>}

                {["text","long_text","file_or_text","repeatable_list"].includes(currentQuestion.type) && <div><label className="mb-2 block text-xs font-semibold text-[#667166]">{currentQuestion.explanation_prompt ?? "Your response"}</label>{currentQuestion.type === "repeatable_list" ? <div className="space-y-2">{(Array.isArray(currentAnswer) ? currentAnswer : [""]).map((v: string, i: number) => <div key={i} className="flex gap-2"><input value={v} onChange={(e) => {const old = Array.isArray(currentAnswer) ? [...currentAnswer] : [""];old[i]=e.target.value;updateAnswer(currentQuestion.id,old);}} className="min-w-0 flex-1 rounded-xl border border-[#e3ded3] px-3 py-3 text-sm outline-none focus:border-[#a68b56]"/>{i>0 && <button type="button" onClick={() => updateAnswer(currentQuestion.id,currentAnswer.filter((_: any,j: number)=>j!==i))} className="px-2 text-xs text-[#9b5e4e]">Remove</button>}</div>)}<button type="button" onClick={() => updateAnswer(currentQuestion.id,[...(Array.isArray(currentAnswer)?currentAnswer:[""]), ""])} className="mt-2 text-xs font-semibold text-[#816c43]">+ Add another</button></div> : <><textarea rows={currentQuestion.type === "long_text" ? 5 : 3} value={typeof currentAnswer === "string" ? currentAnswer : ""} onChange={(e) => updateAnswer(currentQuestion.id,e.target.value)} placeholder="Write in Hindi, English or natural Hinglish…" className="w-full rounded-2xl border border-[#e3ded3] bg-[#fdfcf9] px-4 py-3.5 text-sm leading-6 outline-none transition focus:border-[#a68b56] focus:bg-white focus:ring-4 focus:ring-[#c5a66b]/10"/><button type="button" onClick={() => startDictation(typeof currentAnswer === "string" ? currentAnswer : "", (value) => updateAnswer(currentQuestion.id, value))} className="mt-2 inline-flex items-center gap-2 rounded-full border border-[#d9d2c3] bg-white px-3 py-2 text-xs font-semibold text-[#52675a] hover:border-[#a99a76]"><Icon name="mic"/> Dictate answer</button></>}{currentQuestion.type === "file_or_text" && <p className="mt-2 text-xs text-[#85877c]">For this preview, use a note only. Secure file upload is not connected.</p>}{dictationMessage && <p role="status" aria-live="polite" className="mt-2 text-xs leading-5 text-[#68766b]">{dictationMessage}</p>}</div>}

                {(currentQuestion.optional_explanation || currentQuestion.explanation_prompt) && currentQuestion.type !== "multi_part" && <div className="mt-5"><label className="mb-2 block text-xs font-semibold text-[#667166]">{currentQuestion.explanation_prompt ?? "Anything else you would like to add? (Optional)"}</label><textarea rows={3} value={notes[currentQuestion.id] ?? ""} onChange={(e) => setNotes((old) => ({...old,[currentQuestion.id]:e.target.value}))} placeholder="Optional context or clarification…" className="w-full rounded-2xl border border-[#e3ded3] bg-white px-4 py-3 text-sm leading-6 outline-none focus:border-[#a68b56]"/></div>}
                {currentQuestion.type === "multiple_choice" && (currentQuestion.options ?? []).some(o => /other/i.test(o.label) && (Array.isArray(currentAnswer) ? currentAnswer.includes(o.value) : false)) && <div className="mt-4 rounded-2xl border border-[#e6ddc8] bg-[#faf7ef] p-4"><label className="mb-2 block text-xs font-semibold text-[#79633c]">Optional clarification for “Other”</label><textarea rows={2} value={notes[currentQuestion.id + ":other"] ?? ""} onChange={(e) => setNotes((old) => ({...old,[currentQuestion.id + ":other"]:e.target.value}))} placeholder="Please describe, if you wish…" className="w-full rounded-xl border border-[#e1d8c4] bg-white px-3 py-3 text-sm outline-none focus:border-[#a68b56]"/></div>}

                <div className="mt-7 flex items-center gap-2 rounded-xl bg-[#f8f7f2] px-3 py-2.5 text-[11px] leading-5 text-[#7b8076]"><Icon name="lock" className="shrink-0 text-[#8b805e]"/><span>Honest estimates are better than guesses. “Not sure” or “needs verification” is acceptable where offered.</span></div>
              </>}

              {stage === "documents" && currentDoc && <div className="animate-[fadeIn_.25s_ease-out]"><div className="mb-5 inline-flex items-center gap-2 rounded-full bg-[#f3f0e7] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.15em] text-[#8e784c]"><Icon name="book" className="h-3.5 w-3.5"/> Supporting documents</div><p className="text-xs text-[#85877c]">Checklist item {docIndex+1} of {config.document_checklist.length}</p><h2 className="mt-3 font-serif text-3xl leading-tight text-[#233b2e]">{currentDoc.label}</h2><p className="mt-4 text-sm leading-7 text-[#747b72]">Please indicate whether this record is available. This is a self-reported status only—it does not mean Franchise Kart has received or verified the document.</p><div className="mt-7 space-y-3">{currentDoc.status_options.map((status) => <button key={status} type="button" aria-pressed={answers[currentDoc.id] === status} onClick={() => updateAnswer(currentDoc.id, answers[currentDoc.id] === status ? "" : status)} className={"flex w-full items-center gap-3 rounded-2xl border p-4 text-left text-sm transition " + (answers[currentDoc.id] === status ? "border-[#b9904d] bg-[#f8f1e4] font-semibold" : "border-[#e8e3d9] hover:bg-[#fbfcfa]")}>{answers[currentDoc.id] === status ? <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#967139] text-xs text-white">✓</span> : <span className="h-5 w-5 rounded-full border border-[#c9c6bd]"/>}{status}</button>)}</div><div className="mt-5 rounded-2xl border border-[#e7e2d7] bg-[#fdfcf9] p-4"><p className="text-xs font-semibold text-[#4b5c4e]">Evidence status stays separate</p><p className="mt-1 text-xs leading-5 text-[#81847b]">Available (self-reported) · Received · Reviewed · Verified are distinct statuses in the internal workflow.</p></div></div>}

              {validationMessage && <div role="alert" aria-live="polite" className="mb-5 rounded-2xl border border-[#d7a59a] bg-[#fff4f1] px-4 py-3 text-sm leading-6 text-[#8e4336]">{validationMessage}</div>}

              {stage === "ack" && <div><div className="mb-5 inline-flex items-center gap-2 rounded-full bg-[#f3f0e7] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.15em] text-[#8e784c]"><Icon name="lock" className="h-3.5 w-3.5"/> Confidentiality & acknowledgement</div><h2 className="font-serif text-3xl text-[#233b2e]">Before we move forward</h2><div className="prose prose-sm mt-5 max-w-none whitespace-pre-wrap text-sm leading-7 text-[#626e63]">{config.confidentiality_and_acknowledgement}</div><div className="mt-7 grid gap-4 sm:grid-cols-2"><div><label className="mb-2 block text-xs font-semibold text-[#667166]">Owner name (preview)</label><input value={answers.owner_name ?? config.brand.owner} onChange={(e) => updateAnswer("owner_name",e.target.value)} className="w-full rounded-xl border border-[#e3ded3] px-3 py-3 text-sm outline-none focus:border-[#a68b56]"/></div><div><label className="mb-2 block text-xs font-semibold text-[#667166]">Date</label><input type="date" value={answers.owner_date ?? new Date().toISOString().slice(0,10)} onChange={(e) => updateAnswer("owner_date",e.target.value)} className="w-full rounded-xl border border-[#e3ded3] px-3 py-3 text-sm outline-none focus:border-[#a68b56]"/></div></div><label className="mt-4 flex items-start gap-3 rounded-2xl border border-[#e5dfd2] bg-[#faf8f2] p-4 text-sm leading-6"><input type="checkbox" checked={!!answers.acknowledged} onChange={(e) => updateAnswer("acknowledged",e.target.checked)} className="mt-1 h-4 w-4 accent-[#315b43]"/>I have reviewed the confidentiality and acknowledgement wording above. <span className="text-[#a45d4d]">*</span></label><p className="mt-3 text-xs leading-5 text-[#85877c]">This is a preview only. It does not create a legal signature or submit an acknowledgement.</p></div>}

              {stage === "complete" && <div className="py-8 text-center"><div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-[#cbb47e] bg-[#f7f0df] text-[#967139]"><Icon name="spark" className="h-9 w-9"/></div><p className="mt-6 text-[10px] font-bold uppercase tracking-[.25em] text-[#9a8354]">Preview journey complete</p><h2 className="mt-3 font-serif text-4xl text-[#233b2e]">Thank you for sharing your story.</h2><p className="mx-auto mt-4 max-w-lg text-sm leading-7 text-[#747b72]">You have reached the end of the experience preview. No response has been sent to Franchise Kart, no report has been generated, and no email has been sent.</p><div className="mx-auto mt-7 grid max-w-md grid-cols-2 gap-3"><div className="rounded-2xl bg-[#f5f3ed] p-4"><p className="font-serif text-3xl text-[#365a43]">{answerCount}</p><p className="mt-1 text-xs text-[#81847b]">Questions with preview answers</p></div><div className="rounded-2xl bg-[#f5f3ed] p-4"><p className="font-serif text-3xl text-[#365a43]">{config.document_checklist.length}</p><p className="mt-1 text-xs text-[#81847b]">Checklist items explored</p></div></div><div className="mt-6 flex flex-wrap justify-center gap-3"><button type="button" onClick={() => setReviewOpen(!reviewOpen)} className="rounded-full border border-[#dcd6c9] px-5 py-3 text-xs font-semibold text-[#58665a] hover:bg-white">{reviewOpen ? "Hide answer review" : "Review / edit answers"}</button><button type="button" onClick={exportPreview} className="rounded-full bg-[#1c3b2c] px-5 py-3 text-xs font-semibold text-white hover:bg-[#2c5740]">Export my preview answers</button><button type="button" onClick={() => window.print()} className="rounded-full border border-[#dcd6c9] px-5 py-3 text-xs font-semibold text-[#58665a] hover:bg-white">Print / save as PDF</button><button type="button" onClick={resetPreview} className="rounded-full border border-[#dcd6c9] px-5 py-3 text-xs font-semibold text-[#58665a] hover:bg-white">Restart preview</button></div>{reviewOpen && <div className="mx-auto mt-8 max-w-3xl rounded-2xl border border-[#e4ded1] bg-white p-4 text-left sm:p-6"><h3 className="font-serif text-2xl text-[#233b2e]">Your answer review</h3><p className="mt-2 text-xs leading-5 text-[#85877c]">Choose Edit to return to a question. Answers are still stored only in this browser.</p><div className="mt-4 space-y-3">{questions.map((q) => { const raw = answers[q.id]; const value = Array.isArray(raw) ? raw.map((v: any) => typeof v === "object" ? Object.values(v).filter(Boolean).join(" — ") : ((q.options ?? []).find((o) => o.value === v)?.label ?? v)).filter(Boolean).join(", ") : typeof raw === "string" ? ((q.options ?? []).find((o) => o.value === raw)?.label ?? raw) : ""; const subValues = Object.keys(answers).filter((key) => key.startsWith(q.id + ":") && !blank(answers[key])).map((key) => { const v = answers[key]; return q.options?.find((o) => o.value === v)?.label ?? (Array.isArray(v) ? v.map((item: string) => q.parts?.flatMap((p) => p.options).find((o) => o.value === item)?.label ?? item).join(", ") : String(v)); }); const shown = [value, ...subValues].filter(Boolean).join(" · "); return <div key={q.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[#eee9df] p-3"><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-[#354a3b]">{q.number}. {q.prompt}</p><p className="mt-1 break-words text-xs leading-5 text-[#7b8177]">{shown || "Not answered"}</p></div><button type="button" onClick={() => {setIndex(q.number - 1); setStage("questions"); setReviewOpen(false); setWelcomeOpen(false); window.scrollTo({top:0,behavior:"smooth"});}} className="rounded-full border border-[#dcd6c9] px-3 py-2 text-[11px] font-semibold text-[#52675a] hover:bg-[#faf8f3]">Edit</button></div>;})}</div></div>}</div>}

              {stage !== "complete" && <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[#eee9df] pt-5"><button type="button" onClick={previous} className="inline-flex items-center gap-2 rounded-full border border-[#dcd6c9] px-4 py-3 text-xs font-semibold text-[#58665a] transition hover:bg-[#faf8f3]"><Icon name="back" className="h-4 w-4"/> Previous</button><div className="hidden items-center gap-2 text-[10px] text-[#99988d] sm:flex"><Icon name="save" className="h-4 w-4"/>{hydrated ? "Preview progress stored in this browser only" : "Preparing local preview"}</div><button type="button" onClick={next} className="group inline-flex items-center gap-3 rounded-full bg-[#1b3b2b] px-5 py-3.5 text-xs font-semibold text-white shadow-[0_6px_18px_rgba(27,59,43,.16)] transition hover:-translate-y-0.5 hover:bg-[#2a5540]">{stage === "ack" ? "Finish preview" : "Continue"}<span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 transition group-hover:translate-x-0.5"><Icon name="arrow" className="h-3.5 w-3.5"/></span></button></div>}
            </div>
          </div>
          <p className="mt-4 text-center text-[10px] leading-5 text-[#929187]">Preview mode only · Answers remain in this browser until you export or reset them. No backend, invitation token, email, AI service, or production data is connected.</p>
        </section>

        <aside className="space-y-4">
          <div className="rounded-3xl border border-[#e4ded1] bg-white p-5 shadow-[0_8px_28px_rgba(28,42,33,.035)]">
            <div className="flex items-center gap-2"><div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#e9eee6] text-[#315642]"><Icon name="spark"/></div><div><p className="text-sm font-semibold text-[#344a39]">Your discovery guide</p><p className="text-[10px] text-[#9b9c91]">Experience prototype</p></div></div>
            <div className="mt-4 rounded-2xl rounded-tl-md bg-[#f5f4ee] p-3.5 text-xs leading-6 text-[#667166]">Namaste. We’ll take this one step at a time. If a question feels unclear, open the explanation below. You can move back and change your answers in this preview.</div>
            <button type="button" onClick={() => {setGuideMessage(getGuideText());setHelpOpen(!helpOpen);}} className="mt-3 flex w-full items-center justify-between rounded-xl border border-[#e4ded1] px-3 py-3 text-left text-xs font-semibold text-[#536a58] hover:bg-[#faf8f3]"><span className="flex items-center gap-2"><Icon name="help"/> Explain this question</span><Icon name="chev" className={helpOpen ? "rotate-180 transition" : "transition"}/></button>
            {helpOpen && <div className="mt-3 rounded-2xl border border-[#dce5d9] bg-[#f3f7f1] p-3.5 text-xs leading-6 text-[#5e705f]">{guideMessage}<p className="mt-2 text-[10px] font-semibold uppercase tracking-[.1em] text-[#8a947f]">Example guidance only · not connected to an AI service</p></div>}
            {resumeAvailable && <div className="mt-3 rounded-xl border border-[#d8e5d7] bg-[#f1f7ef] p-3 text-xs leading-5 text-[#46624b]"><strong>Welcome back.</strong> Your earlier preview answers were restored from this browser. You can continue, edit chapters, or restart the preview.</div>}
            <div className="mt-4 border-t border-[#eee9df] pt-4"><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#99917f]">Voice guidance</p><button type="button" onClick={speakCurrent} className="mt-2 flex w-full items-center gap-3 rounded-xl bg-[#1e3d2d] p-3 text-left text-white transition hover:bg-[#2b5740]"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10"><Icon name="mic"/></span><span><span className="block text-xs font-semibold">Hear this question</span><span className="mt-1 block text-[10px] text-white/60">Browser speech playback</span></span></button><p className="mt-2 text-[10px] leading-5 text-[#929187]">{voiceMessage} This is not conversational AI or a recorded human voice.</p></div>
          </div>
          <div className="rounded-3xl border border-[#e4ded1] bg-[#f9f7f1] p-5">
            <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#9a8354]">A little reassurance</p><p className="mt-3 font-serif text-xl leading-snug text-[#344a39]">You don’t need perfect answers.</p><p className="mt-2 text-xs leading-6 text-[#7c8176]">Share what you know today. Unknowns and evidence gaps can be identified separately instead of guessed.</p>
          </div>
          <div className="rounded-3xl bg-[#e9eee6] p-5"><div className="flex items-center gap-2 text-[#345740]"><Icon name="check"/><p className="text-xs font-semibold">What this preview covers</p></div><ul className="mt-3 space-y-2 text-xs leading-5 text-[#69786a]"><li>• All 16 source chapters</li><li>• 235 source-mapped question headings</li><li>• Complex and multi-part controls</li><li>• 20 supporting-document statuses</li><li>• Local save/resume for review</li><li>• Closing acknowledgement screen</li></ul></div>
        </aside>
      </div>

      {showReset && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#142d25]/55 p-4 backdrop-blur-sm"><div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#f8eee4] text-[#9b5e4e]"><Icon name="reset"/></div><h2 className="mt-4 font-serif text-2xl text-[#233b2e]">Restart the preview?</h2><p className="mt-2 text-sm leading-6 text-[#747b72]">This clears only the answers saved in this browser preview. It does not affect production data.</p><div className="mt-6 flex gap-3"><button type="button" onClick={() => setShowReset(false)} className="flex-1 rounded-full border border-[#dcd6c9] px-4 py-3 text-xs font-semibold text-[#58665a]">Cancel</button><button type="button" onClick={resetPreview} className="flex-1 rounded-full bg-[#1b3b2b] px-4 py-3 text-xs font-semibold text-white">Clear preview</button></div></div></div>}
      <div className="fixed bottom-5 right-4 z-40 flex flex-col items-end gap-3 sm:bottom-7 sm:right-7">{guideOpen && <section aria-label="Brand discovery guide" className="flex max-h-[min(72vh,640px)] w-[min(92vw,390px)] flex-col overflow-hidden rounded-[26px] border border-[#d8d0bd] bg-[#fffdf8] shadow-[0_22px_80px_rgba(20,45,37,.24)]"><header className="bg-[#173329] px-5 py-4 text-white"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#d5bd86]">Your discovery companion</p><h2 className="mt-1 font-serif text-xl">Need a little help?</h2><p className="mt-1 text-[11px] leading-5 text-white/65">Question-specific guidance, in simple language.</p></div><button type="button" aria-label="Close guide" onClick={() => setGuideOpen(false)} className="rounded-full p-2 text-white/80 hover:bg-white/10">×</button></div></header><div className="border-b border-[#e9e2d5] bg-[#f7f4ec] px-4 py-2 text-[10px] leading-4 text-[#7c7a6d]">AI is disabled by default. Until explicitly configured and approved, replies use local guidance only; no AI API is called.</div><div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite"><div className="max-w-[92%] rounded-2xl rounded-tl-sm bg-[#eef2e9] px-3.5 py-3 text-xs leading-5 text-[#405546]">Namaste! I can help explain the current question, what it is asking, and how to answer honestly. You do not need to guess or share confidential details you do not have.</div>{guideChat.map((item, i) => <div key={i} className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-3.5 py-3 text-xs leading-5 ${item.role === "user" ? "ml-auto rounded-tr-sm bg-[#1c3b2c] text-white" : "rounded-tl-sm bg-[#eef2e9] text-[#405546]"}`}>{item.content}</div>)}{guideBusy && <p className="text-xs text-[#777b70]">Preparing guidance…</p>}</div><form className="flex gap-2 border-t border-[#e9e2d5] p-3" onSubmit={(event) => {event.preventDefault(); void sendGuideMessage();}}><input value={guideInput} onChange={(event) => setGuideInput(event.target.value)} aria-label="Ask the discovery guide" maxLength={600} placeholder="Ask about this question…" className="min-w-0 flex-1 rounded-full border border-[#ddd6c7] bg-white px-4 py-3 text-xs outline-none focus:border-[#a68b56]"/><button disabled={guideBusy || !guideInput.trim()} type="submit" className="rounded-full bg-[#1c3b2c] px-4 py-3 text-xs font-semibold text-white disabled:opacity-40">Ask</button></form><div className="px-4 pb-3 text-[10px] leading-4 text-[#8b897d]">Do not treat guidance as verification. Your answers remain self-reported.</div></section>}<button type="button" onClick={() => setGuideOpen((value) => !value)} aria-expanded={guideOpen} className="flex items-center gap-3 rounded-full border border-[#d7c69f] bg-[#1c3b2c] px-5 py-4 text-left text-white shadow-[0_10px_35px_rgba(20,45,37,.28)] transition hover:-translate-y-0.5"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#d5bd86] text-[#173329]"><Icon name="spark"/></span><span><span className="block text-sm font-semibold">Discovery guide</span><span className="block text-[10px] text-white/65">Help with this question</span></span></button></div>
      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } } html { scroll-behavior: smooth; } `}</style>
    </main>
  );
}
