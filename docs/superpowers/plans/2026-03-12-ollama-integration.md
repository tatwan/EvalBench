# Ollama Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all mock/hardcoded data with real Ollama API calls — model discovery via `GET /api/tags` and response generation via `POST /api/generate` for Arena mode.

**Architecture:** A dedicated `server/ollama.ts` module owns all HTTP communication with the local Ollama daemon. `storage.ts` calls this module instead of returning fake data. A new `GET /api/ollama/status` endpoint lets the frontend show a live connection indicator.

**Tech Stack:** Node.js native `fetch` (built-in, no extra deps needed), Ollama REST API at `localhost:11434`, existing Express/Drizzle/React stack.

---

## Ollama API Reference (read before coding)

```
GET  http://localhost:11434/api/tags
  → { models: [{ name, size, details: { family, parameter_size, quantization_level } }] }

POST http://localhost:11434/api/generate
  body: { model: "llama3:8b", prompt: "...", stream: false }
  → { model, response, done, total_duration, eval_count, ... }
```

The `name` field from `/api/tags` is the full tag e.g. `"llama3:8b"`. The `details` object contains `family`, `parameter_size` (e.g. `"8.0B"`), and `quantization_level` (e.g. `"Q4_K_M"`). Size is in bytes.

---

## File Map

| File | Action | What changes |
|---|---|---|
| `server/ollama.ts` | **Create** | Thin Ollama API client: `checkStatus`, `listModels`, `generate` |
| `server/storage.ts` | **Modify** | `discoverModels` calls `ollama.listModels`; `getArenaMatchup` calls `ollama.generate` |
| `server/routes.ts` | **Modify** | Add `GET /api/ollama/status` route |
| `shared/routes.ts` | **Modify** | Add `ollama.status` endpoint definition |
| `client/src/hooks/use-models.ts` | **Modify** | Add `useOllamaStatus` hook |
| `client/src/pages/Models.tsx` | **Modify** | Show Ollama status banner at top of page |

---

## Chunk 1: Backend — Ollama Client + Model Discovery

### Task 1: Create `server/ollama.ts`

**Files:**
- Create: `server/ollama.ts`

This module is the single place that talks to Ollama. It should never throw — it returns typed results with an `ok` boolean so callers can handle failures gracefully.

- [ ] **Step 1: Create the file with typed interfaces and three functions**

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/tarekatwan/Repos/MyWork/Projects/EvalBench
npx tsc --noEmit
```

Expected: No errors related to `server/ollama.ts`.

- [ ] **Step 3: Commit**

```bash
git add server/ollama.ts
git commit -m "feat: add Ollama API client module"
```

---

### Task 2: Wire `discoverModels()` to real Ollama

**Files:**
- Modify: `server/storage.ts` — `discoverModels()` method (lines 27-45)

Currently seeds 3 hardcoded models. Replace with real Ollama data. Key behavior changes:
1. Always sync from Ollama (not just when DB is empty)
2. Parse `parameter_size` and `quantization_level` from `details`
3. Convert size from bytes to GB
4. Upsert by name (insert or update) so re-running doesn't duplicate
5. If Ollama is offline, fall back to returning whatever is already in DB

- [ ] **Step 1: Add the import at the top of `server/storage.ts`**

Add after the existing imports:
```typescript
import { listOllamaModels } from "./ollama";
```

- [ ] **Step 2: Replace the `discoverModels` method**

Find the existing `discoverModels` method (the entire method from `async discoverModels()` through its closing brace) and replace it with:

```typescript
  async discoverModels(): Promise<Model[]> {
    const ollamaModels = await listOllamaModels();

    if (ollamaModels.length === 0) {
      // Ollama is offline or has no models — return what's in DB
      return await this.getModels();
    }

    // Upsert each Ollama model by name
    for (const om of ollamaModels) {
      const sizeGb = (om.size / 1e9).toFixed(2);
      const existing = await db.select().from(models).where(eq(models.name, om.name));

      if (existing.length === 0) {
        const [inserted] = await db.insert(models).values({
          name: om.name,
          family: om.details.family ?? null,
          params: om.details.parameter_size ?? null,
          quantization: om.details.quantization_level ?? null,
          sizeGb,
        }).returning();

        await db.insert(eloRatings).values({
          modelId: inserted.id,
          rating: 1200,
          gamesPlayed: 0,
        }).onConflictDoNothing();
      } else {
        await db.update(models).set({
          family: om.details.family ?? null,
          params: om.details.parameter_size ?? null,
          quantization: om.details.quantization_level ?? null,
          sizeGb,
        }).where(eq(models.name, om.name));
      }
    }

    return await this.getModels();
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No new errors.

- [ ] **Step 4: Remove the auto-seed from `server/routes.ts`**

In `server/routes.ts`, find and delete these lines (currently lines 11-15):
```typescript
  // Seed Database with mock initial data if empty
  const existingModels = await storage.getModels();
  if (existingModels.length === 0) {
    await storage.discoverModels();
  }
```

The Models page already calls `POST /api/models/discover` — auto-seeding with fake data at startup should not happen.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add server/storage.ts server/routes.ts
git commit -m "feat: wire discoverModels to real Ollama API, remove mock seeding"
```

---

### Task 3: Add `GET /api/ollama/status` endpoint

**Files:**
- Modify: `shared/routes.ts` — add `ollama` key to `api` object
- Modify: `server/routes.ts` — add route handler

This endpoint lets the frontend poll Ollama connectivity without triggering a full model sync.

- [ ] **Step 1: Add the endpoint definition to `shared/routes.ts`**

In `shared/routes.ts`, add the `ollama` key to the `api` object (after the `arena` block, before the closing `}`):

```typescript
  ollama: {
    status: {
      method: 'GET' as const,
      path: '/api/ollama/status' as const,
      responses: {
        200: z.object({
          running: z.boolean(),
          modelCount: z.number(),
          error: z.string().optional(),
        })
      }
    }
  },
```

- [ ] **Step 2: Add the route handler in `server/routes.ts`**

Add the import at the top of `server/routes.ts`:
```typescript
import { checkOllamaStatus } from "./ollama";
```

Then add a route handler before the `return httpServer` line:
```typescript
  // Ollama status
  app.get(api.ollama.status.path, async (_req, res) => {
    const status = await checkOllamaStatus();
    res.json({
      running: status.ok,
      modelCount: status.models.length,
      error: status.error,
    });
  });
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add shared/routes.ts server/routes.ts
git commit -m "feat: add GET /api/ollama/status endpoint"
```

---

### Task 4: Wire Arena to real Ollama generation

**Files:**
- Modify: `server/storage.ts` — `getArenaMatchup()` method (lines 94-121)

Replace the fake `outputA`/`outputB` strings with real `generate()` calls. Both models are called sequentially (simpler than parallel for now). If generation fails for either model, return a clear error message string so the UI still renders.

- [ ] **Step 1: Add the `generate` import to `server/storage.ts`**

Update the existing ollama import line:
```typescript
import { listOllamaModels, generate } from "./ollama";
```

- [ ] **Step 2: Replace the `getArenaMatchup` method**

Find the entire `getArenaMatchup` method and replace with:

```typescript
  async getArenaMatchup(): Promise<{ prompt: string, modelA: Model, modelB: Model, outputA: string, outputB: string }> {
    const allModels = await this.getModels();
    if (allModels.length < 2) {
      throw new Error("At least 2 models are required for an arena matchup.");
    }

    // Pick 2 random models
    const shuffled = [...allModels].sort(() => 0.5 - Math.random());
    const modelA = shuffled[0];
    const modelB = shuffled[1];

    const prompts = [
      "Explain quantum computing in one sentence.",
      "Write a haiku about artificial intelligence.",
      "What is the capital of France?",
      "Why is the sky blue?",
      "What is the difference between supervised and unsupervised learning?",
      "Explain the trolley problem briefly.",
    ];
    const prompt = prompts[Math.floor(Math.random() * prompts.length)];

    const [resultA, resultB] = await Promise.all([
      generate(modelA.name, prompt),
      generate(modelB.name, prompt),
    ]);

    return {
      prompt,
      modelA,
      modelB,
      outputA: resultA.ok ? resultA.response! : `[Error: ${resultA.error}]`,
      outputB: resultB.ok ? resultB.response! : `[Error: ${resultB.error}]`,
    };
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add server/storage.ts
git commit -m "feat: Arena now generates real responses via Ollama"
```

---

## Chunk 2: Frontend — Ollama Status Indicator

### Task 5: Add `useOllamaStatus` hook

**Files:**
- Modify: `client/src/hooks/use-models.ts` — add new exported hook at the bottom

- [ ] **Step 1: Add the hook**

Append to `client/src/hooks/use-models.ts`:

```typescript
export function useOllamaStatus() {
  return useQuery({
    queryKey: ['/api/ollama/status'],
    queryFn: async () => {
      const res = await fetch('/api/ollama/status', { credentials: "include" });
      if (!res.ok) return { running: false, modelCount: 0 };
      return res.json() as Promise<{ running: boolean; modelCount: number; error?: string }>;
    },
    refetchInterval: 10_000, // Poll every 10s
    staleTime: 8_000,
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/use-models.ts
git commit -m "feat: add useOllamaStatus hook with 10s polling"
```

---

### Task 6: Show Ollama status banner on Models page

**Files:**
- Modify: `client/src/pages/Models.tsx`

Add an Ollama connection status badge at the top of the Models page, just below the `<h1>`. Green dot = connected, red dot = offline. When offline, show a hint about how to start Ollama.

- [ ] **Step 1: Add the import and hook usage**

In `Models.tsx`, add to the import line for `use-models`:
```typescript
import { useModels, useDiscoverModels, useOllamaStatus } from "@/hooks/use-models";
```

And inside the component, add after `const discoverMutation = useDiscoverModels();`:
```typescript
  const { data: ollamaStatus } = useOllamaStatus();
```

- [ ] **Step 2: Add the status banner JSX**

In the JSX, after the `<p className="text-muted-foreground mt-2">` paragraph and before the closing `</div>` of the header section, add:

```tsx
        {ollamaStatus && (
          <div className={`flex items-center gap-2 mt-3 text-sm px-3 py-1.5 rounded-full w-fit ${
            ollamaStatus.running
              ? 'bg-green-500/10 text-green-400 ring-1 ring-green-500/20'
              : 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20'
          }`}>
            <span className={`w-2 h-2 rounded-full ${ollamaStatus.running ? 'bg-green-400' : 'bg-red-400'}`} />
            {ollamaStatus.running
              ? `Ollama connected · ${ollamaStatus.modelCount} model${ollamaStatus.modelCount !== 1 ? 's' : ''} available`
              : 'Ollama offline — run `ollama serve` to connect'}
          </div>
        )}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Start dev server and manually verify**

```bash
npm run dev
```

Open `http://localhost:5000/models`. Verify:
- If Ollama is running: green dot appears, model count shown, "Discover Models" button syncs real models
- If Ollama is not running: red dot with "ollama serve" message
- Model cards show real model names/sizes/families after discovery

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/Models.tsx
git commit -m "feat: add Ollama connection status indicator to Models page"
```

---

## Testing Checklist

Before marking this complete, verify manually:

**Model Discovery (Ollama running):**
- [ ] Click "Discover Models" → real model names appear from your local Ollama
- [ ] Model cards show correct family, param count, quantization from Ollama metadata
- [ ] Size is shown in GB (converted from bytes)
- [ ] Clicking "Discover Models" again updates existing models (no duplicates)

**Model Discovery (Ollama offline):**
- [ ] Red status indicator shows on Models page
- [ ] "Discover Models" with Ollama offline returns existing DB models (no crash)

**Arena (Ollama running):**
- [ ] Arena loads a real prompt and generates real responses from two models
- [ ] Responses are actual model outputs, not `[Simulated Output A/B]`
- [ ] Voting still updates ELO correctly after real responses

**Arena (Ollama offline):**
- [ ] Arena shows `[Error: ...]` in the response panels — does not crash
- [ ] Voting on error responses still works (ELO updates)

**Status endpoint:**
- [ ] `curl http://localhost:5000/api/ollama/status` returns `{"running":true,"modelCount":N}` when Ollama is up
- [ ] Returns `{"running":false,"modelCount":0,"error":"..."}` when Ollama is down
