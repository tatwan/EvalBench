import { useMemo, useState, useEffect } from "react";
import { useModels } from "@/hooks/use-models";
import { useCreateEvalRun } from "@/hooks/use-eval";
import { useDatasets } from "@/hooks/use-datasets";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, ChevronRight, Activity, Cpu, Layers, BookOpen, AlignLeft, MessageCircleQuestion, MessageSquare, Code2, BrainCircuit, Sparkles, Network } from "lucide-react";
import { clsx } from "clsx";

const TASK_TYPES = [
  {
    id: "summarization",
    label: "Summarization",
    icon: AlignLeft,
    desc: "How well does the model condense articles or documents?",
    tests: "Compression, coverage, and faithfulness to source.",
    goal: "Produce concise summaries without losing key facts.",
    metrics: ["ROUGE-1", "ROUGE-2", "ROUGE-L", "BERTScore", "METEOR", "LLM Coherence", "LLM Relevance"],
    datasetHint: "EvalBench Summarization v1",
    datasetLabel: "EvalBench Summarization v1",
    usesJudge: true,
  },
  {
    id: "qa",
    label: "Question Answering",
    icon: MessageCircleQuestion,
    desc: "Factual accuracy and extraction from provided context.",
    tests: "Answer accuracy, span extraction, and grounding.",
    goal: "Return the exact correct answer with minimal noise.",
    metrics: ["Exact Match", "Token F1", "ROUGE-1", "ROUGE-2", "ROUGE-L", "LLM Relevance"],
    datasetHint: "EvalBench QA v1",
    datasetLabel: "EvalBench QA v1",
    usesJudge: true,
  },
  {
    id: "chat",
    label: "Chat / Generation",
    icon: MessageSquare,
    desc: "Diversity, fluency, and quality of open-ended responses.",
    tests: "Conversational quality, coherence, and safety.",
    goal: "Respond naturally and helpfully in open-ended tasks.",
    metrics: ["ROUGE-1", "ROUGE-2", "ROUGE-L", "BERTScore", "METEOR", "Distinct-1", "Distinct-2", "LLM Fluency", "LLM Coherence"],
    datasetHint: "EvalBench TruthfulQA (Subset)",
    datasetLabel: "EvalBench TruthfulQA (Subset)",
    usesJudge: true,
  },
  {
    id: "knowledge",
    label: "Knowledge / MMLU",
    icon: BookOpen,
    desc: "Academic knowledge across professional domains.",
    tests: "Breadth of factual knowledge and reasoning.",
    goal: "Score well across standardized subject benchmarks.",
    metrics: ["Exact Match", "Token F1", "ROUGE-1", "ROUGE-2", "ROUGE-L", "LLM Relevance"],
    datasetHint: "EvalBench MMLU (Subset)",
    datasetLabel: "EvalBench MMLU (Subset)",
    usesJudge: true,
  },
  {
    id: "embedding",
    label: "Embeddings / Retrieval",
    icon: Network,
    desc: "Semantic search and similarity for retrieval tasks.",
    tests: "Nearest-neighbor ranking, semantic similarity, recall.",
    goal: "Embed queries so relevant docs rank at the top.",
    metrics: ["Cosine Sim", "Recall@1", "Recall@3", "MRR"],
    datasetHint: "EvalBench Embeddings v1",
    datasetLabel: "EvalBench Embeddings v1",
    usesJudge: false,
  },
  {
    id: "code",
    label: "Code Generation",
    icon: Code2,
    desc: "Functional correctness via code execution sandbox.",
    tests: "Correctness, edge cases, and code reliability.",
    goal: "Generate code that passes tests on first try.",
    metrics: ["Pass@1", "ROUGE-1", "ROUGE-2", "ROUGE-L", "Distinct-1", "Distinct-2"],
    datasetHint: "EvalBench HumanEval (Subset)",
    datasetLabel: "EvalBench HumanEval (Subset)",
    usesJudge: false,
  },
  {
    id: "reasoning",
    label: "Reasoning / Math",
    icon: BrainCircuit,
    desc: "Problem-solving and chain-of-thought evaluation.",
    tests: "Multi-step reasoning and mathematical accuracy.",
    goal: "Arrive at correct final answers consistently.",
    metrics: ["Exact Match", "Token F1", "ROUGE-1", "ROUGE-2", "ROUGE-L"],
    datasetHint: "EvalBench GSM8K (Subset)",
    datasetLabel: "EvalBench GSM8K (Subset)",
    usesJudge: false,
  },
];

export default function EvalWizard() {
  const [step, setStep] = useState(1);
  const [selectedModels, setSelectedModels] = useState<number[]>([]);
  const [selectedTaskType, setSelectedTaskType] = useState<string | null>(null);
  const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(null);
  const [lastRunId, setLastRunId] = useState<number | null>(null);

  const { data: models = [], isLoading: modelsLoading } = useModels();
  const { data: datasets = [] } = useDatasets();
  const createRun = useCreateEvalRun();

  const selectedTask = TASK_TYPES.find((t) => t.id === selectedTaskType);
  const selectedDataset = (datasets as any[]).find((d) => d.id === selectedDatasetId);

  const datasetKeywords: Record<string, string[]> = {
    summarization: ["summarization"],
    qa: ["qa"],
    chat: ["truthfulqa"],
    knowledge: ["mmlu", "hellaswag", "arc", "boolq", "commonsenseqa"],
    embedding: ["embeddings"],
    code: ["humaneval"],
    reasoning: ["gsm8k"],
  };

  const datasetOptions = useMemo(() => {
    if (!selectedTaskType) return [];
    const keywords = datasetKeywords[selectedTaskType] ?? [];
    return (datasets as any[]).filter((d) =>
      keywords.some((k) => d.name.toLowerCase().includes(k))
    );
  }, [datasets, selectedTaskType]);

  const handleSelectTask = (taskId: string) => {
    setSelectedTaskType(taskId);
    const task = TASK_TYPES.find((t) => t.id === taskId);
    if (task?.datasetHint) {
      const keywords = datasetKeywords[taskId] ?? [];
      const ds = (datasets as any[]).find((d) =>
        keywords.some((k) => d.name.toLowerCase().includes(k))
      );
      setSelectedDatasetId(ds?.id ?? null);
    } else {
      setSelectedDatasetId(null);
    }
  };

  useEffect(() => {
    if (!selectedTaskType) return;
    if (!selectedDatasetId && datasetOptions.length > 0) {
      setSelectedDatasetId(datasetOptions[0].id);
    }
  }, [selectedTaskType, selectedDatasetId, datasetOptions]);

  const handleRun = () => {
    if (!selectedTaskType) return;
    createRun.mutate(
      {
        modelIds: selectedModels,
        taskType: selectedTaskType,
        datasetId: selectedDatasetId ?? undefined,
      } as any,
      { onSuccess: (run: any) => {
          setLastRunId(run?.id ?? null);
          setStep(4);
        }
      }
    );
  };

  const steps = [
    { num: 1, title: "Task Type", icon: Layers },
    { num: 2, title: "Models", icon: Cpu },
    { num: 3, title: "Review & Run", icon: Activity },
    { num: 4, title: "Started", icon: Check },
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-extrabold">Eval Wizard</h1>
        <p className="text-sm text-muted-foreground">Set up and run a new evaluation in minutes - we'll guide you every step.</p>
      </div>

      <div className="flex items-center gap-3">
        {steps.map((s, idx) => {
          const active = step === s.num;
          const done = step > s.num;
          const Icon = s.icon;
          return (
            <div key={s.num} className="flex items-center gap-3 flex-1">
              <div
                className={clsx(
                  "h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold",
                  done ? "bg-emerald-500 text-white" : active ? "bg-violet-600 text-white shadow-sm" : "bg-muted text-muted-foreground border border-border"
                )}
              >
                {done ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
              </div>
              <div className={clsx("text-xs font-semibold", active ? "text-foreground" : "text-muted-foreground")}>{s.title}</div>
              {idx < steps.length - 1 && <div className={clsx("h-px flex-1", done ? "bg-emerald-500" : "bg-border")} />}
            </div>
          );
        })}
      </div>

      {step === 1 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-bold">What are you evaluating?</h2>
            <p className="text-sm text-muted-foreground">Choose a task type and EvalBench auto-selects the right metrics and dataset.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {TASK_TYPES.map((task) => {
              const isSelected = selectedTaskType === task.id;
              return (
                <div
                  key={task.id}
                  onClick={() => handleSelectTask(task.id)}
                  className={clsx(
                    "p-5 rounded-xl border cursor-pointer transition-all bg-card shadow-soft flex flex-col gap-4 min-h-[260px] relative",
                    isSelected ? "border-violet-400 bg-violet-50" : "border-border hover:border-violet-300 hover:shadow-md"
                  )}
                >
                  {task.usesJudge && (
                    <span className="absolute top-3 right-3 text-[9px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                      LLM Judge
                    </span>
                  )}
                  <div className="flex items-center gap-3">
                    <div className={clsx("h-10 w-10 rounded-lg flex items-center justify-center", isSelected ? "bg-violet-100 text-violet-700" : "bg-muted text-violet-600")}>
                      <task.icon className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-semibold">{task.label}</h4>
                      <p className="text-xs text-foreground/80 mt-1">{task.desc}</p>
                    </div>
                  </div>
                  <div className="space-y-2 text-xs text-foreground/80">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wide text-foreground/80">Tests</span>
                      <div>{task.tests}</div>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wide text-foreground/80">Goal</span>
                      <div>{task.goal}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-auto">
                    {task.metrics.map((m) => (
                      <span key={m} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-mono">
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {selectedTask && (
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-violet-600 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-semibold text-violet-700">Auto-configured for {selectedTask.label}</div>
                  <div className="text-sm text-violet-900/70 mt-1">
                {selectedTask.datasetHint
                    ? <>We'll use <strong>{selectedDataset?.name ?? selectedTask.datasetHint}</strong> and compute <strong>{selectedTask.metrics.join(", ")}</strong> automatically.</>
                    : <>No built-in dataset yet - you can still run a qualitative eval with judge metrics or Arena mode.</>
                  }
                </div>
                {selectedTask.datasetHint && (
                  <div className="flex gap-2 flex-wrap mt-2">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-white text-violet-700 border border-violet-200">Dataset</span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-white text-violet-700 border border-violet-200">{selectedTask.metrics.length} metrics</span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-white text-violet-700 border border-violet-200">~3 min/model</span>
                  </div>
                )}
                {datasetOptions.length > 1 && (
                  <div className="mt-3 max-w-[260px]">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 mb-1">Dataset</div>
                    <Select value={selectedDatasetId ? String(selectedDatasetId) : ""} onValueChange={(v) => setSelectedDatasetId(Number(v))}>
                      <SelectTrigger className="h-8 text-xs bg-white">
                        <SelectValue placeholder="Select dataset" />
                      </SelectTrigger>
                      <SelectContent>
                        {datasetOptions.map((ds) => (
                          <SelectItem key={ds.id} value={String(ds.id)}>{ds.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <Button variant="ghost" size="sm" className="text-violet-700" onClick={() => window.location.href = "/learn"}>Why this metric? -&gt;</Button>
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => window.location.href = "/"}>&lt;- Back</Button>
            <Button onClick={() => setStep(2)} disabled={!selectedTaskType} className="gap-2">
              Continue: Select Models <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-bold">Select Models</h2>
            <p className="text-sm text-muted-foreground">Choose one or more local models to evaluate.</p>
          </div>

          {modelsLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : models.length === 0 ? (
            <div className="text-center p-12 border border-dashed border-border rounded-xl bg-muted">
              <p className="text-muted-foreground mb-4">No models available.</p>
              <Button variant="outline" onClick={() => window.location.href = "/models"}>Go to Models Page</Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(models as any[]).map((model) => {
                const isSelected = selectedModels.includes(model.id);
                return (
                  <div
                    key={model.id}
                    onClick={() => setSelectedModels((prev) =>
                      prev.includes(model.id) ? prev.filter((m) => m !== model.id) : [...prev, model.id]
                    )}
                    className={clsx(
                      "p-4 rounded-xl border cursor-pointer transition-all bg-card shadow-soft flex items-start gap-4",
                      isSelected ? "border-violet-400 bg-violet-50" : "border-border hover:border-violet-300"
                    )}
                  >
                    <div className={clsx("mt-1 h-5 w-5 rounded border flex items-center justify-center", isSelected ? "bg-violet-600 border-violet-600 text-white" : "border-border")}>
                      {isSelected && <Check className="w-3.5 h-3.5" />}
                    </div>
                    <div>
                      <h4 className="font-semibold font-mono">{model.name}</h4>
                      <div className="flex gap-2 mt-2">
                        {model.family && <Badge variant="secondary" className="text-[10px] py-0">{model.family}</Badge>}
                        {model.params && <Badge variant="outline" className="text-[10px] py-0">{model.params}</Badge>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>&lt;- Back</Button>
            <Button onClick={() => setStep(3)} disabled={selectedModels.length === 0} className="gap-2">
              Continue: Review <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {step === 3 && selectedTask && (
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-bold">Review & Run</h2>
            <p className="text-sm text-muted-foreground">Confirm your choices before starting the evaluation.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
              <div className="text-xs font-semibold text-muted-foreground uppercase mb-3">Target Models</div>
              <ul className="space-y-2">
                {(models as any[]).filter((m) => selectedModels.includes(m.id)).map((m) => (
                  <li key={m.id} className="flex items-center gap-2 font-mono text-sm">
                    <Cpu className="w-4 h-4 text-violet-600" /> {m.name}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
              <div className="text-xs font-semibold text-muted-foreground uppercase mb-3">Task & Metrics</div>
              <div className="flex items-center gap-2 font-bold mb-3">
                <selectedTask.icon className="w-5 h-5 text-violet-600" /> {selectedTask.label}
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedTask.metrics.map((m) => (
                  <Badge key={m} variant="secondary" className="font-mono text-xs">{m}</Badge>
                ))}
              </div>
              {selectedTask.datasetHint && (
                <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
                  <BookOpen className="w-3 h-3" /> {selectedDataset?.name ?? selectedTask.datasetHint}
                </p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 to-emerald-50 p-4 flex items-start gap-3">
            <Activity className="w-5 h-5 text-violet-600 mt-0.5" />
            <p className="text-sm text-violet-900/70">
              This run will evaluate <span className="font-semibold">{selectedModels.length}</span> model{selectedModels.length !== 1 ? "s" : ""} on{" "}
              <span className="font-semibold">{selectedTask.label}</span>. Scores will be computed automatically and saved to your history.
            </p>
          </div>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>&lt;- Back</Button>
            <Button onClick={handleRun} disabled={createRun.isPending} className="gap-2">
              {createRun.isPending ? "Starting..." : "Start Evaluation"}
            </Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-10 text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4 mx-auto">
            <Check className="w-8 h-8 text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold mb-2">Evaluation Started!</h2>
          <p className="text-muted-foreground max-w-md mx-auto mb-6">
            Your models are being scored in the background. Check Run History or run details for live progress.
          </p>
          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={() => { setStep(1); setSelectedModels([]); setSelectedTaskType(null); }}>
              Run Another
            </Button>
            <Button onClick={() => window.location.href = lastRunId ? `/evaluate/${lastRunId}` : "/history"}>
              {lastRunId ? "View Latest Run" : "Go to Run History"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
