# EvalBench: The Ultimate Implementation Plan
> *From Sad State → Winning State*
> **Date:** March 12, 2026 | **Author:** Antigravity

---

## Executive Summary

EvalBench was conceived as a local-first LLM evaluation workbench — the "LM Studio for evaluation." The audit reveals it is currently a **well-designed UI shell with zero functional backend**: models are hardcoded, scores are random, and Ollama is never called. The Node.js/PostgreSQL backend is a dead-end architecturally compared to what we actually need.

The winning version of EvalBench must:
1. **Actually talk to Ollama** and the models you download
2. **Compute real, established metrics** that you teach to students
3. **Support the full metric taxonomy** from [fm_evaluation_metrics.html](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/docs/superpowers/plans/fm_evaluation_metrics.html) — because that page is the perfect curriculum backbone for this app
4. **Be educational AND practical** — a student learning about BLEU can *run it live* on their local models

The plan below is organized into 4 phases, each with clear deliverables and a concrete definition of "done."

---

## What We Have vs. What We Need

| Dimension | Current State 😔 | Target State 🏆 |
|---|---|---|
| **Backend** | Node.js/Express + PostgreSQL | Python FastAPI + SQLite (local-first) |
| **Model Discovery** | 3 hardcoded strings | Live `GET /api/tags` from Ollama |
| **Arena Responses** | `[Simulated Output A]` | Real `POST /api/generate` calls |
| **Eval Scores** | `Math.random() * 50 + 20` | ROUGE, BLEU, BERTScore, METEOR, Pass@K |
| **Metric Selection** | "Pick benchmarks" (MMLU toggle) | Task-type aware metric picker aligned with fm_metrics.html |
| **Datasets** | "Coming soon" placeholder | Built-in subsets of MMLU/HumanEval/GSM8K + custom upload |
| **LLM-as-Judge** | Not present | G-Eval via local Ollama model or API key |
| **Educational Layer** | None | Inline metric explanations, the fm_metrics decision tree embedded |
| **Export** | None | CSV, JSON, Markdown |
| **Statistical Rigor** | None | Wilson CIs, McNemar significance tests |

---

## Phase 1: Foundation — Python Backend + Real Ollama Integration
> **Goal:** The app works for the first time. Models are real. Arena responses are real. No more random scores — just speed metrics to start.

### 1.1 Python FastAPI Migration (Already Planned in Detail)

The existing [docs/superpowers/plans/2026-03-12-python-backend-migration.md](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/docs/superpowers/plans/2026-03-12-python-backend-migration.md) is a complete, chunk-by-chunk implementation guide. **Execute it as written.** Key outputs:

- `backend/` replaces `server/` — FastAPI app with SQLAlchemy + SQLite
- `backend/services/ollama.py` — async httpx client for Ollama
- Vite proxy: `/api` → `http://localhost:8001`
- `concurrently` runs both Vite dev server + uvicorn together
- `server/`, [drizzle.config.ts](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/drizzle.config.ts), [shared/schema.ts](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/shared/schema.ts) are deleted after parity

**Completion criteria:** `GET /api/models` returns real Ollama models. The Models screen shows what you actually have installed.

### 1.2 Real Arena Responses

Once `backend/services/ollama.py` has the `generate()` function, wire `GET /api/arena/matchup` to call it. The arena becomes real: two models, the same prompt, real outputs, real votes.

**UI enhancement:** Add a **custom prompt input** field to the Arena screen. Right now prompts are hardcoded — users should be able to type their own.

**Completion criteria:** You can type a prompt in Arena, two of your installed Ollama models respond in real-time, and your vote updates ELO.

### 1.3 Speed & Infrastructure Metrics (Tier 1 — Always Auto-Run)

These require no reference data — perfect for filling the eval wizard with *real* numbers immediately:

| Metric | How to compute | Where |
|---|---|---|
| Tokens/second (TPS) | `(eval_count / eval_duration_ns) * 1e9` from Ollama response | `backend/scoring/speed.py` |
| Time to First Token (TTFT) | Ollama streaming: timestamp of first chunk | `backend/scoring/speed.py` |
| Total latency | `total_duration_ns / 1e9` from Ollama response | `backend/scoring/speed.py` |
| P50/P95/P99 latency | sample multiple runs, use `numpy.percentile` | Needs repeat-eval support |
| Peak memory | Parse `ollama ps` or Ollama model info | `backend/services/ollama.py` |

Ollama's non-streaming `POST /api/generate` response already includes `eval_count`, `eval_duration`, `prompt_eval_count`, `load_duration`, `total_duration` — we get speed metrics for free from every generate call.

**Completion criteria:** After running an eval, the results table shows TPS, TTFT, and total latency for every model. These are real numbers.

---

## Phase 2: Real Metrics Engine — Reference-Based Quality Metrics
> **Goal:** The eval wizard produces academically meaningful scores using the exact metrics from your fm_evaluation_metrics.html teaching resource.

### 2.1 Task-Type Aware Evaluation Wizard

The current wizard asks "pick benchmarks." This is wrong. The right model follows your [fm_evaluation_metrics.html](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/docs/superpowers/plans/fm_evaluation_metrics.html) decision tree:

**New Wizard Flow:**
1. **Select Models** (existing — keep it)
2. **Select Task Type** — this replaces the flat benchmark picker:
   - 📝 Summarization
   - 🌐 Translation
   - 💬 Chat / Open-Ended Generation
   - 🧠 Knowledge / QA
   - 💻 Code Generation
   - 🔢 Reasoning / Math
   - 🔒 Safety & Alignment *(Phase 3)*
3. **Auto-suggested Metrics** — based on task type, the wizard shows the appropriate metric set (mapped from fm_metrics.html)
4. **Dataset Selection** — built-in subset or custom upload
5. **Judge Configuration** *(Phase 3)*
6. **Run** — with SSE real-time progress bar

**Task → Metric mapping (from fm_evaluation_metrics.html):**

| Task Type | Primary Metrics | Secondary Metrics | Notes |
|---|---|---|---|
| Summarization | ROUGE-1, ROUGE-2, ROUGE-L | BERTScore | SummaC for faithfulness (Phase 3) |
| Translation | BLEU (SacreBLEU), chrF | METEOR, COMET | Always use SacreBLEU for reproducibility |
| Chat/Open-ended | Distinct-n, Repetition Rate | MAUVE, Self-BLEU | LLM-judge in Phase 3 |
| Knowledge QA | Exact Match, Token F1 | ROUGE-L, BERTScore | MMLU accuracy for academic benchmarks |
| Code Generation | Pass@1, Pass@10 | CodeBLEU | Execute code in sandbox |
| Reasoning/Math | Final Answer Accuracy | Pass@K, Self-Consistency | GSM8K, MATH benchmarks |
| Classification | Macro F1 | Accuracy, Cohen's Kappa | Warn on imbalanced data |

### 2.2 Python Metric Library Implementation

```
backend/scoring/
├── __init__.py
├── rouge.py        # rouge-score library
├── bleu.py         # sacrebleu library
├── meteor.py       # nltk
├── bertscore.py    # bert-score (lazy-loaded, heavy)
├── chrf.py         # sacrebleu
├── distinct.py     # custom (no deps)
├── exact_match.py  # custom normalization
├── code_exec.py    # subprocess-based pass@k
└── stats.py        # wilson_ci, mcnemar_test, bootstrap_ci
```

**Python dependencies to add to `requirements.txt`:**
```
rouge-score==0.1.2
sacrebleu==2.3.1
nltk==3.8.1
bert-score==0.3.13    # lazy-load only when requested
evaluate==0.4.1       # HuggingFace umbrella (ROUGE, BLEU, BERTScore)
numpy==1.26.4
scipy==1.13.0
sentence-transformers==3.0.0  # for semantic similarity (lazy-load)
```

**Key design rule:** BERTScore and sentence-transformers download ~400MB models on first use. These must be **lazy-loaded with a clear UI indicator**: "Downloading BERTScore model (first use, ~400MB)..."

### 2.3 Built-In Golden Datasets

Without reference data, ROUGE/BLEU cannot run. Ship curated subsets:

| Dataset | Task | Items | Source | Notes |
|---|---|---|---|---|
| CNN/DailyMail (100 samples) | Summarization | 100 article→summary pairs | HuggingFace `datasets` | Classic ROUGE benchmark |
| WMT 2014 EN-FR (100 pairs) | Translation | 100 sentence pairs | sacrebleu built-in | Standard BLEU test set |
| SQuAD v2 (100 QA pairs) | QA / Extraction | 100 question-context-answer | HuggingFace | EM + F1 standard |
| MMLU (200 questions) | Knowledge | 200 MCQ across 10 subjects | HuggingFace | Accuracy metric |
| HumanEval (30 problems) | Code | 30 Python coding problems | OpenAI | Pass@1 with sandbox execution |
| GSM8K (50 problems) | Math Reasoning | 50 grade-school word problems | HuggingFace | Final answer accuracy |

These seed the `golden_datasets` and `golden_items` tables at startup. The backend uses `datasets` library to download/cache them locally.

**Completion criteria:** A user can select "Summarization" in the wizard, pick CNN/DailyMail, run against two models, and get real ROUGE-1/2/L + BERTScore numbers comparing the two. The scores change depending on which models are selected, and they make sense relative to known baselines.

### 2.4 Real-Time Eval Progress via SSE

The Eval Wizard "Run" button must not immediately show "completed." It should:
1. Create the eval run (`POST /api/eval-runs` → `status: "running"`)
2. Stream progress via `GET /api/eval-runs/{id}/progress` (SSE)
3. For each dataset item + model: generate, score, write result to DB, emit event
4. Frontend: `EventSource` connection shows per-model progress bar with live scores appearing

---

## Phase 3: LLM-as-Judge + Academic Benchmarks + Safety
> **Goal:** The app can evaluate qualitative criteria that no reference-based metric captures. The metric coverage matches 90% of what fm_evaluation_metrics.html teaches.

### 3.1 LLM-as-Judge via G-Eval Framework

Following the G-Eval pattern from your fm_metrics.html and the original spec:

```python
# backend/scoring/llm_judge.py
class GEvalScorer:
    """G-Eval: chain-of-thought LLM evaluation with custom criteria"""
    
    def score(self, input: str, output: str, expected: str, 
              criteria: str, judge_model: str) -> JudgeScore:
        # 1. Generate evaluation steps via CoT
        # 2. Execute evaluation with those steps
        # 3. Return score (1-5) + reasoning
```

**Built-in criteria (from fm_metrics.html):**
- **Correctness** — factual accuracy vs. expected output
- **Helpfulness** — completeness and usefulness
- **Coherence** — logical flow and structure
- **Faithfulness** — does output stay grounded in context? (RAG use case)
- **Harmlessness** — no harmful content

**Custom criteria:** Users can write their own rubric in plain English: *"Is the medical terminology correct and are the dosages safe?"*

### 3.2 Settings Page

Required before any judge or API features work:

```
Settings
├── Ollama Connection
│   ├── Host (default: localhost)
│   └── Port (default: 11434)
├── Judge Configuration
│   ├── Default judge: [local Ollama model dropdown] or [API provider]
│   └── Prometheus 2 (local open-source judge) option
├── API Keys (stored encrypted in SQLite, never logged)
│   ├── OpenAI API Key
│   ├── Anthropic API Key
│   ├── Google Gemini API Key
│   └── Groq API Key
└── Performance
    ├── Max concurrent eval workers (1-8)
    └── Default sample size per benchmark
```

### 3.3 Full Academic Benchmark Suite

All from the backlog, implemented as `Benchmark` subclasses:

```
backend/benchmarks/
├── base.py          # Abstract Benchmark class
├── mmlu.py          # 57-subject knowledge (already partially seeded)
├── hellaswag.py     # Commonsense reasoning
├── arc.py           # ARC-Easy + ARC-Challenge
├── gsm8k.py         # Grade-school math
├── truthfulqa.py    # Hallucination/truthfulness
├── winogrande.py    # Pronoun resolution commonsense  
├── boolq.py         # Boolean yes/no QA
├── humaneval.py     # Python coding Pass@k
└── mbpp.py          # Basic Python problems
```

### 3.4 Safety & Alignment Metrics

From fm_evaluation_metrics.html's Safety section:
- **Toxicity detection** — integrate `detoxify` library
- **BBQ Bias benchmark** — social bias QA evaluation  
- **TruthfulQA** — measures tendency to generate falsehoods
- **Refusal rate** — % of harmful prompts correctly refused

### 3.5 Statistical Rigor (from Backlog)

```python
# backend/scoring/stats.py
def wilson_confidence_interval(successes, trials, confidence=0.95):
    """Results show: MMLU: 68.4% ± 3.2% (95% CI)"""

def mcnemar_test(results_a, results_b):
    """Is model A significantly better than B on these questions?"""

def bootstrap_ci(scores, n_resamples=1000):
    """Bootstrap CI for continuous metrics like ROUGE, BERTScore"""

def cohens_h(p1, p2):
    """Effect size for proportion differences"""
```

**UI impact:** All scores in the results table show: `72.4% ± 2.8%` — making results trustworthy instead of bare point estimates.

---

## Phase 4: Educational Mode, Polish & Power Features
> **Goal:** This is the version you can show students in class AND use yourself for real decisions.

### 4.1 The Metric Decision Tree — In-App

Your [fm_evaluation_metrics.html](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/docs/superpowers/plans/fm_evaluation_metrics.html) file is a React interactive decision tree. **Embed it directly in EvalBench** as a dedicated "Learn" tab or sidebar panel. When a user configures an eval run, they can click "Why this metric?" and get the exact educational content from your teaching material.

This creates a unique differentiator: **EvalBench is the only eval tool that teaches you why the metric exists while you use it.**

Implementation options:
- Option A: Embed the existing HTML via `<iframe>` in the Learn tab
- Option B: Port the decision tree data into the React app natively (better integration)
- **Recommended:** Port it. Extract the `tree` data structure from the HTML, render it as a native EvalBench component that ties directly into the wizard (e.g., hovering a metric in the wizard opens its explanation card)

### 4.2 Enhanced Dashboard

| View | Implementation |
|---|---|
| **Leaderboard Table** | Sortable by any metric, with CI columns. Column visibility toggle. |
| **Radar Chart** | Per-model spider chart across dimensions (Speed, Knowledge, Reasoning, Code, Safety, Fluency). Uses Recharts RadarChart — already a dep. |
| **Head-to-Head View** | Pick any 2 models, see their side-by-side scores on every metric they share, with win/loss/tie indicators. |
| **Score History** | Line chart: model X's ROUGE-L over time as different quants are tested. |

### 4.3 Dataset Builder

For your classroom use case — let students build their own golden datasets:

1. **Manual entry** — type question, expected answer, tags, difficulty
2. **CSV/JSON upload** — drag-and-drop with schema validation and preview
3. **Synthetic generation** — give a document, an Ollama model generates Q-A pairs, you approve them
4. **Export** — your curated dataset as JSON (portable, shareable)

### 4.4 Export & Reporting

| Format | Content |
|---|---|
| **CSV** | All scores, CIs, model metadata — for spreadsheet analysis |
| **JSON** | Full eval run with raw outputs — for programmatic use |
| **Markdown Table** | Paste-ready for papers, blog posts, README files |
| **PDF Report** | Summary card with radar chart, leaderboard, run config — for presentations |

### 4.5 Provider Integrations (from Backlog)

Add non-Ollama providers for cross-comparison:

| Provider | Library | Config |
|---|---|---|
| Anthropic Claude | `anthropic` | `ANTHROPIC_API_KEY` |
| Google Gemini | `google-generativeai` | `GOOGLE_API_KEY` |
| HuggingFace Inference | `huggingface_hub.InferenceClient` | `HF_TOKEN` |
| Groq (fast inference) | `groq` | `GROQ_API_KEY` |

This enables mixed comparisons: *llama3.2:8b (local) vs. claude-haiku-3.5 (API) vs. gemini-flash-2.0 (API)*

---

## Technical Architecture (Final State)

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React + TypeScript)             │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐   │
│  │Dashboard │  Models  │EvalWizard│  Arena   │  Learn   │   │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘   │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              Datasets │ Settings │ History            │   │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                             ↕ REST + SSE
┌─────────────────────────────────────────────────────────────┐
│                Python FastAPI Backend (Port 8001)            │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐   │
│  │ /models  │  /arena  │/eval-runs│/datasets │/settings │   │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘   │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              Services Layer                          │    │
│  │  ollama.py │ eval_runner.py │ cache.py │ storage.py  │    │
│  └──────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              Scoring Engine                          │    │
│  │  rouge │ bleu │ bertscore │ meteor │ chrf │ exact_m  │    │
│  │  distinct │ pass@k │ llm_judge │ stats │ speed      │    │
│  └──────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              Benchmark Suite                         │    │
│  │  mmlu │ hellaswag │ arc │ gsm8k │ humaneval │ boolq  │    │
│  └──────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              Provider Abstraction                    │    │
│  │  OllamaProvider │ OpenAIProvider │ AnthropicProvider │    │
│  │  GeminiProvider │ GroqProvider   │ HuggingFaceProvider│   │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                             ↕
              SQLite (evalbench.db — local-first)
              ┌─────────────────────────────────┐
              │ models │ eval_runs │ eval_results│
              │ golden_datasets │ golden_items   │
              │ arena_battles │ elo_ratings      │
              │ response_cache │ settings        │
              └─────────────────────────────────┘
                             ↕
                    Ollama localhost:11434
                    (+ optional API providers)
```

---

## Phase Delivery Plan

| Phase | Milestone | Key Deliverable | Est. Sessions |
|---|---|---|---|
| **Phase 1** | Backend Alive | Real Ollama models, real Arena responses, speed metrics | 2-3 |
| **Phase 2** | Metrics Work | ROUGE/BLEU/BERTScore/METEOR live, task-type wizard, built-in datasets, SSE progress | 3-4 |
| **Phase 3** | Full Coverage | LLM-judge, academic benchmarks, safety, statistical CIs, Settings page | 4-5 |
| **Phase 4** | Winning State | Educational Learn tab (fm_metrics embedded), radar charts, dataset builder, export, multi-provider | 3-4 |

---

## Metric Coverage Map: fm_evaluation_metrics.html → EvalBench

This ensures EvalBench implements what you teach:

| fm_metrics.html Category | Metrics in HTML | Phase Implemented |
|---|---|---|
| **Intrinsic / Language Modeling** | Perplexity, Cross-Entropy, BPB, BPC | Phase 3 (advanced) |
| **Summarization** | ROUGE-1/2/L/Lsum, BERTScore, SummaC | **Phase 2** ✅ |
| **Translation** | BLEU/SacreBLEU, chrF, METEOR, COMET, BLEURT | **Phase 2** ✅ |
| **General Generation** | MAUVE, Distinct-n, Self-BLEU, Repetition Rate | **Phase 2** ✅ |
| **Semantic Similarity** | BERTScore, MoverScore, Sentence Transformers, BLEURT | **Phase 2** ✅ |
| **Classification** | Accuracy, Macro F1, AUC-ROC, Cohen's Kappa | **Phase 2** ✅ |
| **QA** | Exact Match, F1, ROUGE-L, BERTScore, LLM-judge | **Phase 2** ✅ |
| **Information Extraction** | Span F1, JSON Accuracy | Phase 3 |
| **Ranking/Retrieval** | NDCG@K, MRR, Precision@K, MAP, Hit Rate@K | Phase 3 |
| **Reasoning/Math** | Final Answer Acc, Pass@K, Chain-of-Thought Validity, Self-Consistency | **Phase 2/3** |
| **Code Generation** | Pass@K, Pass@1, HumanEval, CodeBLEU, SWE-Bench | **Phase 2** ✅ |
| **Human Evaluation** | Helpfulness, Coherence, Relevance, A/B Preference | Phase 3 (via LLM-judge) |
| **LLM-as-Judge** | G-Eval, MT-Bench, AlpacaEval, Pairwise Preference | **Phase 3** ✅ |
| **Preference/Comparison** | Elo Rating, Win Rate, Bradley-Terry, TrueSkill | **Phase 1+** ✅ (Arena) |
| **Benchmark Suites** | MMLU, HellaSwag, ARC, BoolQ, TruthfulQA, BigBench | **Phase 3** ✅ |
| **Toxicity** | Perspective API, RealToxicityPrompts, Detoxify | Phase 3 |
| **Bias & Fairness** | BBQ, WinoBias, StereoSet | Phase 3 |
| **Factuality / RAG** | FActScore, RAGAS (faithfulness, context precision) | Phase 3-4 |

---

## Recommended First Steps

Start where the plan is already written and the impact is highest:

1. **Execute [2026-03-12-python-backend-migration.md](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/docs/superpowers/plans/2026-03-12-python-backend-migration.md) Chunk 1-6** — gets the FastAPI backend live with real Ollama calls. This is the most critical unblock.
2. **Add `backend/scoring/speed.py`** — immediately makes every eval run produce real TPS/TTFT scores.
3. **Wire Arena to real `generate()` calls** — transforms the Arena from a demo into a functional tool.
4. **Add `backend/scoring/rouge.py`** with CNN/DailyMail sample data — first real quality metric.
5. **Redesign the Eval Wizard Step 2** from "pick benchmarks" to "pick task type" — unlocks the entire metric taxonomy.

> [!IMPORTANT]
> The Python migration plan ([2026-03-12-python-backend-migration.md](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/docs/superpowers/plans/2026-03-12-python-backend-migration.md)) is already written in detail. **Phase 1 is ready to execute immediately.** Phases 2-4 build directly on top of it once the foundation is stable.

---

## What Makes This a Winning App

1. **Local-first, privacy-preserving** — no data leaves your machine (unless you use API judges)
2. **Educational alignment** — the metric taxonomy directly mirrors what you teach with [fm_evaluation_metrics.html](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/docs/superpowers/plans/fm_evaluation_metrics.html)
3. **Real metrics, not random numbers** — established Python libraries, not `Math.random()`
4. **Task-aware evaluation** — the wizard guides users to appropriate metrics for their use case
5. **Statistical credibility** — confidence intervals and significance tests make results trustworthy
6. **Multi-model, multi-task** — compare local Ollama models AND frontier APIs side-by-side
7. **Built for teaching AND real decisions** — not a toy demo, not an enterprise product, exactly the right scope
