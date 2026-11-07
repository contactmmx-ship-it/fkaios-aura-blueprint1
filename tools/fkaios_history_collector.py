#!/usr/bin/env python3
"""Build FKAIOS-ready archives from official AI exports and local text files.

Local-only: no network calls, credentials, account scraping, or source modifications.
"""
from __future__ import annotations
import argparse, hashlib, html, json, os, re, time, zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

MAX_FILE = 50 * 1024 * 1024
MAX_MEMBER = 25 * 1024 * 1024
MAX_MEMBERS = 5000
TEXT_EXT = {".txt", ".md", ".markdown", ".csv", ".log", ".html", ".htm", ".json"}
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build", "FKAIOS-Collector"}
SKIP_NAMES = {".env", ".env.local", ".env.production", "credentials.json", "secrets.json", "collector-state.json"}
SECRETS = [
    re.compile(r"(?i)sk-[A-Za-z0-9_-]{20,}"),
    re.compile(r"(?i)gh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(r"(?i)xox[baprs]-[A-Za-z0-9-]{15,}"),
    re.compile(r"(?i)AIza[0-9A-Za-z_-]{30,}"),
    re.compile(r"(?i)((?:api[_-]?key|access[_-]?token|secret[_-]?key)\s*[:=]\s*['\"]?)[A-Za-z0-9._/-]{16,}"),
]

def redact(text: str) -> str:
    for pattern in SECRETS:
        text = pattern.sub(lambda m: (m.group(1) if m.lastindex else "") + "[REDACTED_SECRET]", text)
    return text

def content_text(value: Any) -> str:
    if value is None: return ""
    if isinstance(value, str): return value
    if isinstance(value, list): return "\n".join(content_text(v) for v in value)
    if isinstance(value, dict):
        if isinstance(value.get("text"), str): return value["text"]
        if isinstance(value.get("parts"), list): return "\n".join(content_text(v) for v in value["parts"])
        if isinstance(value.get("content"), (str, list)): return content_text(value["content"])
    return ""

def date_text(value: Any) -> str:
    try:
        n = float(value)
        if n > 10_000_000_000: n /= 1000
        return datetime.fromtimestamp(n, timezone.utc).isoformat()
    except (TypeError, ValueError, OverflowError, OSError):
        return str(value or "")

def parse_chatgpt(data: Any, origin: str) -> list[dict]:
    if isinstance(data, dict) and isinstance(data.get("conversations"), list): data = data["conversations"]
    if not isinstance(data, list): return []
    out = []
    for conv in data:
        if not isinstance(conv, dict): continue
        messages = []
        mapping = conv.get("mapping") or {}
        if isinstance(mapping, dict):
            for node in mapping.values():
                msg = node.get("message") if isinstance(node, dict) else None
                if not isinstance(msg, dict): continue
                author = msg.get("author") or {}
                role = author.get("role", "unknown") if isinstance(author, dict) else "unknown"
                body = content_text(msg.get("content"))
                if body.strip(): messages.append((msg.get("create_time") or 0, str(role), body))
        messages.sort(key=lambda x: x[0] or 0)
        if not messages: continue
        title = str(conv.get("title") or "Untitled ChatGPT conversation")
        lines = [f"# {title}", "", f"- Source: ChatGPT export ({origin})",
                 f"- Conversation ID: {conv.get('id', '')}", ""]
        for created, role, body in messages:
            lines += [f"## {role} — {date_text(created)}", "", body, ""]
        out.append({"title": title, "date": date_text(conv.get("create_time") or messages[0][0]),
                    "text": "\n".join(lines), "messages": len(messages), "tool": "ChatGPT"})
    return out

def parse_claude(data: Any, origin: str) -> list[dict]:
    if isinstance(data, dict):
        for key in ("conversations", "chats", "data"):
            if isinstance(data.get(key), list): data = data[key]; break
    if not isinstance(data, list): return []
    out = []
    for conv in data:
        if not isinstance(conv, dict): continue
        messages = conv.get("chat_messages") or conv.get("messages") or []
        if not isinstance(messages, list): continue
        title = str(conv.get("name") or conv.get("title") or "Untitled Claude conversation")
        lines = [f"# {title}", "", f"- Source: Claude export ({origin})",
                 f"- Conversation ID: {conv.get('uuid') or conv.get('id') or ''}", ""]
        count = 0
        for msg in messages:
            if not isinstance(msg, dict): continue
            role = msg.get("sender") or msg.get("role") or msg.get("type") or "unknown"
            body = content_text(msg.get("text") or msg.get("content") or msg.get("message"))
            if body.strip(): lines += [f"## {role}", "", body, ""]; count += 1
        if count:
            out.append({"title": title, "date": str(conv.get("created_at") or conv.get("createdAt") or ""),
                        "text": "\n".join(lines), "messages": count, "tool": "Claude"})
    return out

def parse_json_bytes(raw: bytes, origin: str) -> list[dict]:
    try: data = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError): return []
    chats = parse_chatgpt(data, origin)
    return chats or parse_claude(data, origin)

def generic_doc(name: str, raw: bytes) -> dict | None:
    try: body = raw.decode("utf-8-sig")
    except UnicodeDecodeError: return None
    suffix = Path(name).suffix.lower()
    if suffix in {".html", ".htm"}:
        body = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", body)
        body = html.unescape(re.sub(r"(?s)<[^>]+>", " ", body))
    if suffix == ".json":
        try: body = json.dumps(json.loads(body), ensure_ascii=False, indent=2)
        except json.JSONDecodeError: pass
    if not body.strip(): return None
    title = Path(name).stem or "Untitled document"
    return {"title": title, "date": "", "text": f"# {title}\n\n- Source file: {name}\n\n{body}",
            "messages": 0, "tool": "Local file"}

def read_zip(path: Path) -> list[dict]:
    out = []
    try:
        with zipfile.ZipFile(path) as z:
            members = [m for m in z.infolist() if not m.is_dir()]
            if len(members) > MAX_MEMBERS: return []
            total_uncompressed = 0
            for m in members:
                total_uncompressed += m.file_size
                if total_uncompressed > 250 * 1024 * 1024: return []
                p = PurePosixPath(m.filename)
                if p.is_absolute() or ".." in p.parts or p.name.lower() in SKIP_NAMES or m.file_size > MAX_MEMBER: continue
                if p.suffix.lower() not in TEXT_EXT: continue
                try: raw = z.read(m)
                except (RuntimeError, OSError, zipfile.BadZipFile): continue
                chats = parse_json_bytes(raw, f"{path.name}:{m.filename}") if p.suffix.lower() == ".json" else []
                if chats: out.extend(chats); continue
                doc = generic_doc(m.filename, raw)
                if doc: out.append(doc)
    except (OSError, zipfile.BadZipFile): return []
    return out

def read_file(path: Path) -> list[dict]:
    if path.is_symlink() or path.name.lower() in SKIP_NAMES or path.stat().st_size > MAX_FILE: return []
    if path.suffix.lower() == ".zip": return read_zip(path)
    if path.suffix.lower() not in TEXT_EXT: return []
    raw = path.read_bytes()
    if path.suffix.lower() == ".json":
        chats = parse_json_bytes(raw, str(path))
        if chats: return chats
    doc = generic_doc(str(path), raw)
    return [doc] if doc else []

def iter_files(roots: list[Path]):
    for root in roots:
        if root.is_symlink() or not root.is_dir(): continue
        for current, dirs, names in os.walk(root, followlinks=False):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not (Path(current) / d).is_symlink()]
            for name in names:
                path = Path(current) / name
                if not path.is_symlink() and name.lower() not in SKIP_NAMES: yield path

def build_bundle(roots: list[Path], output: Path, project_ref: str = "HISTORY", processed: dict | None = None) -> dict[str, int]:
    output.mkdir(parents=True, exist_ok=True)
    manifest, docs, seen, scanned = [], {}, set(), 0
    output_resolved = output.resolve()
    for path in iter_files(roots):
        try:
            if path.resolve().is_relative_to(output_resolved):
                continue
        except (OSError, ValueError):
            continue
        scanned += 1
        try:
            stat = path.stat()
            signature = f"{stat.st_mtime_ns}:{stat.st_size}"
            key = str(path.resolve())
            if processed is not None and processed.get(key) == signature:
                continue
            items = read_file(path)
            if processed is not None:
                processed[key] = signature
        except (OSError, ValueError):
            continue
        for item in items:
            body = redact(item["text"]).strip()
            if not body: continue
            digest = hashlib.sha256((item["tool"] + "\0" + item["title"] + "\0" + body).encode()).hexdigest()
            doc_id = digest[:24]
            if doc_id in seen: continue
            seen.add(doc_id)
            docs[doc_id + ".md"] = body + "\n"
            manifest.append({
                "id": doc_id, "title": item["title"], "date": item["date"], "p": project_ref,
                "n": item["messages"], "source_tool": item["tool"], "source_label": item["tool"],
                "source_kind": "conversation" if item["messages"] else "document",
                "original_name": path.name, "source_sha256": hashlib.sha256(body.encode()).hexdigest()
            })
    if not manifest: return {"scanned": scanned, "documents": 0, "bundles": 0}
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    with zipfile.ZipFile(output / f"fkaios-history-{stamp}.zip", "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        for name, body in docs.items(): z.writestr(name, body)
    return {"scanned": scanned, "documents": len(manifest), "bundles": 1}

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--watch-dir", action="append", required=True, type=Path,
                   help="Folder to scan; repeat for Downloads and a locally synced FK Work Library.")
    p.add_argument("--output-dir", type=Path, default=Path.home() / "FKAIOS-Collector" / "ready")
    p.add_argument("--project-ref", default="HISTORY")
    p.add_argument("--watch", action="store_true", help="Rescan every 60 seconds.")
    args = p.parse_args()
    state_path = args.output_dir / "collector-state.json"
    try:
        processed = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}
    except (OSError, json.JSONDecodeError):
        processed = {}
    while True:
        result = build_bundle(args.watch_dir, args.output_dir, args.project_ref, processed)
        state_path.write_text(json.dumps(processed, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(result), flush=True)
        if not args.watch: break
        time.sleep(60)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
