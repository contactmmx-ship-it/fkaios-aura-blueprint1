# FKAIOS local history collector

This utility prepares local, FKAIOS-compatible knowledge archives from files the founder has already downloaded or saved. It does not sign in to AI services, scrape private accounts, upload data, or change source files.

## What it reads

- Official ChatGPT data exports containing conversations.json.
- Claude exports containing conversations.json or JSON conversation records with chat_messages / messages.
- Local .txt, .md, .csv, .log, .html, .htm, and .json files.
- ZIP archives containing those supported files.

Unsupported binary formats (PDF, DOCX, XLSX, images, etc.) are skipped in this first version. They are not deleted or modified. Do not put passwords, browser profiles, session cookies, .env files, or secret files in the watched folders. Common API-token patterns are redacted from generated text as an additional safeguard; this is not a guarantee that every secret format can be detected.

## Windows use

Install Python 3.10 or newer. Open PowerShell in the repository folder and run a one-time scan:

~~~powershell
python tools/fkaios_history_collector.py --watch-dir "$env:USERPROFILE\Downloads"
~~~

To include a locally synced FK Work Library folder, add another --watch-dir argument with that folder's actual path:

~~~powershell
python tools/fkaios_history_collector.py --watch-dir "$env:USERPROFILE\Downloads" --watch-dir "D:\path\to\FK Work Library"
~~~

To keep monitoring those folders every 60 seconds:

~~~powershell
python tools/fkaios_history_collector.py --watch-dir "$env:USERPROFILE\Downloads" --watch-dir "D:\path\to\FK Work Library" --watch
~~~

The collector stores generated ZIPs and a small scan-state file under %USERPROFILE%\FKAIOS-Collector\ready. Watch mode only reprocesses files whose size or modification time changed. The source files are left in place.

## Import into FKAIOS

The output ZIP contains manifest.json plus one Markdown file per conversation/document. Its manifest matches the existing knowledge-bulk-ingest format. The importer records the originating tool and document type, so Claude and local files are not mislabeled as ChatGPT.

This PR only prepares the archive. It does not upload or ingest it. Upload still requires the existing authorised FKAIOS ingestion path and its server-held key; never put fkaios_ingest_keys values or Supabase service-role keys on the Windows PC. No database migration, production data write, or paid AI call is part of this collector.
