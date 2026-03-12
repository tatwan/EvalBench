import { useState } from "react";
import { useModels } from "@/hooks/use-models";
import { useCreateEvalRun } from "@/hooks/use-eval";
import { useDatasets } from "@/hooks/use-datasets";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Check, ChevronRight, Activity, Cpu, Layers, BookOpen, AlignLeft, MessageCircleQuestion, MessageSquare, Languages, Code2, BrainCircuit } from "lucide-react";
import { clsx } from "clsx";

// ─── Task types with auto-suggested metrics ─────────────────────────────────

const TASK_TYPES = [
  {
    id: "summarization",
    label: "Summarization",
    icon: AlignLeft,
    desc: "Condense long documents into concise summaries",
    metrics: ["ROUGE-1", "ROUGE-2", "ROUGE-L", "METEOR"],
    datasetHint: "EvalBench Summarization v1",
    color: "from-sky-500/20 to-blue-600/10 border-sky-500/30",
    activeColor: "from-sky-500/30 to-blue-600/20 border-sky-400 ring-sky-500/40",
  },
  {
    id: "qa",
    label: "Question & Answer",
    icon: MessageCircleQuestion,
    desc: "Extract answers from context passages",
    metrics: ["Exact Match", "Token F1", "ROUGE-1"],
    datasetHint: "EvalBench QA v1",
    color: "from-emerald-500/20 to-green-600/10 border-emerald-500/30",
    activeColor: "from-emerald-500/30 to-green-600/20 border-emerald-400 ring-emerald-500/40",
  },
  {
    id: "chat",
    label: "Open-Ended Chat",
    icon: MessageSquare,
    desc: "Evaluate response quality and diversity",
    metrics: ["Distinct-1", "Distinct-2", "ROUGE-1"],
    datasetHint: null,
    color: "from-violet-500/20 to-purple-600/10 border-violet-500/30",
    activeColor: "from-violet-500/30 to-purple-600/20 border-violet-400 ring-violet-500/40",
  },
  {
    id: "translation",
    label: "Translation",
    icon: Languages,
    desc: "Assess multilingual translation quality",
    metrics: ["BLEU", "chrF", "METEOR"],
    datasetHint: null,
    color: "from-amber-500/20 to-orange-600/10 border-amber-500/30",
    activeColor: "from-amber-500/30 to-orange-600/20 border-amber-400 ring-amber-500/40",
  },
  {
    id: "code",
    label: "Code Generation",
    icon: Code2,
    desc: "Evaluate code completeness and correctness",
    metrics: ["ROUGE-1", "Distinct-1", "Pass@k (Phase 3)"],
    datasetHint: null,
    color: "from-rose-500/20 to-red-600/10 border-rose-500/30",
    activeColor: "from-rose-500/30 to-red-600/20 border-rose-400 ring-rose-500/40",
  },
  {
    id: "reasoning",
    label: "Reasoning / Math",
    icon: BrainCircuit,
    desc: "Test logical reasoning and math problem solving",
    metrics: ["Exact Match", "Token F1"],
    datasetHint: null,
    color: "from-cyan-500/20 to-teal-600/10 border-cyan-500/30",
    activeColor: "from-cyan-500/30 to-teal-600/20 border-cyan-400 ring-cyan-500/40",
  },
];

export default function EvalWizard() {
  const [step, setStep] = useState(1);
  const [selectedModels, setSelectedModels] = useState<number[]>([]);
  const [selectedTaskType, setSelectedTaskType] = useState<string | null>(null);
  const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(null);

  const { data: models = [], isLoading: modelsLoading } = useModels();
  const { data: datasets = [] } = useDatasets();
  const createRun = useCreateEvalRun();

  const selectedTask = TASK_TYPES.find(t => t.id === selectedTaskType);

  // Auto-select matching dataset when task type is picked
  const handleSelectTask = (taskId: string) => {
    setSelectedTaskType(taskId);
    const task = TASK_TYPES.find(t => t.id === taskId);
    if (task?.datasetHint) {
      const ds = datasets.find((d: any) => d.name.toLowerCase().includes(task.datasetHint!.toLowerCase().split(" ")[1]));
      setSelectedDatasetId(ds?.id ?? null);
    } else {
      setSelectedDatasetId(null);
    }
  };

  const handleRun = () => {
    if (!selectedTaskType) return;
    createRun.mutate({
      modelIds: selectedModels,
      taskType: selectedTaskType,
      datasetId: selectedDatasetId ?? undefined,
    } as any, {
      onSuccess: () => setStep(4),
    });
  };

  const steps = [
    { num: 1, title: "Select Models", icon: Cpu },
    { num: 2, title: "Task Type", icon: Layers },
    { num: 3, title: "Review & Run", icon: Activity },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gradient">New Evaluation</h1>
        <p className="text-muted-foreground mt-2">Configure a benchmark run across your local models.</p>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center justify-between relative">
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-white/5 rounded-full -z-10" />
        <div
          className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-primary rounded-full -z-10 transition-all duration-500"
          style={{ width: `${((step - 1) / (steps.length - 1)) * 100}%` }}
        />
        {steps.map((s) => (
          <div key={s.num} className="flex flex-col items-center gap-2">
            <div className={clsx(
              "w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg border-2 transition-all duration-300",
              step > s.num ? "bg-primary border-primary text-white" :
              step === s.num ? "bg-card border-primary text-primary shadow-[0_0_15px_rgba(14,165,233,0.5)]" :
              "bg-card border-white/10 text-muted-foreground"
            )}>
              {step > s.num ? <Check className="w-6 h-6" /> : <s.icon className="w-5 h-5" />}
            </div>
            <span className={clsx("text-sm font-medium", step === s.num ? "text-foreground" : "text-muted-foreground")}>
              {s.title}
            </span>
          </div>
        ))}
      </div>

      <Card className="min-h-[440px] flex flex-col">

        {/* ── Step 1: Select Models ── */}
        {step === 1 && (
          <>
            <CardHeader>
              <CardTitle>Select Models to Evaluate</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto">
              {modelsLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : models.length === 0 ? (
                <div className="text-center p-12 border border-dashed border-white/10 rounded-xl">
                  <p className="text-muted-foreground mb-4">No models available.</p>
                  <Button variant="outline" onClick={() => window.location.href = '/models'}>Go to Models Page</Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {models.map((model: any) => {
                    const isSelected = selectedModels.includes(model.id);
                    return (
                      <div
                        key={model.id}
                        onClick={() => setSelectedModels(prev =>
                          prev.includes(model.id) ? prev.filter(m => m !== model.id) : [...prev, model.id]
                        )}
                        className={clsx(
                          "p-4 rounded-xl border cursor-pointer transition-all duration-200 flex items-start gap-4",
                          isSelected ? "bg-primary/10 border-primary ring-1 ring-primary/50" : "bg-white/5 border-white/10 hover:border-white/20"
                        )}
                      >
                        <div className={clsx("mt-1 w-5 h-5 rounded border flex items-center justify-center flex-shrink-0", isSelected ? "bg-primary border-primary text-white" : "border-muted-foreground")}>
                          {isSelected && <Check className="w-3.5 h-3.5" />}
                        </div>
                        <div>
                          <h4 className="font-semibold">{model.name}</h4>
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
            </CardContent>
            <CardFooter className="justify-between">
              <span className="text-sm text-muted-foreground">{selectedModels.length} models selected</span>
              <Button onClick={() => setStep(2)} disabled={selectedModels.length === 0} className="gap-2">
                Next <ChevronRight className="w-4 h-4" />
              </Button>
            </CardFooter>
          </>
        )}

        {/* ── Step 2: Task Type ── */}
        {step === 2 && (
          <>
            <CardHeader>
              <CardTitle>Choose Task Type</CardTitle>
              <p className="text-sm text-muted-foreground">The task type determines which metrics are computed for you automatically.</p>
            </CardHeader>
            <CardContent className="flex-1">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {TASK_TYPES.map(task => {
                  const isSelected = selectedTaskType === task.id;
                  return (
                    <div
                      key={task.id}
                      onClick={() => handleSelectTask(task.id)}
                      className={clsx(
                        "p-5 rounded-xl border bg-gradient-to-br cursor-pointer transition-all duration-200 flex flex-col gap-3",
                        isSelected
                          ? `${task.activeColor} ring-1`
                          : `${task.color} hover:brightness-110`
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <task.icon className={clsx("w-7 h-7", isSelected ? "text-foreground" : "text-muted-foreground")} />
                        {isSelected && (
                          <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        )}
                      </div>
                      <div>
                        <h4 className="font-bold">{task.label}</h4>
                        <p className="text-xs text-muted-foreground mt-1">{task.desc}</p>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-auto pt-2 border-t border-white/5">
                        {task.metrics.map(m => (
                          <span key={m} className="text-[10px] px-1.5 py-0.5 rounded bg-black/30 text-muted-foreground font-mono">
                            {m}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Dataset info */}
              {selectedTask && (
                <div className="mt-4 p-4 bg-white/5 border border-white/10 rounded-xl flex items-center gap-3">
                  <BookOpen className="w-4 h-4 text-primary flex-shrink-0" />
                  <p className="text-sm text-muted-foreground">
                    {selectedTask.datasetHint
                      ? <>Dataset: <span className="text-foreground font-medium">{selectedTask.datasetHint}</span> — auto-selected from your built-in datasets.</>
                      : <>No built-in dataset for this task type yet. Custom dataset support coming in Phase 3.</>
                    }
                    {!selectedTask.datasetHint && (
                      <span className="ml-1 text-amber-400"> Eval will run without reference scoring.</span>
                    )}
                  </p>
                </div>
              )}
            </CardContent>
            <CardFooter className="justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={() => setStep(3)} disabled={!selectedTaskType} className="gap-2">
                Next <ChevronRight className="w-4 h-4" />
              </Button>
            </CardFooter>
          </>
        )}

        {/* ── Step 3: Review & Run ── */}
        {step === 3 && selectedTask && (
          <>
            <CardHeader>
              <CardTitle>Review & Run</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="p-6 bg-white/5 rounded-xl border border-white/10">
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Target Models</h4>
                  <ul className="space-y-2">
                    {models.filter((m: any) => selectedModels.includes(m.id)).map((m: any) => (
                      <li key={m.id} className="flex items-center gap-2 font-mono text-sm">
                        <Cpu className="w-4 h-4 text-primary" /> {m.name}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="p-6 bg-white/5 rounded-xl border border-white/10">
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Task & Metrics</h4>
                  <div className="flex items-center gap-2 font-bold mb-3">
                    <selectedTask.icon className="w-5 h-5 text-primary" /> {selectedTask.label}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedTask.metrics.map(m => (
                      <Badge key={m} variant="secondary" className="font-mono text-xs">{m}</Badge>
                    ))}
                  </div>
                  {selectedTask.datasetHint && (
                    <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
                      <BookOpen className="w-3 h-3" /> {selectedTask.datasetHint}
                    </p>
                  )}
                </div>
              </div>

              <div className="p-4 bg-sky-500/10 border border-sky-500/20 rounded-xl flex items-start gap-4">
                <Activity className="w-5 h-5 text-sky-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-sky-100/80">
                  This run will evaluate <span className="font-bold text-sky-300">{selectedModels.length} model{selectedModels.length !== 1 ? "s" : ""}</span> on the <span className="font-bold text-sky-300">{selectedTask.label}</span> task.
                  Each model generates responses and is scored against reference outputs automatically.
                </p>
              </div>
            </CardContent>
            <CardFooter className="justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
              <Button
                onClick={handleRun}
                disabled={createRun.isPending}
                size="lg"
                className="w-48 text-lg font-bold shadow-[0_0_20px_rgba(14,165,233,0.4)] hover:shadow-[0_0_30px_rgba(14,165,233,0.6)]"
              >
                {createRun.isPending ? "Starting..." : "START EVAL"}
              </Button>
            </CardFooter>
          </>
        )}

        {/* ── Step 4: Started ── */}
        {step === 4 && (
          <CardContent className="flex-1 flex flex-col items-center justify-center py-16 text-center">
            <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mb-6 ring-4 ring-emerald-500/10 animate-pulse">
              <Check className="w-10 h-10 text-emerald-400" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Evaluation Started!</h2>
            <p className="text-muted-foreground max-w-md mb-8">
              Your models are being scored in the background. Check the Dashboard or go to the run details to see live progress.
            </p>
            <div className="flex gap-4">
              <Button variant="outline" onClick={() => { setStep(1); setSelectedModels([]); setSelectedTaskType(null); }}>
                Run Another
              </Button>
              <Button onClick={() => window.location.href = '/'}>Go to Dashboard</Button>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
