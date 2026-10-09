#!/usr/bin/env python3
"""Regenerates supabase/functions/_shared/history-corpus.generated.ts from input/fkaios-history/.
Run from the repository root: python3 tools/generate-history-corpus.py"""
import hashlib, json

FILES = [
    ("3a1f14b4-fkaios_chats.txt", "input/fkaios-history/fkaios_chats.txt", "ChatGPT Master Historical Transfer (7 Oct 2026)", "docs/fkaios-archive/02_chatgpt_conversations_pasted.md"),
    ("c9f742e0-fkaios_chat_2.txt", "input/fkaios-history/fkaios_chat_2.txt", "ChatGPT AI learning and FKAIOS-Lite design (5-7 Oct 2026)", "docs/fkaios-archive/02a_chatgpt_ai_learning_and_fkaios_lite_2026-10-05_to_07.md"),
]
out = ["// GENERATED from input/fkaios-history/ by tools/generate-history-corpus.py — do not edit.",
       "// The founder-supplied ChatGPT histories, bundled so the knowledge library can ingest",
       "// them through ingestText() (idempotent by SHA-256). Loaded with a dynamic import only",
       "// by the history_ingest self-test, so ordinary ticks never parse this module.",
       "export const HISTORY_CORPUS: Array<{ uploadName: string; repoPath: string; archivePath: string; description: string; sha256: string; text: string }> = ["]
for up, path, desc, arch in FILES:
    raw = open(path, "rb").read()
    out.append(f"  {{ uploadName: {json.dumps(up)}, repoPath: {json.dumps(path)}, archivePath: {json.dumps(arch)}, description: {json.dumps(desc)}, sha256: {json.dumps(hashlib.sha256(raw).hexdigest())},\n    text: {json.dumps(raw.decode('utf-8'), ensure_ascii=False)} }},")
out.append("];\n")
open("supabase/functions/_shared/history-corpus.generated.ts", "w").write("\n".join(out))
