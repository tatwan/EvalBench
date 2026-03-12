<initial_request>
Review @README.md
to get an idea on the app dseign . I wanted a Desktop app that I can use based on this thread:

"Let’s say I want to build a desktop app inspired by msty or llm studios but focused mainly on local model evaluation in other words it performs tests and evaluation on my local models then gives me an evaluation dashboard. How would you spec something like this to be desogned. Also for LLM as a judge one can use a frontier model like OpenAI or Claude or gemini via APi. We can standard golden data for testing one Can submit their own for metrics like rouge or bleu or other more advanced and newer"

Here is the full response 

@Pasted-Now-I-have-enough-information-to-write-a-comprehensive-_1773200428532.txt

Please audit the app and create me a report on what it is doing, the gaps, and overall design feedback
</initial_request>
<follow_up_1>
The audit report is in @evalbench_audit.md.
</follow_up_1>

<request_2>
Then I followed:
My intent was to use this application to read my local Ollama, meaning check my models that I have locally. Maybe (later release) I can download additonal models. But my intent was for the app to help me evaluate and benchmark on my own. Wheher my using a golden data set myself, or using well known benchmarks. I also wanted to utilize the latest metrics out there beyond just ROUGE and BLEU for example. Lastly, LLM-as-a-Judge something I can test by leveraging a foundation model (frontier like OpenAI or GEmini) by using an API key. 
<request_2>

<follow_up_2>
Then I got this feedback:


That's a very clear and well-scoped vision. Here's how I'd translate what you described into concrete implementation priorities:

---

## What You're Building (Clarified)

### 🔌 1. Real Ollama Integration
- On app start, hit `GET localhost:11434/api/tags` to list your local models automatically — no manual seeding
- Show status (is Ollama running? is a model loaded/idle/busy?)
- Later: a "Pull Model" button to download from the registry

### 📊 2. Evaluation Engine — Two Paths

**Path A: Bring Your Own Dataset**
- Upload a JSON/CSV file with `input` + `expected_output` pairs
- App sends each input to your local model, collects responses, computes metrics

**Path B: Well-Known Benchmarks**
- Ship a curated subset of MMLU, HellaSwag, GSM8K, TruthfulQA, ARC built-in
- User picks a benchmark → app runs the full evaluation loop automatically

### 🧮 3. Modern Metrics (beyond ROUGE/BLEU)

The current research consensus is that statistical metrics alone are unreliable. The plan would be:

| Tier | Metrics | Why |
|---|---|---|
| **Statistical** | BLEU, ROUGE-1/2/L, METEOR, ChrF | Fast, deterministic, good baseline |
| **Semantic** | BERTScore, MoverScore | Embedding similarity — much better correlation with human judgment |
| **Neural** | BLEURT | Trained on human quality ratings |
| **Speed/Infra** | Tokens/sec, TTFT, P50/P95 latency, RAM usage | Always computed, no golden data needed |

These require a Python sidecar (`rouge-score`, `bert-score`, `sacrebleu`, `nltk`, `bleurt`). The Node.js backend shells out to it.

### ⚖️ 4. LLM-as-a-Judge
- Settings page where you paste an OpenAI or Gemini API key (stored locally, never sent anywhere except the respective API)
- For each model response, a **judge prompt** is sent to GPT-4o or Gemini with the original input, the model's response, and optionally the expected output
- Judge scores: **Correctness**, **Helpfulness**, **Coherence**, **Faithfulness** (for RAG)
- Uses GEval / chainof-thought evaluation — this is the gold standard right now

---

## Recommended Tech Pivot

The one architectural call to make before building: **stay as a web app or go desktop?**

- **Stay web (localhost:5000)**: Simplest path. Keep React + Node.js, add a Python subprocess for metrics. Works great, no installer needed.
- **Go desktop (Tauri)**: Better for distribution, smaller footprint, OS integrations. Requires more setup.

My recommendation: **stay web for now**, get the core evaluation loop working, then wrap in Tauri when you're ready to distribute. The code stays identical.

---

Want me to start implementing? I'd suggest tackling this in order:
1. **Real Ollama model discovery** (replace mock, 1-2 hours of work)
2. **Settings page** with API key management
3. **A working metric computation pass** (ROUGE + BERTScore via Python subprocess)
4. **LLM-as-Judge** with OpenAI/Gemini
5. **Custom dataset upload UI**

Should I go ahead and build all of this, or start with a specific piece?
</follow_up_2>