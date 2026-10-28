"use client";

import { useState } from "react";
import bank from "../../../config/brand-discovery/raahat-question-bank-v1.draft.json";

type Option = { value: string; label: string };
type Question = {
  id: string;
  number: number;
  prompt: string;
  type: string;
  required?: boolean;
  help_text?: string;
  options?: Option[];
  selection_mode?: "single" | "multiple";
  selection_instruction?: string;
  explanation_prompt?: string;
  optional_explanation?: boolean;
  parts?: Array<{ id: string; label: string; instruction?: string; selection_mode?: "single" | "multiple"; options: Option[] }>;
  row_prompt?: string;
  row_label?: string;
  service_options?: Option[];
  status_options?: Option[];
  service_instruction?: string;
  status_instruction?: string;
};
type Section = { id: string; title: string; intro?: string; questions: Question[] };

const sections = (bank as unknown as { sections: Section[] }).sections;
const questions = sections.flatMap((section, sectionIndex) =>
  section.questions.map((question) => ({ ...question, sectionTitle: section.title, sectionIndex }))
);

export default function BrandDiscoveryPreviewPage() {
  const [index, setIndex] = useState(0);
  const [choices, setChoices] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>({});
  const [showSections, setShowSections] = useState(false);
  const question = questions[index];
  const section = sections[question.sectionIndex];
  const progress = Math.round(((index + 1) / questions.length) * 100);
  const selected = choices[question.id] ?? [];
  const choiceOptions = question.options ?? [];

  const toggleChoice = (value: string) => {
    setChoices((current) => {
      const old = current[question.id] ?? [];
      const next = question.selection_mode === "multiple"
        ? (old.includes(value) ? old.filter((item) => item !== value) : [...old, value])
        : (old.includes(value) ? [] : [value]);
      return { ...current, [question.id]: next };
    });
  };

  const goToSection = (sectionIndex: number) => {
    const nextIndex = questions.findIndex((item) => item.sectionIndex === sectionIndex);
    if (nextIndex >= 0) setIndex(nextIndex);
    setShowSections(false);
  };

  return (
    <main className="min-h-screen bg-[#f5f3ef] px-4 py-6 text-slate-900 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#173f35] text-lg font-bold text-white">FK</div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#477367]">Franchise Kart</p>
              <p className="text-sm text-slate-600">Brand Discovery Experience</p>
            </div>
          </div>
          <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900">PREVIEW ONLY · NOT LIVE</span>
        </div>

        <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
          <p className="font-semibold text-amber-950">Safe preview — nothing is being submitted or saved.</p>
          <p className="mt-1 text-sm leading-6 text-amber-900">Explore the recovered Raahat questionnaire wording and answer controls. Any selections stay temporarily in this browser page only. This is not Raahat’s invitation link and does not connect to the production database.</p>
        </section>

        <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Questionnaire</p>
            <h1 className="mt-2 text-xl font-semibold">Raahat</h1>
            <p className="mt-1 text-sm text-slate-500">Karnal · Hospitality</p>
            <div className="mt-5 flex items-end justify-between gap-2">
              <span className="text-sm text-slate-600">Progress preview</span>
              <span className="text-sm font-semibold tabular-nums">{progress}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-[#2d6a58] transition-all" style={{ width: progress + "%" }} />
            </div>
            <p className="mt-2 text-xs text-slate-500">Question {index + 1} of {questions.length}</p>
            <button type="button" onClick={() => setShowSections((value) => !value)} className="mt-5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-left text-sm font-medium hover:bg-slate-50">
              {showSections ? "Hide sections" : "Browse all 16 sections"} <span className="float-right">⌄</span>
            </button>
            {showSections && <nav className="mt-3 max-h-[420px] space-y-1 overflow-auto">
              {sections.map((item, sectionIndex) => (
                <button key={item.id} type="button" onClick={() => goToSection(sectionIndex)} className={"w-full rounded-lg px-3 py-2 text-left text-sm " + (question.sectionIndex === sectionIndex ? "bg-[#e7f0ec] font-semibold text-[#173f35]" : "text-slate-600 hover:bg-slate-50")}>
                  {sectionIndex + 1}. {item.title}
                </button>
              ))}
            </nav>}
            <div className="mt-6 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">
              <p className="font-semibold text-slate-700">Private by design</p>
              <p>FK’s internal analysis and recommendations are not part of the respondent view.</p>
            </div>
          </aside>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
            <div className="mb-7">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#477367]">Section {question.sectionIndex + 1} of {sections.length}</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-700">{section.title}</h2>
              <div className="mt-5 h-px bg-slate-100" />
            </div>

            <div className="mb-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">Question {question.number}</span>
                {question.required && <span className="text-xs font-medium text-rose-700">Required</span>}
              </div>
              <h3 className="mt-4 text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">{question.prompt}</h3>
              {question.help_text && <p className="mt-3 text-sm leading-6 text-slate-600">{question.help_text}</p>}
              {question.selection_instruction && <p className="mt-3 text-sm font-medium text-slate-600">{question.selection_instruction}</p>}
            </div>

            {choiceOptions.length > 0 && (
              <div className="space-y-3">
                {choiceOptions.map((option) => {
                  const active = selected.includes(option.value);
                  return <button key={option.value} type="button" aria-pressed={active} onClick={() => toggleChoice(option.value)} className={"flex w-full items-start gap-3 rounded-xl border p-4 text-left transition " + (active ? "border-[#2d6a58] bg-[#edf5f1] ring-1 ring-[#2d6a58]" : "border-slate-200 bg-white hover:border-slate-400 hover:bg-slate-50")}>
                    <span className={"mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-" + (question.selection_mode === "multiple" ? "md" : "full") + " border " + (active ? "border-[#2d6a58] bg-[#2d6a58] text-white" : "border-slate-300 text-transparent")}>{active ? "✓" : "·"}</span>
                    <span className="text-sm leading-6 text-slate-800">{option.label}</span>
                  </button>;
                })}
              </div>
            )}

            {question.type === "multi_part" && question.parts?.map((part) => (
              <div key={part.id} className="mb-5 rounded-xl border border-slate-200 p-4">
                <p className="font-semibold">{part.label}</p>
                {part.instruction && <p className="mt-1 text-sm text-slate-500">{part.instruction}</p>}
                <div className="mt-3 space-y-2">
                  {part.options.map((option) => {
                    const key = question.id + ":" + part.id;
                    const active = (choices[key] ?? []).includes(option.value);
                    return <button key={option.value} type="button" aria-pressed={active} onClick={() => setChoices((current) => ({ ...current, [key]: active ? (current[key] ?? []).filter((v) => v !== option.value) : [...(current[key] ?? []), option.value] }))} className={"w-full rounded-lg border px-3 py-2.5 text-left text-sm " + (active ? "border-[#2d6a58] bg-[#edf5f1]" : "border-slate-200 hover:bg-slate-50")}>{active ? "✓ " : "○ "}{option.label}</button>;
                  })}
                </div>
              </div>
            ))}

            {choiceOptions.length === 0 && question.type !== "multi_part" && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <label htmlFor={"answer-" + question.id} className="mb-2 block text-sm font-medium text-slate-700">
                  {question.type === "long_text" ? "Your response" : question.type === "repeatable_list" ? "Add an item (preview)" : question.type === "file_or_text" ? "Document note (preview)" : question.row_prompt ?? question.service_instruction ?? "Your response (preview)"}
                </label>
                {question.type === "long_text" || question.type === "text" || question.type === "file_or_text" ? (
                  <textarea id={"answer-" + question.id} rows={question.type === "long_text" ? 5 : 3} value={textAnswers[question.id] ?? ""} onChange={(event) => setTextAnswers((current) => ({ ...current, [question.id]: event.target.value }))} placeholder="Type here to preview the answer field…" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-[#2d6a58] focus:ring-2 focus:ring-[#2d6a58]/20" />
                ) : (
                  <p className="text-sm leading-6 text-slate-600">This question uses a structured answer control in the full questionnaire. This preview shows the question wording; the live save/submit flow is intentionally disabled.</p>
                )}
              </div>
            )}

            {(question.optional_explanation || question.explanation_prompt) && (
              <div className="mt-5">
                <label htmlFor={"note-" + question.id} className="mb-2 block text-sm font-medium text-slate-700">{question.explanation_prompt ?? "Additional details (optional)"}</label>
                <textarea id={"note-" + question.id} rows={3} value={notes[question.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [question.id]: event.target.value }))} placeholder="Optional clarification…" className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none focus:border-[#2d6a58] focus:ring-2 focus:ring-[#2d6a58]/20" />
                <p className="mt-1 text-xs text-slate-500">Optional — you can leave this blank.</p>
              </div>
            )}

            <div className="mt-9 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
              <button type="button" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">← Previous</button>
              <p className="text-center text-xs text-slate-500">Preview interactions only · no autosave</p>
              <button type="button" onClick={() => setIndex((value) => Math.min(questions.length - 1, value + 1))} disabled={index === questions.length - 1} className="rounded-xl bg-[#173f35] px-5 py-3 text-sm font-semibold text-white hover:bg-[#245748] disabled:cursor-not-allowed disabled:opacity-40">{index === questions.length - 1 ? "End of preview" : "Next question →"}</button>
            </div>
          </section>
        </div>
        <footer className="mt-6 text-center text-xs leading-5 text-slate-500">Draft questionnaire · source-mapped wording · not approved for respondent distribution</footer>
      </div>
    </main>
  );
}
