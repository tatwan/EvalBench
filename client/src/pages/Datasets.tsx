import { ChangeEvent, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { useLocation } from "wouter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ClipboardCopy,
  CopyPlus,
  Database,
  FileJson,
  FolderUp,
  History,
  Plus,
  Sparkles,
  Table2,
  Trash2,
  Upload,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/Badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useEvalRuns } from "@/hooks/use-eval";
import { useModels } from "@/hooks/use-models";
import {
  useCreateDataset,
  useDeleteDataset,
  useDataset,
  useDatasets,
  useImportDataset,
  usePreviewDatasetImport,
} from "@/hooks/use-datasets";
import { useToast } from "@/hooks/use-toast";

type BuilderItem = {
  input: string;
  expectedOutput: string;
  context: string;
  difficulty: string;
  tags: string;
};

type DatasetTab = "builder" | "import";
type TemplateId = "custom" | "qa" | "summarization" | "translation" | "reasoning" | "code" | "embedding";

type TaskTemplate = {
  label: string;
  description: string;
  suggestedName: string;
  source: string;
  importColumns: string[];
  items: BuilderItem[];
};

const EMPTY_ITEM: BuilderItem = {
  input: "",
  expectedOutput: "",
  context: "",
  difficulty: "",
  tags: "",
};

const TASK_TEMPLATES: Record<Exclude<TemplateId, "custom">, TaskTemplate> = {
  qa: {
    label: "Question Answering",
    description: "Best for support, interviews, knowledge checks, and exact-answer evaluation.",
    suggestedName: "QA Dataset",
    source: "template:qa",
    importColumns: ["input", "expected_output", "difficulty", "tags", "context"],
    items: [
      {
        input: "What is EvalBench?",
        expectedOutput: "EvalBench is a local-first workbench for evaluating models, prompts, and datasets.",
        difficulty: "easy",
        context: "Product overview",
        tags: "qa,product",
      },
      {
        input: "Why should failed inference rows be excluded from benchmark quality scores?",
        expectedOutput: "Because infrastructure failures reflect system reliability, not model quality, and mixing them into quality metrics distorts comparisons.",
        difficulty: "medium",
        context: "Reliability policy",
        tags: "qa,reliability,metrics",
      },
    ],
  },
  summarization: {
    label: "Summarization",
    description: "Use when the input is long-form source material and the output is a concise grounded summary.",
    suggestedName: "Summarization Dataset",
    source: "template:summarization",
    importColumns: ["input", "expected_output", "difficulty", "tags", "context"],
    items: [
      {
        input: "Retrieval-augmented generation improves factual grounding by retrieving relevant context before generation, which helps reduce hallucinations and improves traceability. However, it introduces retrieval latency and requires careful chunking and indexing.",
        expectedOutput: "Retrieval-augmented generation improves factuality and traceability by using retrieved context, but it adds latency and depends on good indexing and chunking.",
        difficulty: "medium",
        context: "One-paragraph technical summary",
        tags: "summarization,rag",
      },
      {
        input: "Confidence intervals communicate uncertainty around an estimate. They help teams avoid overreacting to tiny differences between models when the underlying sample is small or noisy.",
        expectedOutput: "Confidence intervals show uncertainty in model estimates and prevent overconfidence in small score differences.",
        difficulty: "easy",
        context: "Short business-style summary",
        tags: "summarization,statistics",
      },
    ],
  },
  translation: {
    label: "Translation",
    description: "Use for bilingual evaluation where the expected output is a reference translation.",
    suggestedName: "Translation Dataset",
    source: "template:translation",
    importColumns: ["input", "expected_output", "difficulty", "tags", "context"],
    items: [
      {
        input: "Translate to Arabic: The meeting starts at nine o'clock.",
        expectedOutput: "يبدأ الاجتماع في الساعة التاسعة.",
        difficulty: "easy",
        context: "Modern Standard Arabic",
        tags: "translation,arabic",
      },
      {
        input: "Translate to French: Reliability metrics help teams distinguish product quality from infrastructure noise.",
        expectedOutput: "Les indicateurs de fiabilité aident les équipes à distinguer la qualité du produit du bruit lié à l'infrastructure.",
        difficulty: "medium",
        context: "Professional tone",
        tags: "translation,french,reliability",
      },
    ],
  },
  reasoning: {
    label: "Reasoning",
    description: "For multi-step logic, math, and chain-of-thought style tasks with a final target answer.",
    suggestedName: "Reasoning Dataset",
    source: "template:reasoning",
    importColumns: ["input", "expected_output", "difficulty", "tags", "context"],
    items: [
      {
        input: "A team runs 20 eval pairs. Two pairs fail, three pairs require one retry, and the rest succeed immediately. How many pairs succeeded without retries?",
        expectedOutput: "15",
        difficulty: "medium",
        context: "Arithmetic reasoning",
        tags: "reasoning,math",
      },
      {
        input: "If model A scores 0.81 and model B scores 0.79, can you claim A is better without confidence intervals?",
        expectedOutput: "No",
        difficulty: "easy",
        context: "Evaluation methodology",
        tags: "reasoning,methodology",
      },
    ],
  },
  code: {
    label: "Code",
    description: "For function generation and coding tasks where correctness and tests matter.",
    suggestedName: "Code Dataset",
    source: "template:code",
    importColumns: ["input", "expected_output", "context", "difficulty", "tags"],
    items: [
      {
        input: "Write a Python function `is_even(n)` that returns True when n is even and False otherwise.",
        expectedOutput: "def is_even(n):\n    return n % 2 == 0",
        difficulty: "easy",
        context: '{"tests": ["assert is_even(2) is True", "assert is_even(3) is False"]}',
        tags: "code,python",
      },
      {
        input: "Write a JavaScript function `sum(arr)` that returns the sum of numeric items in an array.",
        expectedOutput: "function sum(arr) {\n  return arr.reduce((total, value) => total + value, 0);\n}",
        difficulty: "easy",
        context: '{"tests": ["console.assert(sum([1,2,3]) === 6)", "console.assert(sum([]) === 0)"]}',
        tags: "code,javascript",
      },
    ],
  },
  embedding: {
    label: "Embeddings",
    description: "Use when each item contains a query and the correct candidate should rank highest by similarity.",
    suggestedName: "Embeddings Dataset",
    source: "template:embedding",
    importColumns: ["input", "expected_output", "context", "difficulty", "tags"],
    items: [
      {
        input: "How do I stop a running benchmark?",
        expectedOutput: "Use the cancel action in run details to request cancellation.",
        difficulty: "medium",
        context: '{"candidates":["Use the cancel action in run details to request cancellation.","Open the model leaderboard to compare scores.","Go to settings and add your API key."],"answer_index":0}',
        tags: "embedding,retrieval",
      },
      {
        input: "What does a golden dataset represent?",
        expectedOutput: "A curated set of inputs and expected outputs used to evaluate model behavior.",
        difficulty: "easy",
        context: '{"candidates":["A curated set of inputs and expected outputs used to evaluate model behavior.","A list of available local model files.","A report export format for eval results."],"answer_index":0}',
        tags: "embedding,datasets",
      },
    ],
  },
};

const SAMPLE_JSON = JSON.stringify(
  [
    {
      input: "Summarize the benefits of retrieval-augmented generation in one paragraph.",
      expected_output:
        "Retrieval-augmented generation improves factual grounding by retrieving relevant source material before generating an answer, which reduces hallucinations and makes responses more trustworthy.",
      difficulty: "medium",
      tags: ["summarization", "rag"],
    },
    {
      input: "Translate 'The meeting starts at nine o'clock.' into Arabic.",
      expected_output: "يبدأ الاجتماع في الساعة التاسعة.",
      difficulty: "easy",
      tags: ["translation"],
    },
  ],
  null,
  2
);

const SAMPLE_CSV = `input,expected_output,difficulty,tags
"What is EvalBench?","EvalBench is a local-first workbench for evaluating models and prompts.","easy","qa,product"
"Write a one-line summary of why confidence intervals matter.","Confidence intervals show the uncertainty around an estimated score, not just the average.","medium","summarization,stats"`;

function formatTags(tags: unknown): string {
  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag).trim()).filter(Boolean).join(", ");
  }
  if (typeof tags === "string") {
    return tags;
  }
  return "";
}

function parseTagsInput(tags: string): string[] | undefined {
  const parsed = tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  return parsed.length ? parsed : undefined;
}

function detectTemplateFromSource(source: string | null | undefined): TemplateId {
  const cleaned = String(source ?? "").toLowerCase();
  const match = cleaned.match(/template:(qa|summarization|translation|reasoning|code|embedding)/);
  return (match?.[1] as TemplateId | undefined) ?? "custom";
}

function isUserDataset(source: string | null | undefined): boolean {
  const cleaned = String(source ?? "").toLowerCase();
  return cleaned !== "curated-inline";
}

function datasetKind(source: string | null | undefined): "built-in" | "custom" | "imported" {
  const cleaned = String(source ?? "").toLowerCase();
  if (cleaned === "curated-inline") return "built-in";
  if (cleaned.startsWith("import") || cleaned.startsWith("upload")) return "imported";
  return "custom";
}

type ValidationIssue = {
  severity: "error" | "warning";
  message: string;
};

function validateBuilderItems(templateId: TemplateId, items: BuilderItem[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const populated = items.filter(
    (item) =>
      item.input.trim() ||
      item.expectedOutput.trim() ||
      item.context.trim() ||
      item.difficulty.trim() ||
      item.tags.trim()
  );

  if (populated.length === 0) {
    issues.push({ severity: "error", message: "Add at least one item before saving." });
    return issues;
  }

  populated.forEach((item, index) => {
    const label = `Item ${index + 1}`;
    if (!item.input.trim()) issues.push({ severity: "error", message: `${label} is missing input.` });
    if (!item.expectedOutput.trim()) issues.push({ severity: "error", message: `${label} is missing expected output.` });
  });

  if (templateId === "summarization") {
    populated.forEach((item, index) => {
      if (item.input.trim().length < 120) {
        issues.push({
          severity: "warning",
          message: `Item ${index + 1} looks short for summarization. Longer source passages produce more meaningful summary metrics.`,
        });
      }
    });
  }

  if (templateId === "translation") {
    populated.forEach((item, index) => {
      if (item.input.trim() === item.expectedOutput.trim()) {
        issues.push({
          severity: "warning",
          message: `Item ${index + 1} has identical input and expected output. Double-check that this is really a translation pair.`,
        });
      }
    });
  }

  if (templateId === "code") {
    populated.forEach((item, index) => {
      if (!item.context.trim()) {
        issues.push({
          severity: "error",
          message: `Item ${index + 1} needs JSON context with a tests array for code evaluation.`,
        });
        return;
      }
      try {
        const parsed = JSON.parse(item.context);
        if (!Array.isArray(parsed.tests) || parsed.tests.length === 0) {
          issues.push({
            severity: "error",
            message: `Item ${index + 1} context must include a non-empty "tests" array.`,
          });
        }
      } catch {
        issues.push({
          severity: "error",
          message: `Item ${index + 1} context must be valid JSON for code evaluation.`,
        });
      }
    });
  }

  if (templateId === "embedding") {
    populated.forEach((item, index) => {
      if (!item.context.trim()) {
        issues.push({
          severity: "error",
          message: `Item ${index + 1} needs JSON context with candidates and answer_index for embedding evaluation.`,
        });
        return;
      }
      try {
        const parsed = JSON.parse(item.context);
        if (!Array.isArray(parsed.candidates) || parsed.candidates.length < 2) {
          issues.push({
            severity: "error",
            message: `Item ${index + 1} context must include at least two "candidates".`,
          });
        }
        if (typeof parsed.answer_index !== "number") {
          issues.push({
            severity: "error",
            message: `Item ${index + 1} context must include numeric "answer_index".`,
          });
        }
      } catch {
        issues.push({
          severity: "error",
          message: `Item ${index + 1} context must be valid JSON for embedding evaluation.`,
        });
      }
    });
  }

  return issues;
}

export default function Datasets() {
  const [, navigate] = useLocation();
  const { data: datasets = [], isLoading } = useDatasets();
  const { data: runs = [] } = useEvalRuns();
  const { data: models = [] } = useModels();
  const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(null);
  const { data: selectedDataset } = useDataset(selectedDatasetId);
  const createDataset = useCreateDataset();
  const deleteDataset = useDeleteDataset();
  const previewImport = usePreviewDatasetImport();
  const importDataset = useImportDataset();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [activeTab, setActiveTab] = useState<DatasetTab>("builder");
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId>("qa");
  const [datasetSearch, setDatasetSearch] = useState("");

  const [manualName, setManualName] = useState("");
  const [manualSource, setManualSource] = useState("manual");
  const [manualItems, setManualItems] = useState<BuilderItem[]>([{ ...EMPTY_ITEM }, { ...EMPTY_ITEM }]);

  const [importName, setImportName] = useState("");
  const [importSource, setImportSource] = useState("import");
  const [importFormat, setImportFormat] = useState<"json" | "csv">("json");
  const [importContent, setImportContent] = useState(SAMPLE_JSON);
  const [importError, setImportError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const totalItems = useMemo(
    () => (datasets as any[]).reduce((sum, dataset) => sum + (dataset.itemCount ?? 0), 0),
    [datasets]
  );
  const userDatasets = useMemo(
    () =>
      (datasets as any[]).filter((dataset) => {
        const source = String(dataset.source ?? "").toLowerCase();
        return source.includes("manual") || source.includes("import") || source.includes("template");
      }).length,
    [datasets]
  );
  const latestVersionByName = useMemo(() => {
    const map = new Map<string, number>();
    (datasets as any[]).forEach((dataset) => {
      const current = map.get(dataset.name) ?? 0;
      map.set(dataset.name, Math.max(current, dataset.schemaVersion ?? 1));
    });
    return map;
  }, [datasets]);
  const selectedDatasetKind = datasetKind(selectedDataset?.source);
  const selectedDatasetIsUser = isUserDataset(selectedDataset?.source);

  const filteredDatasets = useMemo(() => {
    const query = datasetSearch.trim().toLowerCase();
    return (datasets as any[]).filter((dataset) => {
      if (!query) return true;
      return [dataset.name, dataset.source, `v${dataset.schemaVersion ?? 1}`]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [datasets, datasetSearch]);
  const filledManualItems = useMemo(
    () =>
      manualItems.filter(
        (item) =>
          item.input.trim() ||
          item.expectedOutput.trim() ||
          item.context.trim() ||
          item.difficulty.trim() ||
          item.tags.trim()
      ),
    [manualItems]
  );
  const shouldShowBuilderValidation = manualName.trim().length > 0 || filledManualItems.length > 0;
  const builderValidationIssues = useMemo(
    () => validateBuilderItems(selectedTemplate, manualItems),
    [selectedTemplate, manualItems]
  );
  const builderErrors = builderValidationIssues.filter((issue) => issue.severity === "error");
  const builderWarnings = builderValidationIssues.filter((issue) => issue.severity === "warning");
  const modelMap = useMemo(
    () => Object.fromEntries((models as any[]).map((model) => [model.id, model.name])),
    [models]
  );
  const datasetUsage = useMemo(() => {
    if (!selectedDatasetId) return [];
    return [...(runs as any[])]
      .filter((run) => run.configJson?.datasetId === selectedDatasetId)
      .sort((a, b) => new Date(b.timestamp ?? 0).getTime() - new Date(a.timestamp ?? 0).getTime())
      .slice(0, 6);
  }, [runs, selectedDatasetId]);

  const currentTemplate = selectedTemplate === "custom" ? null : TASK_TEMPLATES[selectedTemplate];

  const updateManualItem = (index: number, patch: Partial<BuilderItem>) => {
    setManualItems((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
    );
  };
  const duplicateManualItem = (index: number) => {
    setManualItems((current) => {
      const clone = { ...current[index] };
      const next = [...current];
      next.splice(index + 1, 0, clone);
      return next;
    });
  };
  const moveManualItem = (index: number, direction: "up" | "down") => {
    setManualItems((current) => {
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const resetManualForm = () => {
    setManualName("");
    setManualSource("manual");
    setSelectedTemplate("qa");
    setManualItems([{ ...EMPTY_ITEM }, { ...EMPTY_ITEM }]);
  };

  const applyTemplate = () => {
    if (!currentTemplate) return;
    setManualName((current) => current.trim() || currentTemplate.suggestedName);
    setManualSource(currentTemplate.source);
    setManualItems(currentTemplate.items.map((item) => ({ ...item })));
    setActiveTab("builder");
    toast({
      title: `${currentTemplate.label} template loaded`,
      description: "You can tweak the examples before saving a new dataset version.",
    });
  };

  const loadSelectedDatasetIntoBuilder = () => {
    if (!selectedDataset) return;
    setSelectedTemplate(detectTemplateFromSource(selectedDataset.source));
    setManualName(selectedDataset.name);
    setManualSource(selectedDataset.source === "curated-inline" ? "manual:derived" : selectedDataset.source ?? "manual");
    setManualItems(
      selectedDataset.items.length
        ? selectedDataset.items.map((item) => ({
            input: item.input,
            expectedOutput: item.expectedOutput,
            context: item.context ?? "",
            difficulty: item.difficulty ?? "",
            tags: formatTags(item.tags),
          }))
        : [{ ...EMPTY_ITEM }]
    );
    setActiveTab("builder");
    toast({
      title: "Loaded into builder",
      description: `Editing ${selectedDataset.name} v${selectedDataset.schemaVersion ?? 1} will create the next version when you save.`,
    });
  };

  const handleCreateDataset = async () => {
    if (!manualName.trim()) {
      toast({ title: "Dataset name required", variant: "destructive" });
      return;
    }
    if (builderErrors.length > 0) {
      toast({
        title: "Fix validation issues before saving",
        description: builderErrors[0]?.message,
        variant: "destructive",
      });
      return;
    }

    try {
      const created = await createDataset.mutateAsync({
        name: manualName.trim(),
        source: manualSource.trim() || "manual",
        items: filledManualItems.map((item) => ({
          input: item.input.trim(),
          expectedOutput: item.expectedOutput.trim(),
          context: item.context.trim() || undefined,
          difficulty: item.difficulty.trim() || undefined,
          tags: parseTagsInput(item.tags),
        })),
      });
      setSelectedDatasetId(created.id);
      resetManualForm();
    } catch (error) {
      toast({
        title: "Could not create dataset",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handlePreviewImport = async () => {
    setImportError(null);
    if (!importName.trim()) {
      toast({
        title: "Dataset name required",
        description: "Name the dataset before previewing.",
        variant: "destructive",
      });
      return;
    }
    try {
      await previewImport.mutateAsync({
        name: importName.trim(),
        source: importSource.trim() || "import",
        format: importFormat,
        content: importContent,
      });
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Unknown error");
      toast({
        title: "Import preview failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleImportDataset = async () => {
    setImportError(null);
    if (!importName.trim()) {
      toast({ title: "Dataset name required", variant: "destructive" });
      return;
    }
    try {
      const imported = await importDataset.mutateAsync({
        name: importName.trim(),
        source: importSource.trim() || `import:${importFormat}`,
        format: importFormat,
        content: importContent,
      });
      setSelectedDatasetId(imported.id);
      setImportName("");
      setImportSource("import");
      setImportContent(importFormat === "json" ? SAMPLE_JSON : SAMPLE_CSV);
      previewImport.reset();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Unknown error");
      toast({
        title: "Dataset import failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setImportError(null);
      const text = await file.text();
      const isCsv = file.name.toLowerCase().endsWith(".csv");
      setImportFormat(isCsv ? "csv" : "json");
      setImportContent(text);
      setImportName((current) => current.trim() || file.name.replace(/\.[^.]+$/, ""));
      setImportSource((current) => (current === "import" ? `upload:${isCsv ? "csv" : "json"}` : current));
      setActiveTab("import");
      previewImport.reset();
      toast({
        title: "File loaded",
        description: `${file.name} is ready for preview and import.`,
      });
    } catch (error) {
      toast({
        title: "Could not read file",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      event.target.value = "";
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.csv,application/json,text/csv"
        className="hidden"
        onChange={handleFileUpload}
      />

      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Database className="w-8 h-8 text-primary" />
            Dataset Builder
          </h1>
          <p className="text-muted-foreground mt-2">
            Create, import, version, and inspect golden datasets that power trustworthy evaluations.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{datasets.length} datasets</Badge>
          <Badge variant="outline">{totalItems} total items</Badge>
          <Badge variant="outline">{userDatasets} user-created/imported</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="shadow-soft">
          <CardContent className="p-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Dataset Registry</div>
            <div className="text-3xl font-extrabold mt-2">{datasets.length}</div>
            <div className="text-sm text-muted-foreground mt-1">
              Built-in, custom, and imported versions ready for Eval Wizard.
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-soft">
          <CardContent className="p-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Coverage</div>
            <div className="text-3xl font-extrabold mt-2">{totalItems}</div>
            <div className="text-sm text-muted-foreground mt-1">
              Golden items available across evaluation tasks and custom workflows.
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-soft">
          <CardContent className="p-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Versioning</div>
            <div className="text-3xl font-extrabold mt-2">
              {Math.max(...(datasets as any[]).map((dataset) => dataset.schemaVersion ?? 1), 1)}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              Save a dataset with the same name to create the next schema version automatically.
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Build Or Import</CardTitle>
            <CardDescription>
              Start from a task-aware template, edit an existing version, or import CSV/JSON from a local file.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as DatasetTab)} className="space-y-4">
              <TabsList>
                <TabsTrigger value="builder" className="gap-2">
                  <Plus className="w-4 h-4" />
                  Manual Builder
                </TabsTrigger>
                <TabsTrigger value="import" className="gap-2">
                  <Upload className="w-4 h-4" />
                  Import
                </TabsTrigger>
              </TabsList>

              <TabsContent value="builder" className="space-y-4">
                <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 space-y-3">
                  <div className="flex flex-col md:flex-row md:items-end gap-3">
                    <div className="flex-1 space-y-2">
                      <label className="text-sm font-medium">Task Template</label>
                      <Select value={selectedTemplate} onValueChange={(value) => setSelectedTemplate(value as TemplateId)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a template" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="custom">Custom / freeform</SelectItem>
                          {Object.entries(TASK_TEMPLATES).map(([key, template]) => (
                            <SelectItem key={key} value={key}>
                              {template.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button variant="outline" onClick={applyTemplate} disabled={!currentTemplate}>
                      Apply Template
                    </Button>
                  </div>
                  {currentTemplate ? (
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">{currentTemplate.description}</div>
                      <div className="flex flex-wrap gap-2">
                        {currentTemplate.importColumns.map((column) => (
                          <Badge key={column} variant="outline">
                            {column}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      Use custom mode for freeform datasets or load an existing version into the builder.
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Dataset Name</label>
                    <Input value={manualName} onChange={(event) => setManualName(event.target.value)} placeholder="Acme Support QA" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Source / Provenance</label>
                    <Input
                      value={manualSource}
                      onChange={(event) => setManualSource(event.target.value)}
                      placeholder="manual, internal-docs, hiring-screen"
                    />
                  </div>
                </div>

                {shouldShowBuilderValidation && (builderErrors.length > 0 || builderWarnings.length > 0) && (
                  <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      Builder Validation
                    </div>
                    <div className="space-y-2">
                      {builderErrors.map((issue, index) => (
                        <div key={`builder-error-${index}`} className="text-sm text-rose-700">
                          {issue.message}
                        </div>
                      ))}
                      {builderWarnings.map((issue, index) => (
                        <div key={`builder-warning-${index}`} className="text-sm text-amber-700">
                          {issue.message}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  {manualItems.map((item, index) => (
                    <Card key={`manual-item-${index}`} className="border-border/70">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-semibold">Item {index + 1}</div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => moveManualItem(index, "up")}
                              disabled={index === 0}
                            >
                              <ArrowUp className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => moveManualItem(index, "down")}
                              disabled={index === manualItems.length - 1}
                            >
                              <ArrowDown className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => duplicateManualItem(index)}>
                              <ClipboardCopy className="w-4 h-4" />
                            </Button>
                            {manualItems.length > 1 ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setManualItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
                                }
                              >
                                Remove
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground">Input</label>
                          <Textarea
                            value={item.input}
                            onChange={(event) => updateManualItem(index, { input: event.target.value })}
                            placeholder="Prompt, question, or task input"
                            className="min-h-[80px]"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground">Expected Output</label>
                          <Textarea
                            value={item.expectedOutput}
                            onChange={(event) => updateManualItem(index, { expectedOutput: event.target.value })}
                            placeholder="Reference answer or target response"
                            className="min-h-[80px]"
                          />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="space-y-2 md:col-span-2">
                            <label className="text-xs font-medium text-muted-foreground">Context (optional)</label>
                            <Textarea
                              value={item.context}
                              onChange={(event) => updateManualItem(index, { context: event.target.value })}
                              placeholder="Additional metadata, tests, or retrieval candidates"
                              className="min-h-[70px]"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">Difficulty (optional)</label>
                            <Input
                              value={item.difficulty}
                              onChange={(event) => updateManualItem(index, { difficulty: event.target.value })}
                              placeholder="easy / medium / hard"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground">Tags (optional)</label>
                          <Input
                            value={item.tags}
                            onChange={(event) => updateManualItem(index, { tags: event.target.value })}
                            placeholder="qa, support, reliability"
                          />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button variant="outline" onClick={() => setManualItems((current) => [...current, { ...EMPTY_ITEM }])}>
                    Add Row
                  </Button>
                  <Button onClick={handleCreateDataset} disabled={createDataset.isPending}>
                    Save Dataset
                  </Button>
                </div>

                <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4">
                  <div className="text-sm font-semibold mb-2">Builder Preview</div>
                  {filledManualItems.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      Add rows above to preview the dataset that will be saved.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filledManualItems.slice(0, 3).map((item, index) => (
                        <div key={`preview-${index}`} className="rounded-lg border border-border bg-background p-3">
                          <div className="text-xs uppercase tracking-wider text-muted-foreground">Item {index + 1}</div>
                          <div className="mt-2 text-sm">
                            <span className="font-semibold">Input:</span> {item.input}
                          </div>
                          <div className="mt-1 text-sm">
                            <span className="font-semibold">Expected:</span> {item.expectedOutput}
                          </div>
                          {item.tags ? (
                            <div className="mt-1 text-xs text-muted-foreground">Tags: {item.tags}</div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="import" className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_220px_1fr] gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Dataset Name</label>
                    <Input
                      value={importName}
                      onChange={(event) => setImportName(event.target.value)}
                      placeholder="Customer Support Eval Set"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Format</label>
                    <Select
                      value={importFormat}
                      onValueChange={(value: "json" | "csv") => {
                        setImportFormat(value);
                        setImportContent(value === "json" ? SAMPLE_JSON : SAMPLE_CSV);
                        setImportError(null);
                        previewImport.reset();
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select import format" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="json">JSON</SelectItem>
                        <SelectItem value="csv">CSV</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Source / Provenance</label>
                    <Input
                      value={importSource}
                      onChange={(event) => setImportSource(event.target.value)}
                      placeholder="import, exports, spreadsheet"
                    />
                  </div>
                </div>

                <div
                  className={`rounded-xl border border-dashed p-4 space-y-3 transition-colors ${
                    dragActive
                      ? "border-primary bg-primary/5"
                      : "border-border bg-muted/30"
                  }`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragActive(true);
                  }}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault();
                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                    setDragActive(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragActive(false);
                    const file = event.dataTransfer.files?.[0];
                    if (!file) return;
                    const syntheticEvent = {
                      target: { files: [file], value: "" },
                    } as unknown as ChangeEvent<HTMLInputElement>;
                    void handleFileUpload(syntheticEvent);
                  }}
                >
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                      <FolderUp className="w-4 h-4 mr-2" />
                      Upload Local File
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                    onClick={() => {
                      setImportFormat("json");
                      setImportContent(SAMPLE_JSON);
                      setImportError(null);
                      previewImport.reset();
                    }}
                    >
                      <FileJson className="w-4 h-4 mr-2" />
                      Load JSON Example
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                    onClick={() => {
                      setImportFormat("csv");
                      setImportContent(SAMPLE_CSV);
                      setImportError(null);
                      previewImport.reset();
                    }}
                    >
                      <Table2 className="w-4 h-4 mr-2" />
                      Load CSV Example
                    </Button>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Expected columns/keys: <span className="font-medium">input</span>, <span className="font-medium">expected_output</span>, with optional <span className="font-medium">context</span>, <span className="font-medium">difficulty</span>, and <span className="font-medium">tags</span>.
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Drag and drop a local CSV/JSON file here, or use the upload button above.
                  </div>
                </div>

                {importError ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                    {importError}
                  </div>
                ) : null}

                <div className="space-y-2">
                  <label className="text-sm font-medium">Paste Dataset Content</label>
                  <Textarea
                    value={importContent}
                    onChange={(event) => {
                      setImportContent(event.target.value);
                      setImportError(null);
                    }}
                    className="min-h-[320px] font-mono text-xs"
                    placeholder="Paste JSON array or CSV content here"
                  />
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button variant="outline" onClick={handlePreviewImport} disabled={previewImport.isPending}>
                    Preview Import
                  </Button>
                  <Button onClick={handleImportDataset} disabled={importDataset.isPending}>
                    Import Dataset
                  </Button>
                </div>

                <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold mb-2">
                    <Sparkles className="w-4 h-4 text-amber-500" />
                    Import Preview
                  </div>
                  {!previewImport.data ? (
                    <div className="text-sm text-muted-foreground">
                      Run a preview to validate the file and inspect the first few normalized items before saving.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="text-sm text-muted-foreground">
                        Parsed <strong>{previewImport.data.count}</strong> items. Showing the first{" "}
                        {previewImport.data.items.length}.
                      </div>
                      {previewImport.data.items.map((item, index) => (
                        <div key={`import-preview-${index}`} className="rounded-lg border border-border bg-background p-3">
                          <div className="text-xs uppercase tracking-wider text-muted-foreground">Preview Item {index + 1}</div>
                          <div className="mt-2 text-sm">
                            <span className="font-semibold">Input:</span> {item.input}
                          </div>
                          <div className="mt-1 text-sm">
                            <span className="font-semibold">Expected:</span> {item.expectedOutput}
                          </div>
                          {item.difficulty ? (
                            <div className="mt-1 text-xs text-muted-foreground">Difficulty: {item.difficulty}</div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Selected Dataset</CardTitle>
            <CardDescription>
              Inspect metadata and sample items before using the dataset in an evaluation run.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Choose Dataset</label>
              <Select
                value={selectedDatasetId ? String(selectedDatasetId) : ""}
                onValueChange={(value) => setSelectedDatasetId(value ? Number(value) : null)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a dataset to inspect" />
                </SelectTrigger>
                <SelectContent>
                  {(datasets as any[]).map((dataset) => {
                    const kind = datasetKind(dataset.source);
                    const kindLabel = kind === "built-in" ? "Built-in" : kind === "imported" ? "Imported" : "Custom";
                    return (
                      <SelectItem key={dataset.id} value={String(dataset.id)}>
                        {dataset.name} · v{dataset.schemaVersion ?? 1} · {kindLabel}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            {!selectedDataset ? (
              <div className="text-sm text-muted-foreground">
                Select a dataset from the dropdown or registry below to inspect its structure and examples.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-xl font-bold">{selectedDataset.name}</div>
                    <Badge variant="secondary">v{selectedDataset.schemaVersion ?? 1}</Badge>
                    <Badge variant={selectedDatasetKind === "built-in" ? "outline" : "secondary"}>
                      {selectedDatasetKind === "built-in"
                        ? "Built-in"
                        : selectedDatasetKind === "imported"
                          ? "Imported"
                          : "Custom"}
                    </Badge>
                    {(selectedDataset.schemaVersion ?? 1) === latestVersionByName.get(selectedDataset.name) ? (
                      <Badge variant="outline">Latest</Badge>
                    ) : null}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {selectedDataset.itemCount} items
                    {selectedDataset.source ? ` • ${selectedDataset.source}` : ""}
                    {selectedDataset.createdAt ? ` • ${format(new Date(selectedDataset.createdAt), "MMM d, yyyy")}` : ""}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={loadSelectedDatasetIntoBuilder}>
                    <CopyPlus className="w-4 h-4 mr-2" />
                    Load Into Builder
                  </Button>
                  {selectedDatasetIsUser ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" className="text-rose-700 border-rose-200 hover:bg-rose-50">
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete Dataset
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete {selectedDataset.name}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            {datasetUsage.length > 0
                              ? "This dataset has already been used in eval runs, so deleting it now would weaken run history. EvalBench keeps it locked."
                              : "This removes the custom dataset and its items from your local registry. Built-in datasets stay untouched."}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => {
                              if (!selectedDataset || datasetUsage.length > 0) return;
                              deleteDataset.mutate(selectedDataset.id, {
                                onSuccess: () => {
                                  setSelectedDatasetId(null);
                                },
                                onError: (error) => {
                                  toast({
                                    title: "Could not delete dataset",
                                    description: error instanceof Error ? error.message : "Unknown error",
                                    variant: "destructive",
                                  });
                                },
                              });
                            }}
                            disabled={datasetUsage.length > 0 || deleteDataset.isPending}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                          >
                            {datasetUsage.length > 0 ? "Used In Runs" : deleteDataset.isPending ? "Deleting..." : "Delete Dataset"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                </div>

                <div className="space-y-3">
                  {selectedDataset.items.slice(0, 5).map((item) => (
                    <div key={item.id} className="rounded-lg border border-border p-3 bg-muted/20">
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">Item #{item.id}</div>
                      <div className="mt-2 text-sm">
                        <span className="font-semibold">Input:</span> {item.input}
                      </div>
                      <div className="mt-1 text-sm">
                        <span className="font-semibold">Expected:</span> {item.expectedOutput}
                      </div>
                      {item.context ? (
                        <div className="mt-1 text-xs text-muted-foreground line-clamp-3">Context: {item.context}</div>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.difficulty ? <Badge variant="outline">{item.difficulty}</Badge> : null}
                        {formatTags(item.tags)
                          .split(",")
                          .map((tag) => tag.trim())
                          .filter(Boolean)
                          .slice(0, 4)
                          .map((tag) => (
                            <Badge key={`${item.id}-${tag}`} variant="secondary">
                              {tag}
                            </Badge>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-3 pt-2 border-t border-border">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <History className="w-4 h-4 text-primary" />
                    Usage History
                  </div>
                  {datasetUsage.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      This dataset version has not been used in an eval run yet.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {datasetUsage.map((run) => {
                        const modelNames = (run.configJson?.modelIds ?? [])
                          .map((modelId: number) => modelMap[modelId] ?? `Model ${modelId}`)
                          .join(", ");
                        return (
                          <button
                            key={run.id}
                            type="button"
                            className="w-full text-left rounded-lg border border-border p-3 bg-muted/20 transition-colors hover:bg-muted/40"
                            onClick={() => navigate(`/evaluate/${run.id}`)}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">Run #{run.id}</span>
                              <Badge variant="outline" className="capitalize">
                                {run.status.replace("_", " ")}
                              </Badge>
                              <Badge variant="secondary" className="capitalize">
                                {run.configJson?.taskType ?? "task"}
                              </Badge>
                            </div>
                            <div className="mt-2 text-sm text-muted-foreground">
                              {modelNames || "No models recorded"}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {run.timestamp ? format(new Date(run.timestamp), "PPpp") : "Unknown time"}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dataset Registry</CardTitle>
          <CardDescription>
            Search, inspect, and reload existing versions. Saving the same dataset name again creates the next version.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col md:flex-row gap-3">
            <Input
              value={datasetSearch}
              onChange={(event) => setDatasetSearch(event.target.value)}
              placeholder="Search by name, source, or version"
              className="max-w-sm"
            />
            <div className="text-sm text-muted-foreground flex items-center">
              {filteredDatasets.length} matching datasets
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDatasets.map((dataset) => (
                <TableRow
                  key={dataset.id}
                  className={`cursor-pointer ${selectedDatasetId === dataset.id ? "bg-muted/40" : ""}`}
                  onClick={() => setSelectedDatasetId(dataset.id)}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <span>{dataset.name}</span>
                      <Badge variant={datasetKind(dataset.source) === "built-in" ? "outline" : "secondary"}>
                        {datasetKind(dataset.source) === "built-in"
                          ? "Built-in"
                          : datasetKind(dataset.source) === "imported"
                            ? "Imported"
                            : "Custom"}
                      </Badge>
                      {(dataset.schemaVersion ?? 1) === latestVersionByName.get(dataset.name) ? (
                        <Badge variant="outline">Latest</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>v{dataset.schemaVersion ?? 1}</TableCell>
                  <TableCell>{dataset.itemCount ?? 0}</TableCell>
                  <TableCell className="text-muted-foreground">{dataset.source ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {dataset.createdAt ? format(new Date(dataset.createdAt), "MMM d, yyyy") : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {filteredDatasets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-12">
                    No datasets match your search.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
