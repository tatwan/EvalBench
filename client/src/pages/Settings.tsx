import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useSettings,
  useUpdateSetting,
  useTestSettingConnection,
  useWipeData,
  type SettingConnectionTarget,
} from "@/hooks/use-settings";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Settings as SettingsIcon, Save, Server, Scale, Key, Loader2, FlaskConical, AlertOctagon, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type EvalProvider = "openai" | "anthropic" | "gemini" | "groq" | "grok";

const EVAL_PROVIDERS: Array<{ id: EvalProvider; label: string }> = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "gemini", label: "Gemini" },
  { id: "groq", label: "Groq" },
  { id: "grok", label: "xAI Grok" },
];

const JUDGE_NONE = "__judge_none__";

function parseJsonSetting<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export default function Settings() {
  const { data: settings = [], isLoading: settingsLoading } = useSettings();
  const updateSetting = useUpdateSetting();
  const testConnection = useTestSettingConnection();
  const wipeData = useWipeData();
  const { toast } = useToast();

  const { data: liveModels } = useQuery<{
    openai: Array<{id: string; label: string}>;
    anthropic: Array<{id: string; label: string}>;
    gemini: Array<{id: string; label: string}>;
    groq: Array<{id: string; label: string}>;
    grok: Array<{id: string; label: string}>;
  }>({
    queryKey: ["/api/settings/judge-models"],
    staleTime: 5 * 60 * 1000, // cache for 5 minutes
  });
  const { data: evalModels } = useQuery<Record<EvalProvider, Array<{ id: string; label: string; capabilities: string[] }>>>({
    queryKey: ["/api/settings/eval-models"],
    staleTime: 5 * 60 * 1000,
  });

  const [ollamaHost, setOllamaHost] = useState("http://localhost:11434");
  const [judgeEnabled, setJudgeEnabled] = useState(false);
  const [judgeModel, setJudgeModel] = useState(JUDGE_NONE);
  const [openAiKey, setOpenAiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [groqKey, setGroqKey] = useState("");
  const [grokKey, setGrokKey] = useState("");
  const [allowedEvalProviders, setAllowedEvalProviders] = useState<EvalProvider[]>(EVAL_PROVIDERS.map((provider) => provider.id));
  const [allowedEvalModels, setAllowedEvalModels] = useState<Record<string, string[]>>({});
  const [testingTarget, setTestingTarget] = useState<SettingConnectionTarget | null>(null);

  // Sync state when DB loads
  useEffect(() => {
    if (settings.length > 0) {
      const storedJudgeModel = settings.find(s => s.key === "judge_model")?.value || "";
      const storedJudgeEnabled = settings.find(s => s.key === "judge_enabled")?.value;
      setOllamaHost(settings.find(s => s.key === "ollama_host")?.value || "http://localhost:11434");
      setJudgeEnabled(storedJudgeEnabled ? !["", "0", "false", "no", "off"].includes(storedJudgeEnabled.toLowerCase()) : Boolean(storedJudgeModel));
      setJudgeModel(storedJudgeModel || JUDGE_NONE);
      setOpenAiKey(settings.find(s => s.key === "openai_api_key")?.value || "");
      setAnthropicKey(settings.find(s => s.key === "anthropic_api_key")?.value || "");
      setGeminiKey(settings.find(s => s.key === "gemini_api_key")?.value || "");
      setGroqKey(settings.find(s => s.key === "groq_api_key")?.value || "");
      setGrokKey(settings.find(s => s.key === "grok_api_key")?.value || "");
      setAllowedEvalProviders(
        parseJsonSetting<EvalProvider[]>(
          settings.find((s) => s.key === "allowed_eval_providers")?.value,
          [],
        )
      );
      setAllowedEvalModels(
        parseJsonSetting<Record<string, string[]>>(
          settings.find((s) => s.key === "allowed_eval_models")?.value,
          {},
        )
      );
    }
  }, [settings]);

  const activeJudgeModel = judgeEnabled && judgeModel !== JUDGE_NONE ? judgeModel : "";

  const connectionPayload = {
    ollamaHost,
    judgeModel: activeJudgeModel,
    openaiApiKey: openAiKey,
    anthropicApiKey: anthropicKey,
    geminiApiKey: geminiKey,
    groqApiKey: groqKey,
    grokApiKey: grokKey,
  };

  const handleTestConnection = async (target: SettingConnectionTarget) => {
    setTestingTarget(target);
    try {
      const result = await testConnection.mutateAsync({
        target,
        ...connectionPayload,
      });
      toast({
        title: result.ok ? `${labelForTarget(target)} looks ready` : `${labelForTarget(target)} needs attention`,
        description: result.details ? `${result.message} ${result.details}` : result.message,
        variant: result.ok ? "default" : "destructive",
      });
    } catch (error: any) {
      toast({
        title: `Failed to test ${labelForTarget(target)}`,
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setTestingTarget(null);
    }
  };

  const handleSave = async () => {
    try {
      if (ollamaHost) await updateSetting.mutateAsync({ key: "ollama_host", value: ollamaHost });
      await updateSetting.mutateAsync({ key: "judge_enabled", value: judgeEnabled ? "true" : "false" });
      await updateSetting.mutateAsync({ key: "judge_model", value: judgeModel === JUDGE_NONE ? "" : judgeModel });
      if (openAiKey !== undefined) await updateSetting.mutateAsync({ key: "openai_api_key", value: openAiKey });
      if (anthropicKey !== undefined) await updateSetting.mutateAsync({ key: "anthropic_api_key", value: anthropicKey });
      if (geminiKey !== undefined) await updateSetting.mutateAsync({ key: "gemini_api_key", value: geminiKey });
      if (groqKey !== undefined) await updateSetting.mutateAsync({ key: "groq_api_key", value: groqKey });
      if (grokKey !== undefined) await updateSetting.mutateAsync({ key: "grok_api_key", value: grokKey });
      await updateSetting.mutateAsync({ key: "allowed_eval_providers", value: JSON.stringify(allowedEvalProviders) });
      await updateSetting.mutateAsync({ key: "allowed_eval_models", value: JSON.stringify(allowedEvalModels) });

      toast({ title: "Settings saved successfully", variant: "default" });
    } catch (e: any) {
      toast({ title: "Failed to save settings", description: e.message, variant: "destructive" });
    }
  };

  const handleWipeData = async () => {
    try {
      await wipeData.mutateAsync();
      toast({ title: "Evaluation Data Wiped", description: "All captured stats, runs, and evals have been permanently deleted.", variant: "default" });
    } catch (e: any) {
      toast({ title: "Failed to wipe data", description: e.message, variant: "destructive" });
    }
  };

  const renderTestButton = (target: SettingConnectionTarget, label = "Test", disabled = false) => {
    const isTesting = testingTarget === target && testConnection.isPending;
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0 gap-2"
        disabled={testConnection.isPending || disabled}
        onClick={() => handleTestConnection(target)}
      >
        {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
        {isTesting ? "Testing..." : label}
      </Button>
    );
  };

  const toggleAllowedProvider = (provider: EvalProvider) => {
    setAllowedEvalProviders((prev) =>
      prev.includes(provider)
        ? prev.filter((item) => item !== provider)
        : [...prev, provider]
    );
  };

  const toggleAllowedModel = (provider: EvalProvider, modelId: string, checked: boolean) => {
    setAllowedEvalModels((prev) => {
      const current = prev[provider] ?? [];
      const next = checked
        ? [...current, modelId]
        : current.filter((item) => item !== modelId);
      return {
        ...prev,
        [provider]: Array.from(new Set(next)),
      };
    });
  };

  if (settingsLoading) {
    return <div className="flex items-center justify-center py-24"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <SettingsIcon className="w-8 h-8 text-primary" /> Settings
        </h1>
        <p className="text-muted-foreground mt-2">Configure evaluation engines, judge models, and environment variables.</p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        
        {/* Core Settings */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Server className="w-5 h-5 text-sky-400" /> Local Host Configuration</CardTitle>
            <CardDescription>Ollama instance URL for local inference.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Ollama Host URL</label>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Input 
                  value={ollamaHost} 
                  onChange={e => setOllamaHost(e.target.value)} 
                  placeholder="http://localhost:11434"
                  className="font-mono bg-muted"
                />
                {renderTestButton("ollama", "Test Connection")}
              </div>
              <p className="text-xs text-muted-foreground">Applies immediately for discovery, evaluation runs, and judge calls.</p>
            </div>
          </CardContent>
        </Card>

        {/* LLM-as-Judge Settings */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Scale className="w-5 h-5 text-purple-400" /> LLM-as-Judge</CardTitle>
            <CardDescription>Turn subjective judge scoring on only when you want it. When it is off, EvalBench skips judge metrics for every run.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-4 py-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">Enable LLM-as-Judge</div>
                <p className="text-xs text-muted-foreground">Summarization, QA-style, and RAG judge metrics are skipped when this is off.</p>
              </div>
              <Switch checked={judgeEnabled} onCheckedChange={setJudgeEnabled} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Judge Model</label>
              <Select value={judgeModel} onValueChange={setJudgeModel} disabled={!judgeEnabled}>
                <SelectTrigger className="w-full bg-muted">
                  <SelectValue placeholder="Select a judge model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Judge Mode</SelectLabel>
                    <SelectItem value={JUDGE_NONE}>No judge selected</SelectItem>
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>OpenAI</SelectLabel>
                    {(liveModels?.openai && liveModels.openai.length > 0
                      ? liveModels.openai
                      : [
                          { id: "gpt-5.4", label: "GPT-5.4" },
                          { id: "gpt-5.4-mini", label: "GPT-5.4 mini" },
                          { id: "gpt-5.4-nano", label: "GPT-5.4 nano" },
                          { id: "o4-mini", label: "o4-mini" },
                          { id: "o3", label: "o3" },
                        ]
                    ).map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Anthropic (Claude)</SelectLabel>
                    {(liveModels?.anthropic && liveModels.anthropic.length > 0
                      ? liveModels.anthropic
                      : [
                          { id: "claude-opus-4-6", label: "Claude Opus 4.6 (Most Capable)" },
                          { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Balanced)" },
                          { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (Fast)" },
                        ]
                    ).map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Google (Gemini)</SelectLabel>
                    {(liveModels?.gemini && liveModels.gemini.length > 0
                      ? liveModels.gemini
                      : [
                          { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro" },
                          { id: "gemini-3.1-flash", label: "Gemini 3.1 Flash" },
                        ]
                    ).map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Groq (Fast Inference)</SelectLabel>
                    {(liveModels?.groq && liveModels.groq.length > 0
                      ? liveModels.groq
                      : [
                          { id: "groq-llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile" },
                          { id: "groq-llama-3.1-8b-instant", label: "Llama 3.1 8B Instant" },
                          { id: "groq-mixtral-8x7b-32768", label: "Mixtral 8x7B" },
                        ]
                    ).map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>xAI Grok</SelectLabel>
                    {(liveModels?.grok && liveModels.grok.length > 0
                      ? liveModels.grok
                      : [
                          { id: "grok-4", label: "Grok 4" },
                          { id: "grok-3", label: "Grok 3" },
                        ]
                    ).map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {!judgeEnabled
                  ? "Judge scoring is currently off."
                  : liveModels
                    ? "Showing live models from your configured providers."
                    : "Configure API keys above to see live model lists from each provider."}
              </p>
            </div>
            <div className="flex justify-end">
              {renderTestButton("judge", "Test Judge Setup", !judgeEnabled || !activeJudgeModel)}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Check className="w-5 h-5 text-emerald-500" /> Frontier Evaluation Allowlist</CardTitle>
            <CardDescription>Choose which cloud vendors and specific models can appear as evaluated frontier models in the Eval Wizard.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Allowed Providers</label>
              <div className="flex flex-wrap gap-2">
                {EVAL_PROVIDERS.map((provider) => {
                  const enabled = allowedEvalProviders.includes(provider.id);
                  return (
                    <Button
                      key={provider.id}
                      type="button"
                      variant={enabled ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleAllowedProvider(provider.id)}
                    >
                      {provider.label}
                    </Button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Disabled providers stay hidden in the Eval Wizard. The active judge model is always excluded from eval selection even if it is allowed here.
              </p>
            </div>

            <div className="space-y-3">
              <label className="text-sm font-medium">Allowed Models By Provider</label>
              {EVAL_PROVIDERS.map((provider) => {
                const models = evalModels?.[provider.id] ?? [];
                const enabled = allowedEvalProviders.includes(provider.id);
                const selected = allowedEvalModels[provider.id] ?? [];
                return (
                  <div key={provider.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">{provider.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {selected.length > 0
                            ? `${selected.length} model${selected.length === 1 ? "" : "s"} explicitly allowed`
                            : "No specific model filter saved — all models from this enabled provider will be shown."}
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" variant="outline" size="sm" disabled={!enabled || models.length === 0}>
                            {models.length === 0 ? "No live models" : "Choose Models"}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-[340px]">
                          <DropdownMenuLabel>{provider.label}</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {models.map((model) => (
                            <DropdownMenuCheckboxItem
                              key={model.id}
                              checked={selected.includes(model.id)}
                              onCheckedChange={(checked) => toggleAllowedModel(provider.id, model.id, Boolean(checked))}
                            >
                              <div className="flex w-full items-center justify-between gap-3">
                                <span>{model.label}</span>
                                <span className="text-[10px] text-muted-foreground">
                                  {model.capabilities.join(" / ")}
                                </span>
                              </div>
                            </DropdownMenuCheckboxItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {selected.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selected.map((modelId) => (
                          <Button
                            key={modelId}
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => toggleAllowedModel(provider.id, modelId, false)}
                          >
                            {models.find((model) => model.id === modelId)?.label ?? modelId}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* API Keys (Preparation for Phase 4) */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Key className="w-5 h-5 text-amber-400" /> API Keys (Cloud Providers)</CardTitle>
            <CardDescription>For evaluating or acting as a judge via cloud APIs.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">OpenAI API Key</label>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Input 
                  type="password"
                  value={openAiKey} 
                  onChange={e => setOpenAiKey(e.target.value)} 
                  placeholder="sk-proj-..."
                  className="font-mono bg-muted"
                />
                {renderTestButton("openai")}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Anthropic API Key</label>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Input 
                  type="password"
                  value={anthropicKey} 
                  onChange={e => setAnthropicKey(e.target.value)} 
                  placeholder="sk-ant-..."
                  className="font-mono bg-muted"
                />
                {renderTestButton("anthropic")}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Google Gemini API Key</label>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Input 
                  type="password"
                  value={geminiKey} 
                  onChange={e => setGeminiKey(e.target.value)} 
                  placeholder="AIzaSy..."
                  className="font-mono bg-muted"
                />
                {renderTestButton("gemini")}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Groq API Key <span className="text-[10px] text-muted-foreground font-normal">(fast inference — api.groq.com)</span></label>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Input 
                  type="password"
                  value={groqKey} 
                  onChange={e => setGroqKey(e.target.value)} 
                  placeholder="gsk_..."
                  className="font-mono bg-muted"
                />
                {renderTestButton("groq")}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">xAI Grok API Key <span className="text-[10px] text-muted-foreground font-normal">(api.x.ai)</span></label>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Input 
                  type="password"
                  value={grokKey} 
                  onChange={e => setGrokKey(e.target.value)} 
                  placeholder="xai-..."
                  className="font-mono bg-muted"
                />
                {renderTestButton("grok")}
              </div>
            </div>
            <p className="text-xs text-muted-foreground pt-1 flex items-center gap-1">
              🔒 Keys are encrypted at rest in your local database.
            </p>
            <p className="text-xs text-muted-foreground">
              Connection tests use the values currently in the form, so you can verify a host, judge, or API key before saving.
            </p>
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="border-red-900/50 bg-red-950/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-500">
              <AlertOctagon className="w-5 h-5" /> Danger Zone
            </CardTitle>
            <CardDescription className="text-red-400/80">
              Irreversible destructive actions for your workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center p-4 border border-red-900/40 rounded-lg bg-background/50">
              <div className="space-y-1 mb-4 sm:mb-0">
                <h4 className="font-medium text-red-500">Reset Evaluation Data</h4>
                <p className="text-sm text-muted-foreground mr-4">
                  Permanently delete all captured SQL statistics, evaluation runs, battle ratings, and generated metrics to start from a clean slate. Models and Datasets will <b>not</b> be deleted, and new run IDs will start fresh again.
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="shrink-0" disabled={wipeData.isPending}>
                    {wipeData.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Wipe Capture Data
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. This will permanently delete all captured evaluation outputs, leaderboard rankings, and response caching from the SQLite database. Your imported datasets and pulled models will remain intact, and new run IDs will restart from a fresh state.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction 
                      onClick={handleWipeData}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Yes, wipe evaluation data
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end pt-4">
          <Button 
            onClick={handleSave} 
            size="lg" 
            className="flex gap-2"
            disabled={updateSetting.isPending}
          >
            {updateSetting.isPending ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div> : <Save className="w-4 h-4" />}
            Save Settings
          </Button>
        </div>

      </div>
    </div>
  );
}

function labelForTarget(target: SettingConnectionTarget): string {
  switch (target) {
    case "ollama":
      return "Ollama";
    case "judge":
      return "Judge configuration";
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "gemini":
      return "Gemini";
    case "groq":
      return "Groq";
    case "grok":
      return "xAI Grok";
  }
}
