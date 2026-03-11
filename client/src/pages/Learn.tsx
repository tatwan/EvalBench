import { Button } from "@/components/ui/Button";
import { BookOpen, Target, Link2, AlignLeft, MessageCircleQuestion, MessageSquare, Network, Code2, BrainCircuit } from "lucide-react";

const METRIC_LIBRARY: Record<string, { description: string; tag?: string; tagClass?: string }> = {
  "ROUGE-1": { description: "Unigram overlap between generated and reference text." },
  "ROUGE-2": { description: "Bigram overlap; captures local fluency and phrasing." },
  "ROUGE-L": { description: "Longest common subsequence; rewards structure and ordering." },
  "BERTScore": { description: "Semantic similarity via contextual embeddings (F1)." },
  "METEOR": { description: "Alignment-based metric with stemming and synonyms." },
  "Exact Match": { description: "Binary exact match after normalization." },
  "Token F1": { description: "Token overlap F1 for partial-credit answers." },
  "LLM Coherence": { description: "Judge score for logical flow and structure.", tag: "Judge", tagClass: "bg-amber-100 text-amber-700" },
  "LLM Relevance": { description: "Judge score for topical relevance to the prompt.", tag: "Judge", tagClass: "bg-amber-100 text-amber-700" },
  "LLM Fluency": { description: "Judge score for grammar and readability.", tag: "Judge", tagClass: "bg-amber-100 text-amber-700" },
  "Distinct-1": { description: "Ratio of unique unigrams; diversity signal.", tag: "Diversity", tagClass: "bg-blue-100 text-blue-700" },
  "Distinct-2": { description: "Ratio of unique bigrams; diversity signal.", tag: "Diversity", tagClass: "bg-blue-100 text-blue-700" },
  "Cosine Sim": { description: "Cosine similarity between query and target embeddings." },
  "Recall@1": { description: "Whether the correct item is ranked first." },
  "Recall@3": { description: "Whether the correct item appears in top 3." },
  "MRR": { description: "Mean reciprocal rank of the correct item." },
  "Pass@1": { description: "Fraction of samples that pass tests on the first try." },
};

const METRIC_CATEGORIES = [
  {
    id: "summarization",
    label: "Summarization",
    icon: AlignLeft,
    tone: "bg-blue-100 text-blue-700",
    subtitle: "Best for: document condensing, news summarization",
    metrics: ["ROUGE-1", "ROUGE-2", "ROUGE-L", "BERTScore", "METEOR", "LLM Coherence", "LLM Relevance"],
  },
  {
    id: "qa",
    label: "Question Answering",
    icon: MessageCircleQuestion,
    tone: "bg-emerald-100 text-emerald-700",
    subtitle: "Best for: SQuAD-style extraction, factual QA",
    metrics: ["Exact Match", "Token F1", "ROUGE-1", "ROUGE-2", "ROUGE-L", "LLM Relevance"],
  },
  {
    id: "chat",
    label: "Chat / Generation",
    icon: MessageSquare,
    tone: "bg-violet-100 text-violet-700",
    subtitle: "Best for: open-ended or conversational prompts",
    metrics: ["ROUGE-1", "ROUGE-2", "ROUGE-L", "BERTScore", "METEOR", "Distinct-1", "Distinct-2", "LLM Fluency", "LLM Coherence"],
  },
  {
    id: "knowledge",
    label: "Knowledge / MMLU",
    icon: BookOpen,
    tone: "bg-amber-100 text-amber-700",
    subtitle: "Best for: academic knowledge and domain tests",
    metrics: ["Exact Match", "Token F1", "ROUGE-1", "ROUGE-2", "ROUGE-L", "LLM Relevance"],
  },
  {
    id: "embedding",
    label: "Embeddings / Retrieval",
    icon: Network,
    tone: "bg-sky-100 text-sky-700",
    subtitle: "Best for: semantic search and ranking",
    metrics: ["Cosine Sim", "Recall@1", "Recall@3", "MRR"],
  },
  {
    id: "code",
    label: "Code Generation",
    icon: Code2,
    tone: "bg-rose-100 text-rose-700",
    subtitle: "Best for: correctness on executable tests",
    metrics: ["Pass@1", "ROUGE-1", "ROUGE-2", "ROUGE-L", "Distinct-1", "Distinct-2"],
  },
  {
    id: "reasoning",
    label: "Reasoning / Math",
    icon: BrainCircuit,
    tone: "bg-slate-100 text-slate-700",
    subtitle: "Best for: multi-step reasoning and math",
    metrics: ["Exact Match", "Token F1", "ROUGE-1", "ROUGE-2", "ROUGE-L"],
  },
];

export default function Learn() {
  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-10">
      <div>
        <h1 className="text-2xl font-extrabold flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-violet-600" />
          Metric Guide
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Learn which evaluation metrics to use and why - tied directly into the Eval Wizard.
        </p>
      </div>

      <div className="rounded-2xl border border-border border-l-4 border-l-violet-500 bg-white p-5 flex items-center gap-4">
        <Target className="w-8 h-8 text-violet-600" />
        <div className="flex-1">
          <div className="text-sm font-bold text-violet-700">Not sure which metric to use?</div>
          <div className="text-sm text-foreground">
            Use the interactive decision tree to get a personalized recommendation based on your task.
          </div>
        </div>
        <Button className="text-sm" onClick={() => window.open("https://tatwan.github.io/fm_evaluation_metrics.html", "_blank")}>
          Open Decision Tree -&gt;
        </Button>
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-3">All Metrics Used by the Eval Wizard</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {METRIC_CATEGORIES.map((category) => {
            const Icon = category.icon;
            return (
              <div key={category.id} className="rounded-xl border border-border bg-card p-4 shadow-soft">
                <div className="flex items-center gap-2 mb-3">
                  <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${category.tone}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{category.label}</div>
                    <div className="text-xs text-muted-foreground">{category.subtitle}</div>
                  </div>
                </div>
                <div className="space-y-2">
                  {category.metrics.map((metric) => {
                    const info = METRIC_LIBRARY[metric];
                    return (
                      <div key={metric} className="rounded-lg bg-white border border-border p-3">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-semibold text-violet-700">{metric}</span>
                          {info?.tag ? (
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${info.tagClass ?? "bg-muted text-muted-foreground"}`}>
                              {info.tag}
                            </span>
                          ) : null}
                        </div>
                        <p className="text-[13px] text-foreground mt-1 leading-relaxed">{info?.description ?? "Metric description coming soon."}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-border border-l-4 border-l-violet-500 bg-white p-4 flex items-center gap-3">
        <Link2 className="w-5 h-5 text-violet-600" />
        <div className="text-sm text-foreground">
          These definitions mirror the metrics shown in the Eval Wizard so you can see exactly what will be computed for each task.
        </div>
      </div>
    </div>
  );
}
