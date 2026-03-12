# EvalBench Backlog

Living document for future work that has intent but no implementation plan yet.
When an item gets a plan, move it to `docs/superpowers/plans/` and link it here.

---

## Scoring & Statistical Rigor

**Source:** Inspired by [llm-evaluation](https://github.com/NahuelGiudizi/llm-evaluation)

### Wilson Confidence Intervals
Wrap eval scores with 95% confidence intervals so results say "MMLU: 68.4% ± 3.2%" rather than a bare number. Makes results trustworthy and comparable across runs.
- File: `backend/scoring/stats.py` → `wilson_confidence_interval(successes, trials, confidence=0.95)`
- Library: `scipy.stats` or manual formula (no extra dep needed)

### Statistical Significance Tests
When comparing two models on the same benchmark, report whether the difference is statistically significant.
- **McNemar test** — for paired binary outcomes (model A vs B on same questions)
- **Cohen's h** — effect size for proportions
- File: `backend/scoring/stats.py` → `mcnemar_test(results_a, results_b)`, `cohens_h(p1, p2)`
- Library: `scipy.stats`

### Bootstrap Confidence Intervals
Alternative to Wilson for non-binary metrics (ROUGE, BERTScore). Resample eval results N times to estimate score distribution.
- File: `backend/scoring/stats.py` → `bootstrap_ci(scores, n_resamples=1000)`

---

## Scoring Methods

### BERTScore
Semantic similarity scoring using BERT embeddings. Better than ROUGE for open-ended responses where correct answers can be phrased differently.
- File: `backend/scoring/bertscore.py`
- Library: `bert-score` (heavy dep — downloads ~400MB model on first use)
- Note: Expensive to run per-response; best for batch eval jobs, not live Arena

### BLEU
Standard MT metric. Less useful than ROUGE for most eval cases but expected by users familiar with NLP benchmarks.
- File: `backend/scoring/bleu.py`
- Library: `sacrebleu` or `evaluate` (HuggingFace)

### HuggingFace `evaluate` Hub
Umbrella library covering ROUGE, BLEU, METEOR, BERTScore, and many others through a unified API.
- Could replace individual `rouge-score` / `sacrebleu` installs with one dep
- `pip install evaluate` → `evaluate.load("rouge")`, `evaluate.load("bertscore")`

---

## Additional Benchmarks

**Source:** Inspired by [llm-evaluation](https://github.com/NahuelGiudizi/llm-evaluation)

All follow the same `Benchmark` base class pattern already in `backend/benchmarks/base.py`.

| Benchmark | What it tests | HF dataset ID | Notes |
|---|---|---|---|
| TruthfulQA | Truthfulness / hallucination | `truthful_qa` | Binary: truthful or not |
| HellaSwag | Commonsense reasoning | `Rowan/hellaswag` | MCQ |
| ARC | Science Q&A | `ai2_arc` | MCQ, Easy + Challenge splits |
| WinoGrande | Co-reference resolution | `winogrande` | MCQ |
| GSM8K | Math reasoning | `gsm8k` | Requires reasoning extraction |
| BoolQ | Boolean Q&A | `boolq` | Yes/No |
| CommonsenseQA | Common sense | `commonsense_qa` | MCQ |

---

## Provider Integrations

### Anthropic (Claude)
- File: `backend/providers/anthropic_provider.py`
- Library: `anthropic`
- Config: `ANTHROPIC_API_KEY` env var
- Models: claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5

### Google Gemini
- File: `backend/providers/gemini_provider.py`
- Library: `google-generativeai`
- Config: `GOOGLE_API_KEY` env var

### HuggingFace Inference API
- File: `backend/providers/huggingface_provider.py`
- Library: `huggingface_hub` → `InferenceClient`
- Config: `HF_TOKEN` env var
- Enables testing hosted HF models without local hardware

### Groq (fast inference)
- File: `backend/providers/groq_provider.py`
- Library: `groq`
- Config: `GROQ_API_KEY`
- Same API shape as OpenAI — easy to add

---

## Eval Runner

A proper batch evaluation runner that wires providers + benchmarks + scoring together.
The missing piece that makes the EvalWizard real instead of mock.

```python
# What this would look like:
runner = EvalRunner(
    provider=OllamaProvider(),
    benchmark=MMLUBenchmark(),
    scorer=llm_judge_score,       # or score_rouge, etc.
)
results = await runner.run(model="llama3:8b", max_samples=100)
# → EvalRun written to DB with real scores, not Math.random()
```

- File: `backend/services/eval_runner.py`
- Depends on: providers, benchmarks, scoring all being in place
- Should emit progress via SSE (Server-Sent Events) so the frontend can show a live progress bar

---

## Performance

### Parallel Workers
Run benchmark items in parallel (N concurrent requests) instead of sequentially. 5-10x speedup for large evals.
- `asyncio.Semaphore` to cap concurrency and avoid overwhelming Ollama
- File: update `backend/services/eval_runner.py` when it exists

### Result Caching
Cache model responses for (model, prompt) pairs so re-running an eval with the same questions doesn't re-call the LLM. SHA256 hash of (model_name + prompt) as cache key.
- File: `backend/services/cache.py`
- Simple: SQLite table `response_cache(key TEXT PRIMARY KEY, response TEXT, created_at)`

---

## Export Formats

When eval results are real (post eval-runner), support exporting in:
- **JSON** — already works (SQLite → JSON via API)
- **CSV** — for spreadsheet analysis
- **Markdown table** — for pasting into docs/issues

---

## Settings Page

Not yet built. Needed for:
- Ollama host/port override (currently hardcoded to `localhost:11434`)
- API keys for OpenAI, Anthropic, Gemini, Groq
- Judge model selection (which model to use for LLM-as-judge)
- Default benchmark sample size
