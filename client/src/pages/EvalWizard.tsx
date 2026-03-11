import { useState } from "react";
import { useModels } from "@/hooks/use-models";
import { useCreateEvalRun } from "@/hooks/use-eval";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Check, ChevronRight, Activity, Cpu, Layers } from "lucide-react";
import { clsx } from "clsx";

const BENCHMARKS = [
  { id: "mmlu", name: "MMLU", desc: "Massive Multitask Language Understanding (57 subjects)", tags: ["knowledge", "reasoning"] },
  { id: "hellaswag", name: "HellaSwag", desc: "Commonsense natural language inference", tags: ["commonsense"] },
  { id: "gsm8k", name: "GSM8K", desc: "Grade school math word problems", tags: ["math", "reasoning"] },
  { id: "truthfulqa", name: "TruthfulQA", desc: "Test propensity to generate falsehoods", tags: ["safety", "factual"] },
];

export default function EvalWizard() {
  const [step, setStep] = useState(1);
  const [selectedModels, setSelectedModels] = useState<number[]>([]);
  const [selectedBenchmarks, setSelectedBenchmarks] = useState<string[]>([]);
  
  const { data: models = [], isLoading: modelsLoading } = useModels();
  const createRun = useCreateEvalRun();

  const toggleModel = (id: number) => {
    setSelectedModels(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]);
  };

  const toggleBenchmark = (id: string) => {
    setSelectedBenchmarks(prev => prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id]);
  };

  const handleRun = () => {
    createRun.mutate({
      modelIds: selectedModels,
      benchmarkKeys: selectedBenchmarks,
    }, {
      onSuccess: () => {
        setStep(4); // Success step
      }
    });
  };

  const steps = [
    { num: 1, title: "Select Models", icon: Cpu },
    { num: 2, title: "Choose Benchmarks", icon: Layers },
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

      <Card className="min-h-[400px] flex flex-col">
        {step === 1 && (
          <>
            <CardHeader>
              <CardTitle>Select Models to Evaluate</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto">
              {modelsLoading ? (
                <div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>
              ) : models.length === 0 ? (
                <div className="text-center p-12 border border-dashed border-white/10 rounded-xl">
                  <p className="text-muted-foreground mb-4">No models available.</p>
                  <Button variant="outline" onClick={() => window.location.href = '/models'}>Go to Models Page</Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {models.map(model => {
                    const isSelected = selectedModels.includes(model.id);
                    return (
                      <div 
                        key={model.id}
                        onClick={() => toggleModel(model.id)}
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
                    )
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

        {step === 2 && (
          <>
            <CardHeader>
              <CardTitle>Choose Benchmarks</CardTitle>
            </CardHeader>
            <CardContent className="flex-1">
              <div className="space-y-3">
                {BENCHMARKS.map(bench => {
                  const isSelected = selectedBenchmarks.includes(bench.id);
                  return (
                    <div 
                      key={bench.id}
                      onClick={() => toggleBenchmark(bench.id)}
                      className={clsx(
                        "p-5 rounded-xl border cursor-pointer transition-all duration-200 flex items-center justify-between",
                        isSelected ? "bg-primary/10 border-primary ring-1 ring-primary/50" : "bg-white/5 border-white/10 hover:border-white/20"
                      )}
                    >
                      <div>
                        <div className="flex items-center gap-3">
                          <h4 className="font-semibold text-lg">{bench.name}</h4>
                          <div className="flex gap-2">
                            {bench.tags.map(tag => (
                              <Badge key={tag} variant="secondary" className="bg-white/5 text-[10px] uppercase">{tag}</Badge>
                            ))}
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{bench.desc}</p>
                      </div>
                      <div className={clsx("w-6 h-6 rounded-full border-2 flex items-center justify-center", isSelected ? "bg-primary border-primary text-white" : "border-muted-foreground")}>
                         {isSelected && <Check className="w-4 h-4" />}
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
            <CardFooter className="justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={() => setStep(3)} disabled={selectedBenchmarks.length === 0} className="gap-2">
                Next <ChevronRight className="w-4 h-4" />
              </Button>
            </CardFooter>
          </>
        )}

        {step === 3 && (
          <>
            <CardHeader>
              <CardTitle>Review & Run</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="p-6 bg-white/5 rounded-xl border border-white/10">
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Target Models</h4>
                  <ul className="space-y-2">
                    {models.filter(m => selectedModels.includes(m.id)).map(m => (
                      <li key={m.id} className="flex items-center gap-2 font-mono text-sm">
                        <Cpu className="w-4 h-4 text-primary" /> {m.name}
                      </li>
                    ))}
                  </ul>
                </div>
                
                <div className="p-6 bg-white/5 rounded-xl border border-white/10">
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Test Suite</h4>
                  <ul className="space-y-2">
                    {BENCHMARKS.filter(b => selectedBenchmarks.includes(b.id)).map(b => (
                      <li key={b.id} className="flex items-center gap-2 font-mono text-sm">
                        <Layers className="w-4 h-4 text-emerald-400" /> {b.name}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              
              <div className="p-4 bg-sky-500/10 border border-sky-500/20 rounded-xl flex items-start gap-4">
                <Activity className="w-5 h-5 text-sky-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-sky-100/80">
                  This run will execute {selectedModels.length * selectedBenchmarks.length} evaluation matrix pairs. 
                  Depending on hardware, this may take several minutes.
                </p>
              </div>
            </CardContent>
            <CardFooter className="justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
              <Button onClick={handleRun} isLoading={createRun.isPending} size="lg" className="w-48 text-lg font-bold shadow-[0_0_20px_rgba(14,165,233,0.4)] hover:shadow-[0_0_30px_rgba(14,165,233,0.6)]">
                START EVAL
              </Button>
            </CardFooter>
          </>
        )}

        {step === 4 && (
          <CardContent className="flex-1 flex flex-col items-center justify-center py-16 text-center">
            <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mb-6 ring-4 ring-emerald-500/10 animate-pulse">
              <Check className="w-10 h-10 text-emerald-400" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Evaluation Started!</h2>
            <p className="text-muted-foreground max-w-md mb-8">
              Your models are currently being tested in the background. You can monitor progress on the dashboard.
            </p>
            <div className="flex gap-4">
              <Button variant="outline" onClick={() => setStep(1)}>Run Another</Button>
              <Button onClick={() => window.location.href = '/'}>Go to Dashboard</Button>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
