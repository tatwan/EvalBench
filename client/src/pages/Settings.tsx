import { useEffect, useState } from "react";
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
import { Settings as SettingsIcon, Save, Server, Scale, Key, Loader2, FlaskConical, AlertOctagon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Settings() {
  const { data: settings = [], isLoading: settingsLoading } = useSettings();
  const updateSetting = useUpdateSetting();
  const testConnection = useTestSettingConnection();
  const wipeData = useWipeData();
  const { toast } = useToast();

  const [ollamaHost, setOllamaHost] = useState("http://localhost:11434");
  const [judgeModel, setJudgeModel] = useState("");
  const [openAiKey, setOpenAiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [groqKey, setGroqKey] = useState("");
  const [grokKey, setGrokKey] = useState("");
  const [testingTarget, setTestingTarget] = useState<SettingConnectionTarget | null>(null);

  // Sync state when DB loads
  useEffect(() => {
    if (settings.length > 0) {
      setOllamaHost(settings.find(s => s.key === "ollama_host")?.value || "http://localhost:11434");
      setJudgeModel(settings.find(s => s.key === "judge_model")?.value || "");
      setOpenAiKey(settings.find(s => s.key === "openai_api_key")?.value || "");
      setAnthropicKey(settings.find(s => s.key === "anthropic_api_key")?.value || "");
      setGeminiKey(settings.find(s => s.key === "gemini_api_key")?.value || "");
      setGroqKey(settings.find(s => s.key === "groq_api_key")?.value || "");
      setGrokKey(settings.find(s => s.key === "grok_api_key")?.value || "");
    }
  }, [settings]);

  const connectionPayload = {
    ollamaHost,
    judgeModel,
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
      if (judgeModel) await updateSetting.mutateAsync({ key: "judge_model", value: judgeModel });
      if (openAiKey !== undefined) await updateSetting.mutateAsync({ key: "openai_api_key", value: openAiKey });
      if (anthropicKey !== undefined) await updateSetting.mutateAsync({ key: "anthropic_api_key", value: anthropicKey });
      if (geminiKey !== undefined) await updateSetting.mutateAsync({ key: "gemini_api_key", value: geminiKey });
      if (groqKey !== undefined) await updateSetting.mutateAsync({ key: "groq_api_key", value: groqKey });
      if (grokKey !== undefined) await updateSetting.mutateAsync({ key: "grok_api_key", value: grokKey });

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

  const renderTestButton = (target: SettingConnectionTarget, label = "Test") => {
    const isTesting = testingTarget === target && testConnection.isPending;
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0 gap-2"
        disabled={testConnection.isPending}
        onClick={() => handleTestConnection(target)}
      >
        {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
        {isTesting ? "Testing..." : label}
      </Button>
    );
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
            <CardDescription>Select the model that acts as the evaluator for subjective scoring (G-Eval).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Judge Model</label>
              <Select value={judgeModel} onValueChange={setJudgeModel}>
                <SelectTrigger className="w-full bg-muted">
                  <SelectValue placeholder="Select a frontier judge model (GPT-5.4, Claude Opus 4.1, Gemini 3 Pro)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>OpenAI (Frontier)</SelectLabel>
                    <SelectItem value="gpt-5.4">GPT-5.4 (Flagship)</SelectItem>
                    <SelectItem value="gpt-5-mini-2025-08-07">GPT-5 mini (2025-08-07)</SelectItem>
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Anthropic (Claude)</SelectLabel>
                    <SelectItem value="claude-opus-4-1-20250805">Claude Opus 4.1 (2025-08-05)</SelectItem>
                    <SelectItem value="claude-sonnet-4-20250514">Claude Sonnet 4 (2025-05-14)</SelectItem>
                    <SelectItem value="claude-3-5-haiku-latest">Claude Haiku 3.5 (Latest)</SelectItem>
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Google (Gemini)</SelectLabel>
                    <SelectItem value="gemini-3-pro-preview">Gemini 3 Pro Preview</SelectItem>
                    <SelectItem value="gemini-3-flash-preview">Gemini 3 Flash Preview</SelectItem>
                    <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
                    <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">These are the latest frontier model IDs from each provider.</p>
            </div>
            <div className="flex justify-end">
              {renderTestButton("judge", "Test Judge Setup")}
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
                  Permanently delete all captured SQL statistics, evaluation runs, battle ratings, and generated metrics to start from a clean slate. Models and Datasets will <b>not</b> be deleted.
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
                      This action cannot be undone. This will permanently delete all captured evaluation outputs, leaderboard rankings, and response caching from the SQLite database. Your imported datasets and pulled models will remain intact.
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
