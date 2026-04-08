# EvalBench

**Local-first LLM evaluation workbench** for running real metrics, tracking runs, and comparing models — with an educational layer that teaches *why* each metric exists.

[![Local-first](https://img.shields.io/badge/Local--first-privacy%20friendly-success)](./README.md)
[![Eval Metrics](https://img.shields.io/badge/Eval-ROUGE%20%7C%20BLEU%20%7C%20F1-blue)](./README.md)
[![Runs](https://img.shields.io/badge/Run-History%20%2B%20Details-purple)](./README.md)
[![License](https://img.shields.io/badge/License-MIT-black)](./README.md)

**Status**: v0.9 - Trusted Eval Runs + Smarter Wizard UX (typed run config, grounded ETA, fair compare, cancellation, reliability analytics, dataset UX)

---

## Table of Contents

- [Why EvalBench](#why-evalbench)
- [Demo](#demo)
- [Architecture](#architecture)
- [Core Concepts](#core-concepts)
- [Features](#features)
- [Technical Stack](#technical-stack)
- [Setup & Installation](#setup--installation)
- [How to Run and Stop](#how-to-run-and-stop)
- [Validation](#validation)
- [Roadmap](#roadmap)
- [Contributing](#contributing)

---

## Why EvalBench

EvalBench is built for people who **run local models and care about measurable quality**. It bridges two worlds:
1. **Practical evaluation**: real scores, reproducible runs, and model-to-model comparison.
2. **Learning**: an embedded decision tree that explains *which metric to use and why*.

If you want “LM Studio but for evaluation,” this is it.

## Demo

### Eval Wizard — Run a benchmark in seconds
<!-- TODO: replace with images/demo-eval-wizard.gif -->
![Eval Wizard](images/image-20260401192033058.png)

### Arena — Blind pairwise voting with ELO
<!-- TODO: replace with images/demo-arena.gif -->
![Arena](images/image-20260313104835222.png)

### Head-to-Head Compare
<!-- TODO: replace with images/demo-compare.gif -->
![Compare](images/image-20260401192243905.png)

## Architecture

EvalBench uses a **local-first** architecture optimized for privacy and speed. It separates a lightweight, reactive frontend from a heavy, computational Python backend.

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React + Vite)                  │
│  ┌──────────────┬──────────────┬──────────────┬──────────┐  │
│  │  Dashboard   │ Eval Wizard  │  Compare     │  Arena   │  │
│  └──────────────┴──────────────┴──────────────┴──────────┘  │
└─────────────────────────────────────────────────────────────┘
                             ↕ REST API + Server-Sent Events (SSE)
┌─────────────────────────────────────────────────────────────┐
│            Backend (Python FastAPI)                         │
│  ┌──────────────┬──────────────┬──────────────┐             │
│  │  Scoring     │ Eval Runner  │  Ollama      │             │
│  │  Algorithms  │ (vLLM later) │  Integration │             │
│  └──────────────┴──────────────┴──────────────┘             │
└─────────────────────────────────────────────────────────────┘
                             ↕
               SQLite Database (evalbench.db)
```

## Core Concepts

### 1. Traditional Reference Metrics
We use established Python libraries (`rouge-score`, `sacrebleu`, `nltk`) to compute metrics like ROUGE, BLEU, Exact Match, Token F1, and Distinct-1/2 locally against Ground-Truth Golden Datasets. Datasets are seeded from inline subsets at startup (no external downloads).

### 2. LLM-as-Judge (Optional)
For subjective generation tasks, EvalBench can optionally use a configured judge model to score outputs on criteria such as coherence, fluency, and relevance, returning both a score and rationale. Judge providers are loaded lazily so optional SDKs do not block the core app.

### 3. Statistical Rigor And Reliability
EvalBench computes mean scores and margin of error where supported, and now separates quality from reliability by tracking failed pairs, retries, cache hits, cancellation state, and success rate for each run.

---

## Features

- **Model Discovery**: Auto-detects local Ollama models.
- **Task-Aware Wizard**: Select a Task Type (Knowledge, Chat, Code) and EvalBench automatically suggests the correct metrics (Exact Match vs ROUGE vs LLM Judge) and standard benchmark dataset (MMLU vs TruthfulQA).
- **Typed Eval Run Config**: Run metadata now follows a shared typed contract across backend and frontend, reducing config drift and making run state safer to reason about.
- **Grounded Wizard ETA**: The wizard estimates runtime from dataset size, selected models, and historical per-pair duration when available, instead of static copy.
- **Dataset Builder & Registry**: Create golden datasets manually, import CSV/JSON, version datasets by name, use task-aware templates, and inspect dataset usage history.
- **Trusted Run Lifecycle**: Runs support cancellation, honest failed/cancelled states, retry-aware Ollama calls, and reliability counters such as retries, failed pairs, cache hits, and success rate.
- **Capability Signatures**: Multi-dimensional Radar charts to visualize model strengths and weaknesses.
- **Fair Head-to-Head Compare**: Compare two models only on shared completed run contexts, with task/dataset scoping to avoid misleading apples-to-oranges comparisons.
- **Arena Mode**: Pairwise blind testing where you explicitly start a battle, vote, then reveal which model was which before moving to the next matchup.
- **Educational Layer**: The `Learn` tab links to the interactive Metric Decision Tree used in the app.
- **Run History & Details**: Track runs over time, compare per-model metrics, inspect example outputs side-by-side, review run reliability alongside quality, and scan quick score previews without leaving the history table.
- **Settings Verification**: Test Ollama connectivity, judge readiness, and cloud API-key setup directly from the Settings form before saving.
- **Danger Zone / Wipe Data**: Quickly flush all captured evaluation stats, battle ratings, and cached responses from the SQL database—without losing configured datasets or local models—directly from Settings.

---

## Technical Stack

| Layer | Technology |
|-------|-----------|
| **Frontend UI** | React 18, Vite, Tailwind CSS, Shadcn UI |
| **Routing & State** | Wouter, TanStack React Query |
| **Charts** | Recharts |
| **Backend Framework** | Python 3, FastAPI |
| **Database** | SQLite (via SQLAlchemy ORM) |
| **Validation** | Pydantic v2 (Backend) + Zod (Frontend) |
| **Scoring Libs** | `rouge-score`, `sacrebleu`, `nltk`, `scipy` |

---

## Setup & Installation

### Prerequisites
1. **Node.js**: v18 or higher (for the frontend React app)
2. **Python**: v3.11 or higher (for the backend API and metric computation)
3. **Ollama**: Installed locally and running on `http://localhost:11434` (with at least one model pulled)
4. **uv**: (Optional but recommended) Lightning-fast Python package installer

### Installation Steps

1. **Clone and Install Frontend**
```bash
git clone <repo>
cd evalbench
npm install
```

2. **Install Backend Dependencies**
EvalBench uses a synchronized `concurrently` script that will automatically use `uv` to install the Python dependencies listed in `backend/requirements.txt` the first time you run the backend.

*(If you don't have `uv` installed, the system will attempt to use standard `pip`)*

If you want to install Python deps explicitly up front, run:
```bash
uv sync
```
Or use the npm helper:
```bash
npm run py:install
```

### Security Note — Encryption Key Backup

On first run, EvalBench auto-generates an encryption key at `~/.evalbench_key` (chmod 600). All API keys entered in Settings are encrypted with this key before being stored in `evalbench.db`.

**Back up `~/.evalbench_key`.** If you lose this file, stored API keys become permanently unreadable and must be re-entered.

> This app is designed for single-user local use. Do not expose the backend port over a network.

---

## How to Run and Stop

### 🟢 Starting the App

You can start the entire stack (both the Vite Frontend and the FastAPI Backend) with a **single command** from the root `EvalBench` directory:

```bash
npm run dev
```

This command uses `concurrently` to spin up two processes:
- **Frontend** runs on `http://localhost:5173`
- **Backend** runs on `http://localhost:8001` (Note: The frontend automatically proxies `/api` requests to this port).

Open `http://localhost:5173` in your browser to view EvalBench.

### 🔴 Stopping the App
To stop the application, simply go to the terminal window where it is currently running and press:

**`Ctrl + C`**

This will gracefully terminate both the Frontend Vite server and the Backend FastAPI server simultaneously. Make sure to close the browser tab to avoid any lingering connection attempts.

---

## Validation

Use these commands before shipping changes:

```bash
npm run check
pytest -q
```

Both are kept green as part of the active audit/remediation work.

---

## Roadmap

- LLM‑as‑Judge (G‑Eval) + Settings for API keys
- HumanEval / code benchmarks + execution harness
- Statistical rigor: confidence intervals and significance tests
- Dataset editing, richer schema-aware validation, and export formats
- Provider expansion beyond Ollama for evaluated models
- Dataset provenance reporting and stronger shareable benchmark outputs

See [BACKLOG.md](./docs/superpowers/plans/BACKLOG.md) for full details.

---

## Contributing

Ideas, issues, and PRs are welcome. If you’re proposing a new metric or dataset, please include:
- The benchmark source + license
- Expected metric behavior
- A small seed subset for quick local tests

---

## License
MIT
