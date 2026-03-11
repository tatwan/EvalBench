import { Button } from "@/components/ui/Button";
import { BookOpen, Target, FileText, HelpCircle, Link2 } from "lucide-react";

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
        <Button className="text-sm">Open Decision Tree -&gt;</Button>
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-3">All Metrics by Category</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-8 w-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-semibold">Summarization</div>
                <div className="text-xs text-muted-foreground">Best for: document condensing, news summarization</div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="rounded-lg bg-white border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-violet-700">ROUGE-L</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">Primary</span>
                </div>
                <p className="text-[13px] text-foreground mt-1 leading-relaxed">Measures Longest Common Subsequence overlap between generated and reference summaries.</p>
              </div>
              <div className="rounded-lg bg-white border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-violet-700">BERTScore</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-700">Secondary</span>
                </div>
                <p className="text-[13px] text-foreground mt-1 leading-relaxed">Uses contextual embeddings for semantic similarity. Slower but captures meaning.</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-8 w-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <HelpCircle className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-semibold">Question Answering</div>
                <div className="text-xs text-muted-foreground">Best for: SQuAD-style extraction, factual QA</div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="rounded-lg bg-white border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-violet-700">Exact Match</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">Primary</span>
                </div>
                <p className="text-[13px] text-foreground mt-1 leading-relaxed">Binary score: 1 if prediction matches ground truth exactly.</p>
              </div>
              <div className="rounded-lg bg-white border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-violet-700">Token F1</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-700">Secondary</span>
                </div>
                <p className="text-[13px] text-foreground mt-1 leading-relaxed">Measures token-level overlap. More forgiving than Exact Match.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border border-l-4 border-l-violet-500 bg-white p-4 flex items-center gap-3">
        <Link2 className="w-5 h-5 text-violet-600" />
        <div className="text-sm text-foreground">
          All metrics are linked to the Eval Wizard - hover a metric in the wizard to see definitions here, or click "Why this metric?" to jump to its explanation.
        </div>
      </div>
    </div>
  );
}
