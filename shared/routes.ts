import { z } from 'zod';

// ─── Shared Zod types matching FastAPI Pydantic responses ───────────────────

export const ModelSchema = z.object({
  id: z.number(),
  name: z.string(),
  family: z.string().nullable().optional(),
  params: z.string().nullable().optional(),
  quantization: z.string().nullable().optional(),
  sizeGb: z.number().nullable().optional(),
});

export const EvalRunSchema = z.object({
  id: z.number(),
  timestamp: z.string().nullable().optional(),
  configJson: z.any(),
  status: z.string(),
});

export const EvalResultSchema = z.object({
  id: z.number(),
  runId: z.number(),
  modelId: z.number(),
  metricName: z.string(),
  score: z.number(),
  rawOutput: z.string().nullable().optional(),
  itemId: z.number().nullable().optional(),
  input: z.string().nullable().optional(),
  expectedOutput: z.string().nullable().optional(),
});

export const GoldenDatasetSchema = z.object({
  id: z.number(),
  name: z.string(),
  source: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  schemaVersion: z.number().nullable().optional(),
});

export const ArenaBattleSchema = z.object({
  id: z.number(),
  modelAId: z.number(),
  modelBId: z.number(),
  prompt: z.string(),
  winner: z.string(),
  timestamp: z.string().nullable().optional(),
});

export const EloRatingSchema = z.object({
  modelId: z.number(),
  rating: z.number(),
  gamesPlayed: z.number(),
  lastUpdated: z.string().nullable().optional(),
});

export const OllamaStatusSchema = z.object({
  running: z.boolean(),
  modelCount: z.number(),
  error: z.string().nullable().optional(),
});

export const ArenaMatchupSchema = z.object({
  prompt: z.string(),
  modelA: ModelSchema,
  modelB: ModelSchema,
  outputA: z.string(),
  outputB: z.string(),
});

export const LeaderboardEntrySchema = z.object({
  model: ModelSchema,
  rating: EloRatingSchema,
});

// ─── Shared types ────────────────────────────────────────────────────────────

export type Model = z.infer<typeof ModelSchema>;
export type EvalRun = z.infer<typeof EvalRunSchema>;
export type EvalResult = z.infer<typeof EvalResultSchema>;
export type GoldenDataset = z.infer<typeof GoldenDatasetSchema>;
export type ArenaBattle = z.infer<typeof ArenaBattleSchema>;
export type EloRating = z.infer<typeof EloRatingSchema>;
export type ArenaMatchup = z.infer<typeof ArenaMatchupSchema>;
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;

// ─── API route definitions ───────────────────────────────────────────────────

export const errorSchemas = {
  validation: z.object({ message: z.string(), field: z.string().optional() }),
  notFound: z.object({ message: z.string() }),
  internal: z.object({ message: z.string() }),
};

export const api = {
  models: {
    list: {
      method: 'GET' as const,
      path: '/api/models' as const,
      responses: { 200: z.array(ModelSchema) },
    },
    discover: {
      method: 'POST' as const,
      path: '/api/models/discover' as const,
      responses: { 200: z.array(ModelSchema) },
    }
  },
  evalRuns: {
    list: {
      method: 'GET' as const,
      path: '/api/eval-runs' as const,
      responses: { 200: z.array(EvalRunSchema) },
    },
    create: {
      method: 'POST' as const,
      path: '/api/eval-runs' as const,
      input: z.object({
        modelIds: z.array(z.number()),
        benchmarkKeys: z.array(z.string()),
        datasetId: z.number().optional()
      }),
      responses: {
        201: EvalRunSchema,
        400: errorSchemas.validation,
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/eval-runs/:id' as const,
      responses: {
        200: EvalRunSchema,
        404: errorSchemas.notFound,
      },
    },
    results: {
      method: 'GET' as const,
      path: '/api/eval-runs/:id/results' as const,
      responses: {
        200: z.array(EvalResultSchema),
        404: errorSchemas.notFound,
      }
    }
  },
  datasets: {
    list: {
      method: 'GET' as const,
      path: '/api/datasets' as const,
      responses: { 200: z.array(GoldenDatasetSchema) }
    }
  },
  ollama: {
    status: {
      method: 'GET' as const,
      path: '/api/ollama/status' as const,
      responses: { 200: OllamaStatusSchema }
    }
  },
  arena: {
    getMatchup: {
      method: 'GET' as const,
      path: '/api/arena/matchup' as const,
      responses: { 200: ArenaMatchupSchema }
    },
    vote: {
      method: 'POST' as const,
      path: '/api/arena/vote' as const,
      input: z.object({
        modelAId: z.number(),
        modelBId: z.number(),
        prompt: z.string(),
        winner: z.enum(['model_a', 'model_b', 'tie'])
      }),
      responses: {
        201: ArenaBattleSchema,
        400: errorSchemas.validation
      }
    },
    leaderboard: {
      method: 'GET' as const,
      path: '/api/arena/leaderboard' as const,
      responses: {
        200: z.array(LeaderboardEntrySchema)
      }
    }
  }
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}