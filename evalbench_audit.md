# EvalBench — App Audit Report

**Date**: March 11, 2025  
**Version Audited**: 0.1.0-alpha (MVP)  
**Spec Reference**: *"EvalBench: Local LLM Evaluation Workbench"* design brief

---

## 1. What the App Currently Does

EvalBench is a web-based UI shell built with React + TypeScript on the frontend and a Node.js/Express + PostgreSQL backend. It provides five screens:

| Screen | What it does today |
|---|---|
| **Dashboard** | Stats overview (model count, run count, metrics collected). Bar chart of top model avg scores. Recent run list. |
| **Models** | Lists discovered models with family, params, quantization badges. "Discover Models" button re-triggers seeding. |
| **Eval Wizard** | 3-step flow: select models → choose benchmarks → review & run. Calls `POST /api/eval-runs` which immediately marks the run complete. |
| **Arena** | Shows a random blind prompt with two hardcoded placeholder responses side-by-side. User votes; ELO is updated in the DB. |
| **Arena Leaderboard** | ELO rankings table sourced from the DB. |

### What is genuinely working (end-to-end)
- ✅ Full React routing with Wouter, proper component hierarchy, nice layout sidebar
- ✅ DB schema defined and migrated (Drizzle + PostgreSQL)
- ✅ Arena voting and ELO calculation are **real** — ELO math is implemented correctly in [storage.ts](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/server/storage.ts) (K=32, standard formula)
- ✅ React Query for caching and loading states
- ✅ Nice dark-mode UI using Tailwind + Shadcn, Framer Motion animations

---

## 2. Critical Gaps vs. the Design Spec

### 🔴 Gap 1: No Real Model Discovery (Ollama Integration is Missing)

The spec's #1 pillar is **auto-detecting Ollama models** via `ollama list` / the Ollama REST API at `localhost:11434`.

**What's actually in the code:**
```typescript
// server/storage.ts – discoverModels()
const discovered = [
  { name: "llama3-8b-instruct", ... },  // HARDCODED
  { name: "mistral-7b-instruct", ... }, // HARDCODED
  { name: "phi3-mini-4k", ... },        // HARDCODED
];
```
The "Discover Models" button just checks if the DB is empty and seeds three static records. **No HTTP call to Ollama is made anywhere in the codebase.** The app cannot talk to any local model.

---

### 🔴 Gap 2: No Metric Computation — All Scores Are Random

The spec defines a 4-tier metrics engine (Speed/Infra → Reference-Based → LLM-as-Judge → Academic Benchmarks). None of this exists.

**What's actually in the code:**
```typescript
// server/storage.ts – createEvalRun()
score: (Math.random() * 50 + 20).toFixed(2), // Speed: random 20-70 T/s
score: (Math.random() * 40 + 40).toFixed(2), // MMLU: random 40-80
```
Every evaluation run generates **random fake scores**. BLEU, ROUGE, BERTScore, METEOR, ChrF, latency measurements — none are computed. The Python sidecar that would run these (using `rouge-score`, `bert-score`, `nltk`, `deepeval`) does not exist.

---

### 🔴 Gap 3: Arena Responses Are Static Placeholder Text

The Arena is architecturally wired up correctly (vote → ELO update works), but the model responses it is comparing are hardcoded strings:

```typescript
outputA: `[Simulated Output A]\n${prompt} can be explained simply...`,
outputB: `[Simulated Output B]\nRegarding "${prompt}": It involves advanced principles...`
```

**No Ollama call is made** to actually generate responses from the two selected models. Voting on these outputs has no evaluative meaning.

---

### 🔴 Gap 4: Wrong Architecture for a Desktop App

The spec explicitly recommends **Tauri + Python FastAPI sidecar** for a desktop app:
- Tauri produces ~10MB installers vs Electron's ~150MB
- Python backend handles metric computation natively
- SQLite for local-first data storage

**What was built instead:**
- A web app (React + Express.js server)
- PostgreSQL (requires a separate server process — not local-first)
- No desktop shell whatsoever — this is a browser app

This is a significant architectural divergence. The app cannot be distributed as a `.app` or `.exe` installer without Electron wrapping, which contradicts the spec's rationale.

---

### 🟡 Gap 5: Eval Wizard — Missing Steps and Configuration

The spec's wizard has **6 steps**; the implementation has **3 steps**:

| Spec Step | Implemented? |
|---|---|
| Select models | ✅ |
| Choose metric categories | ❌ Missing |
| Pick benchmarks | ✅ (only 4 of 7 benchmarks listed — ARC, WinoGrande, BoolQ missing) |
| Configure judge (LLM-as-judge selection) | ❌ Missing |
| Set dataset (built-in vs. custom upload) | ❌ Missing |
| Run with per-model progress bars | ❌ (goes immediately to success screen) |

---

### 🟡 Gap 6: Dataset Management is a Placeholder

The `/datasets` route literally renders:
```tsx
<h2>Datasets coming soon</h2>
<p>Golden dataset management is planned for v0.2</p>
```

The spec calls "Golden Data Management" a **critical differentiator**. The database schema for `golden_datasets` and `golden_items` is defined, but there is zero UI or upload flow. Built-in benchmark data (MMLU's 14K questions, etc.) is not seeded.

---

### 🟡 Gap 7: LLM-as-Judge and Frontier API Settings are Absent

The spec dedicates a full section to judge configuration (local Ollama model, OpenAI/Anthropic/Google API keys, Prometheus 2). There is no Settings page at all — no API key storage, no judge model selection, no Ollama host/port configuration.

---

### 🟡 Gap 8: Dashboard Charts are Misleading

The "Top Models Performance" bar chart averages **random scores** from mock eval runs. The chart displays data that has no basis in actual model quality. Until real metrics are computed, this chart creates false confidence.

---

### 🟢 Gap 9: Missing Dashboard Views from Spec

| Spec Dashboard View | Implemented? |
|---|---|
| Leaderboard table (sortable) | Partial — bar chart only, no sortable table |
| Radar chart (per-model dimensions) | ❌ Missing |
| Head-to-head view (2 models, same prompt) | ❌ Missing |
| History view (scores over time) | ❌ Missing |
| Export (CSV / JSON / PDF) | ❌ Missing |

---

## 3. Design Feedback

### Architecture
**Recommendation:** Decide whether this is a web app or a desktop app — they require different architectural choices. For a desktop-first tool:
- ✅ Stick with Tauri (or accept Electron with its size trade-offs)
- ✅ Replace PostgreSQL with SQLite (better for local-first, no server process needed)
- ✅ Add a Python sidecar (or a Node.js worker using `child_process`) for metric computation

If staying web-only, that's also valid, but then lean into it: the app could be hosted locally and accessed at `localhost:5000`, which is effectively what it is now.

### Mock Data Strategy
The current approach (random scores, hardcoded models) is fine for UI/UX prototyping, but there is no clear seam between the mock and real backend. 

**Recommendation:** Create a `MockStorage` class that implements the same [IStorage](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/server/storage.ts#9-21) interface, and a [DatabaseStorage](file:///Users/tarekatwan/Repos/MyWork/Projects/EvalBench/server/storage.ts#22-172) that delegates metric computation to a Python subprocess. This way the UI works identically regardless of whether Ollama is running.

### Eval Wizard UX
The wizard flow is clean and well-designed. The animated progress track, selection cards, and Review & Run step are good patterns worth keeping. Missing elements to add:
- A "Dataset" step where users pick built-in or upload custom golden data
- A "Judge" step (toggle: local model vs. API key)
- Real-time streaming progress during the run (Server-Sent Events are mentioned in the spec and planned — this would transform the UX)

### Arena Mode
The Arena's UI layout is one of the strongest screens — the blind side-by-side comparison with ELO is well-executed. Once real Ollama calls are wired up, this will be highly usable. Consider:
- Adding a **custom prompt input** so users can test their own prompts, not just a hardcoded list
- Showing **ELO delta** after each vote ("+12 → Model A now leads by 47 Elo points") for engagement
- Adding **ELO confidence intervals** (mentioned in the v0.3 roadmap) — worthwhile to include early since they're easy to compute

### Dashboard
The stats cards are clean. The bar chart works. However, since scores are currently fake, the dashboard is misleading. Consider:
- Adding a clear **"Demo Mode" banner** when running with mock data
- Making the leaderboard a **sortable table** (not just a chart) — this is what power users actually want
- Adding **per-metric drill-down** — when you click on a model in the leaderboard, it shows its score breakdown by benchmark

### Visual Design
The dark-mode aesthetic with the sky-blue primary color is solid and premium-feeling. No major complaints. Minor notes:
- The Model cards could show a **connection status indicator** (is Ollama running? is this model currently loaded?)
- Arena vote buttons (`👈 Winner A`, `Winner B 👉`) are functional but could be more polished — consider animated highlight borders on the winning panel instead of button labels

---

## 4. Priority Recommendations for Next Sprint

| Priority | Action |
|---|---|
| 🔴 P0 | Wire up real Ollama integration — `POST localhost:11434/api/generate` for model responses, `GET localhost:11434/api/tags` for model discovery |
| 🔴 P0 | Implement at least one real metric (ROUGE via `rouge-score` Python or npm) so scores are not random |
| 🔴 P0 | Choose architecture: Tauri desktop app vs. localhost web app, and align the DB (SQLite vs. PostgreSQL) accordingly |
| 🟡 P1 | Add Settings page: Ollama host/port, frontier API keys |
| 🟡 P1 | Seed built-in golden datasets (even a small MMLU subset of 100 questions) |
| 🟡 P1 | Add real-time progress (SSE) during eval runs instead of instant "completed" |
| 🟢 P2 | Dataset upload UI (JSON/CSV drag-and-drop) |
| 🟢 P2 | Radar chart view for multi-dimensional model comparison |
| 🟢 P2 | Export functionality (CSV at minimum) |

---

## 5. Summary Scorecard

| Dimension | Score | Notes |
|---|---|---|
| **UI/UX Design** | 8/10 | Clean, premium dark-mode feel. Good component library choices. |
| **Architecture** | 4/10 | Solid structure but wrong stack for desktop; no real integrations |
| **Feature Completeness (vs. v0.1 spec)** | 5/10 | Shell is there; core data pipeline is missing |
| **Data Integrity** | 2/10 | All scores are random; models are hardcoded |
| **Arena Mode** | 6/10 | ELO math is real; model outputs are fake |
| **Readiness for Real Use** | 2/10 | Cannot evaluate any model; cannot connect to Ollama |

**Overall:** EvalBench v0.1 is a **well-designed UI prototype** that demonstrates the intended product vision clearly. The component structure is clean and extensible. However, it is effectively a non-functional demo — no model is ever called, no metric is ever computed, and no real data flows through the evaluation pipeline. The path to a usable v0.1 requires replacing mock data with actual Ollama integration and at least one working metric.
