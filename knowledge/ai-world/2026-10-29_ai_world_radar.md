# AI World Radar: 2026-10-29

Domain: AI WORLD (outer-world knowledge). First digest, prepared on 2026-10-29 from the live World Radar data and the arXiv feed; from the next deploy the radar writes this page itself every day.
Use it when an objective needs a new model, tool, repo or research idea. Finds are metadata only: not installed, not tested yet. Claims are the publishers' own.

## New tools and models that fit a project need (8)
- SylphxAI/anymd (repository), score 12. Turns any file (PDF, Word, PowerPoint, Excel, images via OCR, audio/video transcripts) into clean Markdown for agents. Fits: knowledge library PDFs; eBill2Tally bill scanning; SYROS/Rajeev AI transcripts; client proposals.
- snapotter-hq/SnapOtter (repository), score 9. Fits: SYROS OPD dictation, Rajeev AI call agent; eBill2Tally bill scanning.
- 2kw.ai (MCP server), score 8. Fits: speech-to-text and document OCR as a hosted MCP tool.
- dengxibo/sumatrapdf-plus (repository), score 7. Fits: PDF reading with text-to-speech; knowledge library PDFs.
- baidu/Unlimited-OCR (model, MIT), score 6. Multilingual OCR vision-language model. Fits: eBill2Tally bill scanning, knowledge library PDFs.
- modelscope/FunASR (repository, MIT), score 6. Open speech-recognition toolkit. Fits: SYROS OPD dictation, Rajeev AI call agent (Hindi support to be tested).
- ocrmypdf/OCRmyPDF (repository), score 6. Adds a text layer to scanned PDFs. Fits: knowledge library PDFs, eBill2Tally.
- liquid/lfm-2.5-2.6b:free (OpenRouter free model), score 6. Fits: no-stop rule (another free model when a quota ends); light memory/retrieval tasks.
Also worth testing (score 5): browser-use/browser-use (dealer and franchise prospect research for Gio Paints, GoMax), infiniflow/ragflow (memory over the 622 chats).

## New research papers in the founder's interest areas (8, arXiv cs.AI/cs.LG/cs.CL, newest on 2026-10-29)
- GEPA-Curator: Curated Learning for Self Improving Agents (https://arxiv.org/abs/2610.37651).
  Direction: self-improving agents; learning from experience.
  Crux: agents that learn from failed runs should first separate real lessons from noise (prompt weakness, harness limits, random execution, noisy judges). Lesson for FKAIOS: only verified outcomes should become lessons.
- From Interaction to Capability: Task Advancement as State and Supervision for GUI Agents (https://arxiv.org/abs/2610.37482).
  Direction: computer-use agents; memory.
  Crux: a GUI agent's memory should store verified task progress and learn reusable operations from long workflows. Could help: FKAIOS objective loop, dealer research with browser agents.
- ETAMem: Decoupling and Aligning Heterogeneous Memory for Long-Term Conversational Agents (https://arxiv.org/abs/2610.37443).
  Direction: memory and continual learning.
  Crux: long-term memory works better when different kinds of information are stored separately and organised by more than semantic similarity. Could help: FKAIOS one brain (brand knowledge vs AI World knowledge).
- Understanding the limits of latent world models (https://arxiv.org/abs/2610.37588).
  Direction: world models and prediction.
  Crux: good task scores do not prove a world model has learned how the environment really works; proposes tests for faithful predictive models.
- ThinkWorld: World Imagination Reinforces Chain-of-Dynamics Reasoning (https://arxiv.org/abs/2610.37666).
  Direction: world models; learning from experience (human videos).
  Crux: imagining how the world will change, learned from human videos, improves an agent's action reasoning.
- Can LLMs Uncover Hidden Physical Laws through Free Exploration? (https://arxiv.org/abs/2610.37649).
  Direction: learning from experience; discovery without being told what to look for (the David Silver idea).
  Crux: tests whether models notice unexpected behaviour in a simulated world and discover the rule through their own experiments.
- Collective Dynamics of Self-Reinforcement: How Cross-Task Coupling Drives Policy Collapse in Unsupervised RLVR (https://arxiv.org/abs/2610.37553).
  Direction: learning from experience (reinforcement learning).
  Crux: a model rewarded for agreeing with itself first improves, then collapses. Lesson for FKAIOS: self-grading is not learning; use an independent verifier.
- Concordat: Typed Sessions for LLM Agents (https://arxiv.org/abs/2610.37461).
  Direction: agent safety and governance.
  Crux: rules for consequential actions (refunds, cancellations, changes) enforced in code, not only in the prompt. Could help: FKAIOS approvals and the "money, secrets, irreversible actions need founder approval" rule.
