# EvalBench Task Checklist

---

## ✅ Phase 1: Python Backend Migration — COMPLETE

### Chunk 1: FastAPI Foundation
- [x] [requirements.txt](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/requirements.txt) + install deps
- [x] [backend/database.py](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/backend/database.py) (SQLAlchemy + FlexibleDateTime)
- [x] [backend/models.py](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/backend/models.py) (ORM tables)
- [x] [backend/schemas.py](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/backend/schemas.py) (Pydantic v2 camelCase)
- [x] [backend/main.py](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/backend/main.py) + [backend/routers/__init__.py](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/backend/routers/__init__.py)

### Chunk 2: Ollama Service
- [x] [backend/services/ollama.py](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/backend/services/ollama.py) (check_status, list_models, generate)
- [x] [backend/routers/ollama.py](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/backend/routers/ollama.py) (GET /api/ollama/status)

### Chunk 3: Models Routes
- [x] [backend/services/storage.py](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/backend/services/storage.py)
- [x] [backend/routers/models.py](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/backend/routers/models.py) (GET /api/models, POST /api/models/discover)

### Chunk 4: Arena Routes
- [x] Arena storage (battles, ELO math)
- [x] [backend/routers/arena.py](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/backend/routers/arena.py) (matchup, vote, leaderboard)
- [x] Fix: camelCase mismatch (ArenaMatchupOut, ArenaVoteIn)
- [x] Fix: concurrent generate() with asyncio.gather

### Chunk 5: Eval Runs + Datasets Routes
- [x] [backend/routers/eval_runs.py](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/backend/routers/eval_runs.py)
- [x] [backend/routers/datasets.py](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/backend/routers/datasets.py)

### Chunk 6: Frontend Wiring
- [x] [vite.config.ts](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/vite.config.ts) — /api proxy to localhost:8001
- [x] [package.json](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/package.json) — concurrently dev scripts
- [x] [shared/routes.ts](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/shared/routes.ts) — Drizzle types → Zod schemas

### Chunk 7: Legacy Cleanup
- [x] Delete `server/`, `shared/schema.ts`, [drizzle.config.ts](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/drizzle.config.ts), `script/`
- [x] Remove 190 legacy npm packages (express, drizzle, passport, etc.)
- [x] Remove Replit-specific plugins

---

## ✅ Phase 2: Real Metrics Engine — COMPLETE

### 2.1 Python Scoring Engine
- [x] [backend/scoring/__init__.py](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/backend/scoring/__init__.py)
- [x] [backend/scoring/speed.py](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/backend/scoring/speed.py) — TPS, TTFT, total latency from Ollama response
- [x] [backend/scoring/rouge.py](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/backend/scoring/rouge.py) — ROUGE-1/2/L via `rouge-score`
- [x] [backend/scoring/bleu.py](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/backend/scoring/bleu.py) — SacreBLEU + chrF
- [x] [backend/scoring/meteor.py](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/backend/scoring/meteor.py) — METEOR via nltk
- [x] [backend/scoring/exact_match.py](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/backend/scoring/exact_match.py) — EM + Token F1 for QA
- [x] [backend/scoring/distinct.py](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/backend/scoring/distinct.py) — Distinct-n (no deps)
- [x] Update [requirements.txt](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/requirements.txt) with scoring deps

### 2.2 Eval Runner (Background Execution)
- [x] [backend/services/eval_runner.py](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/backend/services/eval_runner.py) — runs model+dataset pairs, writes results
- [x] Wire `POST /api/eval-runs` to trigger runner after creating DB record
- [x] `GET /api/eval-runs/{id}/progress` — SSE endpoint for real-time progress

### 2.3 Golden Datasets (Built-in)
- [x] 20-item summarization dataset (article→summary pairs)
- [x] 20-item QA dataset (context+question→answer triples)
- [x] [backend/services/dataset_seeder.py](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/backend/services/dataset_seeder.py) — runs at startup if empty
- [x] Main.py seeder hook at startup

### 2.4 Task-Type Aware Eval Wizard
- [x] Replace Step 2 with task-type picker (6 cards: Summarize/QA/Chat/Translate/Code/Reasoning)
- [x] Each card shows auto-suggested metrics
- [x] Auto-selects matching built-in dataset
- [x] Fixed `isLoading` → `isPending` on run button

### 2.5 Run Details Page (Frontend)
- [x] [client/src/pages/RunDetails.tsx](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/client/src/pages/RunDetails.tsx) — results table with per-model metric scores
- [x] Live SSE progress bar while `status === "running"`
- [x] Register `/evaluate/:id` route in App.tsx
- [x] Fix Dashboard "View Details" link → `/evaluate/:id`
- [x] [client/src/hooks/use-datasets.ts](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/client/src/hooks/use-datasets.ts)
- [x] Show "Best & Worst" Generation Examples comparing prompt, golden truth, and actual model output

---

## ⬜ Phase 3: LLM-as-Judge + Benchmarks + Safety — PLANNED

- [ ] `backend/scoring/llm_judge.py` — G-Eval framework
- [ ] Settings page (Ollama host, judge model, API keys)
- [ ] `backend/benchmarks/` suite (MMLU, HellaSwag, ARC, GSM8K, HumanEval)
- [ ] Safety metrics (detoxify, TruthfulQA, BBQ)
- [ ] Statistical rigor (`backend/scoring/stats.py` — Wilson CI, McNemar)

---

## ⬜ Phase 4: Polish & Educational Layer — PLANNED

- [ ] "Learn" tab embedding fm_evaluation_metrics.html decision tree
- [ ] Dashboard Charts: Radar chart (multi-dimension) + Bar charts filtered by Task Type (easier to interpret)
- [ ] Head-to-head comparison view
- [ ] Dataset builder UI (manual entry + CSV/JSON upload)
- [ ] Export: CSV, JSON, Markdown
- [ ] Multi-provider support (Anthropic, Gemini, Groq)
