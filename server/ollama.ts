// server/ollama.ts
// Single point of contact for all Ollama HTTP communication.
// Never throws — all functions return ok-boolean results.

function ollamaBase(): string {
  return process.env.OLLAMA_HOST ?? "http://localhost:11434";
}

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
    const res = await fetch(`${ollamaBase()}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, models: [], error: body || `HTTP ${res.status}` };
    }
    const data = await res.json() as { models: OllamaModel[] };
    return { ok: true, models: data.models ?? [] };
  } catch (err) {
    return { ok: false, models: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export async function listOllamaModels(): Promise<OllamaModel[]> {
  const result = await checkOllamaStatus();
  return result.ok ? result.models : [];
}

export async function generate(model: string, prompt: string): Promise<OllamaGenerateResult> {
  try {
    const res = await fetch(`${ollamaBase()}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: AbortSignal.timeout(120_000), // 2 min timeout for slow models
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: body || `HTTP ${res.status}` };
    }
    const data = await res.json() as { response: string };
    return { ok: true, response: data.response };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
