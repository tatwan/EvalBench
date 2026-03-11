import { useEffect, useState } from "react";
import { useSettings, useUpdateSetting } from "@/hooks/use-settings";
import { useModels } from "@/hooks/use-models";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from "@/components/ui/select";
import { Settings as SettingsIcon, Save, Server, Scale, Key } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Settings() {
  const { data: settings = [], isLoading: settingsLoading } = useSettings();
  const { data: models = [], isLoading: modelsLoading } = useModels();
  const updateSetting = useUpdateSetting();
  const { toast } = useToast();

  const [ollamaHost, setOllamaHost] = useState("");
  const [judgeModel, setJudgeModel] = useState("");
  const [openAiKey, setOpenAiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [grokKey, setGrokKey] = useState("");

  // Sync state when DB loads
  useEffect(() => {
    if (settings.length > 0) {
      setOllamaHost(settings.find(s => s.key === "ollama_host")?.value || "http://localhost:11434");
      setJudgeModel(settings.find(s => s.key === "judge_model")?.value || "");
      setOpenAiKey(settings.find(s => s.key === "openai_api_key")?.value || "");
      setAnthropicKey(settings.find(s => s.key === "anthropic_api_key")?.value || "");
      setGeminiKey(settings.find(s => s.key === "gemini_api_key")?.value || "");
      setGrokKey(settings.find(s => s.key === "grok_api_key")?.value || "");
    }
  }, [settings]);

  const handleSave = async () => {
    try {
      if (ollamaHost) await updateSetting.mutateAsync({ key: "ollama_host", value: ollamaHost });
      if (judgeModel) await updateSetting.mutateAsync({ key: "judge_model", value: judgeModel });
      if (openAiKey !== undefined) await updateSetting.mutateAsync({ key: "openai_api_key", value: openAiKey });
      if (anthropicKey !== undefined) await updateSetting.mutateAsync({ key: "anthropic_api_key", value: anthropicKey });
      if (geminiKey !== undefined) await updateSetting.mutateAsync({ key: "gemini_api_key", value: geminiKey });
      if (grokKey !== undefined) await updateSetting.mutateAsync({ key: "grok_api_key", value: grokKey });

      toast({ title: "Settings saved successfully", variant: "default" });
    } catch (e: any) {
      toast({ title: "Failed to save settings", description: e.message, variant: "destructive" });
    }
  };

  if (settingsLoading || modelsLoading) {
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
              <Input 
                value={ollamaHost} 
                onChange={e => setOllamaHost(e.target.value)} 
                placeholder="http://localhost:11434"
                className="font-mono bg-muted"
              />
              <p className="text-xs text-muted-foreground">Requires restarting the backend server to completely take effect right now.</p>
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
                  <SelectValue placeholder="Select a powerful model (e.g., Llama 3 8B+ or GPT-4o)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Cloud Models (Frontier)</SelectLabel>
                    <SelectItem value="gpt-4o">OpenAI: GPT-4o</SelectItem>
                    <SelectItem value="gpt-4o-mini">OpenAI: GPT-4o-Mini</SelectItem>
                    <SelectItem value="claude-3-5-sonnet-latest">Anthropic: Claude 3.5 Sonnet</SelectItem>
                    <SelectItem value="gemini-1.5-pro">Google: Gemini 1.5 Pro</SelectItem>
                    <SelectItem value="grok-beta">xAI: Grok Beta</SelectItem>
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Local Models (Ollama)</SelectLabel>
                    {models.map((m: any) => (
                      <SelectItem key={m.id} value={m.name}>
                        {m.name} {m.sizeGb ? `(${m.sizeGb.toFixed(1)}GB)` : ""}
                      </SelectItem>
                    ))}
                    {models.length === 0 && <SelectItem value="none" disabled>No local models found</SelectItem>}
                  </SelectGroup>
                </SelectContent>
              </Select>
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
              <Input 
                type="password"
                value={openAiKey} 
                onChange={e => setOpenAiKey(e.target.value)} 
                placeholder="sk-proj-..."
                className="font-mono bg-muted"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Anthropic API Key</label>
              <Input 
                type="password"
                value={anthropicKey} 
                onChange={e => setAnthropicKey(e.target.value)} 
                placeholder="sk-ant-..."
                className="font-mono bg-muted"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Google Gemini API Key</label>
              <Input 
                type="password"
                value={geminiKey} 
                onChange={e => setGeminiKey(e.target.value)} 
                placeholder="AIzaSy..."
                className="font-mono bg-muted"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">xAI Grok API Key</label>
              <Input 
                type="password"
                value={grokKey} 
                onChange={e => setGrokKey(e.target.value)} 
                placeholder="xai-..."
                className="font-mono bg-muted"
              />
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
