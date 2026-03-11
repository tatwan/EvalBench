// server/ollama.ts

const OLLAMA_BASE = process.env.OLLAMA_HOST ?? "http://localhost:11434";

export interface OllamaModel {
  name: string;
  size: number; // bytes
  details: {
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

export interface OllamaStatusResult {
  ok: boolean;
  models: OllamaModel[];
  error?: string;
}

export interface OllamaGenerateResult {
  ok: boolean;
  response?: string;
  error?: string;
}

export async function checkOllamaStatus(): Promise<OllamaStatusResult> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` };
    const data = await res.json() as { models: OllamaModel[] };
    return { ok: true, models: data.models ?? [] };
  } catch (err: any) {
    return { ok: false, models: [], error: err.message };
  }
}

export async function listOllamaModels(): Promise<OllamaModel[]> {
  const result = await checkOllamaStatus();
  return result.ok ? result.models : [];
}

export async function generate(model: string, prompt: string): Promise<OllamaGenerateResult> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: AbortSignal.timeout(120_000), // 2 min timeout for slow models
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json() as { response: string };
    return { ok: true, response: data.response };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
