import { z } from 'zod';

// ─── Shared Zod types matching FastAPI Pydantic responses ───────────────────

export const TaskTypeSchema = z.enum([
  'summarization',
  'qa',
  'chat',
  'translation',
  'code',
  'reasoning',
  'knowledge',
  'embedding',
  'classification',
  'safety',
  'rag',
]);

export const ModelSchema = z.object({
  id: z.number(),
  name: z.string(),
  family: z.string().nullable().optional(),
  params: z.string().nullable().optional(),
  quantization: z.string().nullable().optional(),
  sizeGb: z.number().nullable().optional(),
});

export const EvalRunConfigSchema = z.object({
  modelIds: z.array(z.number()).default([]),
  cloudModels: z.array(z.string()).optional().default([]),
  taskType: TaskTypeSchema.default('qa'),
  benchmarkKeys: z.array(z.string()).optional().default([]),
  datasetId: z.number().nullable().optional(),
  datasetItemCount: z.number().nullable().optional(),
  totalPairs: z.number().nullable().optional(),
  completedPairs: z.number().nullable().optional(),
  errorCount: z.number().nullable().optional(),
  retryCount: z.number().nullable().optional(),
  cacheHits: z.number().nullable().optional(),
  durationSeconds: z.number().nullable().optional(),
  judgeModel: z.string().nullable().optional(),
  judgeProvider: z.string().nullable().optional(),
  cancelRequested: z.boolean().nullable().optional(),
  errors: z.array(z.string()).nullable().optional(),
}).passthrough();

export const EvalRunSchema = z.object({
  id: z.number(),
  timestamp: z.string().nullable().optional(),
  configJson: EvalRunConfigSchema,
  status: z.string(),
});

export const EvalResultSchema = z.object({
  id: z.number(),
  runId: z.number(),
  modelId: z.number(),
  metricName: z.string(),
  score: z.number(),
  error: z.boolean().optional().default(false),
  rawOutput: z.string().nullable().optional(),
  itemId: z.number().nullable().optional(),
  input: z.string().nullable().optional(),
  expectedOutput: z.string().nullable().optional(),
  context: z.string().nullable().optional(),
  modelName: z.string().nullable().optional(),
});

export const EvalStatSchema = z.object({
  modelId: z.number(),
  metricName: z.string(),
  mean: z.number(),
  moe: z.number(),
  count: z.number(),
});

export const GoldenDatasetSchema = z.object({
  id: z.number(),
  name: z.string(),
  source: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  schemaVersion: z.number().nullable().optional(),
  itemCount: z.number().optional().default(0),
});

export const GoldenItemSchema = z.object({
  id: z.number(),
  datasetId: z.number(),
  input: z.string(),
  expectedOutput: z.string(),
  context: z.string().nullable().optional(),
  tags: z.any().optional(),
  difficulty: z.string().nullable().optional(),
});

export const GoldenItemInputSchema = z.object({
  input: z.string().min(1),
  expectedOutput: z.string().min(1),
  context: z.string().nullable().optional(),
  tags: z.any().optional(),
  difficulty: z.string().nullable().optional(),
});

export const GoldenDatasetDetailSchema = GoldenDatasetSchema.extend({
  items: z.array(GoldenItemSchema),
});

export const GoldenDatasetImportPreviewSchema = z.object({
  count: z.number(),
  items: z.array(GoldenItemInputSchema),
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
export type TaskType = z.infer<typeof TaskTypeSchema>;
export type EvalRunConfig = z.infer<typeof EvalRunConfigSchema>;
export type EvalRun = z.infer<typeof EvalRunSchema>;
export type EvalResult = z.infer<typeof EvalResultSchema>;
export type EvalStat = z.infer<typeof EvalStatSchema>;
export type GoldenDataset = z.infer<typeof GoldenDatasetSchema>;
export type GoldenItem = z.infer<typeof GoldenItemSchema>;
export type GoldenDatasetDetail = z.infer<typeof GoldenDatasetDetailSchema>;
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
        modelIds: z.array(z.number()).default([]),
        cloudModels: z.array(z.string()).optional(),
        taskType: TaskTypeSchema,
        benchmarkKeys: z.array(z.string()).optional(),
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
    cancel: {
      method: 'POST' as const,
      path: '/api/eval-runs/:id/cancel' as const,
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
    },
    stats: {
      method: 'GET' as const,
      path: '/api/eval-runs/:id/stats' as const,
      responses: {
        200: z.array(EvalStatSchema),
        404: errorSchemas.notFound,
      }
    }
  },
  evalResults: {
    list: {
      method: 'GET' as const,
      path: '/api/eval-results' as const,
      responses: { 200: z.array(EvalResultSchema) },
    }
  },
  datasets: {
    list: {
      method: 'GET' as const,
      path: '/api/datasets' as const,
      responses: { 200: z.array(GoldenDatasetSchema) }
    },
    get: {
      method: 'GET' as const,
      path: '/api/datasets/:id' as const,
      responses: {
        200: GoldenDatasetDetailSchema,
        404: errorSchemas.notFound,
      }
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/datasets/:id' as const,
      responses: {
        200: z.object({
          id: z.number(),
          name: z.string(),
        }),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      }
    },
    create: {
      method: 'POST' as const,
      path: '/api/datasets' as const,
      input: z.object({
        name: z.string().min(1),
        source: z.string().optional(),
        items: z.array(GoldenItemInputSchema).min(1),
      }),
      responses: {
        201: GoldenDatasetDetailSchema,
        400: errorSchemas.validation,
      }
    },
    importPreview: {
      method: 'POST' as const,
      path: '/api/datasets/import-preview' as const,
      input: z.object({
        name: z.string().min(1),
        source: z.string().optional(),
        format: z.enum(['json', 'csv']),
        content: z.string().min(1),
      }),
      responses: {
        200: GoldenDatasetImportPreviewSchema,
        400: errorSchemas.validation,
      }
    },
    import: {
      method: 'POST' as const,
      path: '/api/datasets/import' as const,
      input: z.object({
        name: z.string().min(1),
        source: z.string().optional(),
        format: z.enum(['json', 'csv']),
        content: z.string().min(1),
      }),
      responses: {
        201: GoldenDatasetDetailSchema,
        400: errorSchemas.validation,
      }
    }
  },
  ollama: {
    status: {
      method: 'GET' as const,
      path: '/api/ollama/status' as const,
      responses: { 200: OllamaStatusSchema }
    },
    start: {
      method: 'POST' as const,
      path: '/api/ollama/start' as const,
      responses: {
        200: z.object({
          ok: z.boolean(),
          message: z.string(),
          running: z.boolean(),
        })
      }
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
        200: ArenaBattleSchema,
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
