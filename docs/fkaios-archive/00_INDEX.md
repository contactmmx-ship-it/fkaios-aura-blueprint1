# FKAIOS archive: every available FKAIOS conversation and record, in one place

**Built:** 7 Oct 2026 · **Read order:** oldest first · **Summary of all of this:** `../FKAIOS_MASTER_SOURCE_OF_TRUTH.md`

This folder is the **raw layer**: the conversations and records themselves, verbatim.
The master source of truth is the **reconciled layer** built from it.
`FKAIOS_ALL_CHATS_MERGED.md` is everything below combined into one file.

| # | File | What it is | Dates | Source |
|---|---|---|---|---|
| 01 | `01_repo_history_documents_2026-06-29_to_10-06.md` | 41 FKAIOS status, handoff, checkpoint, audit, plan and constitution documents, written into the repo by Claude, Claude Code and other tools, full text in date order | 29 Jun → 6 Oct | GitHub repo |
| 02 | `02_chatgpt_conversations_pasted.md` | The two ChatGPT FKAIOS conversations Rajeev pasted on 7 Oct, verbatim | → 7 Oct | ChatGPT |
| 02b | `02b_gomax_brief_uploaded_2026-10-04.md` | The GoMax recovery brief and patch Rajeev uploaded (prepared in ChatGPT) | 4 Oct | ChatGPT → Claude Code |
| 03 | `03_claude_code_session_2026-10-04_to_07.md` | Full transcript of Claude Code session 210c0e58: GoMax recovery, PRs #25–#28, and building this archive (the latest chat) | 4 → 7 Oct | Claude Code |

## Not in this archive yet (no access from here)

- **ChatGPT conversations not pasted.** That includes the earliest FKAIOS chats (e.g. 28 Aug AURA recovery). ChatGPT history can't be read from Claude Code.
- **Claude.ai chats and other Claude Code sessions.** Their work appears in 01 (the docs they committed) and in the git history, but not their conversations.

**To add them:**
- **ChatGPT:** Settings → Data controls → Export data → download the zip from the email (`conversations.json` / `chat.html`).
- **Claude.ai:** Settings → Privacy → Export data.

Upload the zip(s) to a Claude Code session and ask for the FKAIOS conversations to be appended. They'll be filtered to FKAIOS only (SYROS and unrelated chats excluded), added as new numbered files in date order, merged into `FKAIOS_ALL_CHATS_MERGED.md`, and reconciled into the master source of truth.
