import { z } from 'zod';
import { 
  insertModelSchema, models, 
  insertEvalRunSchema, evalRuns,
  insertEvalResultSchema, evalResults,
  goldenDatasets, goldenItems, arenaBattles, eloRatings
} from './schema';

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
      responses: {
        200: z.array(z.custom<typeof models.$inferSelect>()),
      },
    },
    discover: {
      method: 'POST' as const,
      path: '/api/models/discover' as const,
      responses: {
        200: z.array(z.custom<typeof models.$inferSelect>()),
      }
    }
  },
  evalRuns: {
    list: {
      method: 'GET' as const,
      path: '/api/eval-runs' as const,
      responses: {
        200: z.array(z.custom<typeof evalRuns.$inferSelect>()),
      },
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
        201: z.custom<typeof evalRuns.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/eval-runs/:id' as const,
      responses: {
        200: z.custom<typeof evalRuns.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    results: {
      method: 'GET' as const,
      path: '/api/eval-runs/:id/results' as const,
      responses: {
        200: z.array(z.custom<typeof evalResults.$inferSelect>()),
        404: errorSchemas.notFound,
      }
    }
  },
  evalResults: {
    list: {
      method: 'GET' as const,
      path: '/api/eval-results' as const,
      responses: {
        200: z.array(z.custom<typeof evalResults.$inferSelect>()),
      }
    }
  },
  datasets: {
    list: {
      method: 'GET' as const,
      path: '/api/datasets' as const,
      responses: {
        200: z.array(z.custom<typeof goldenDatasets.$inferSelect>()),
      }
    }
  },
  arena: {
    getMatchup: {
      method: 'GET' as const,
      path: '/api/arena/matchup' as const,
      responses: {
        200: z.object({
          prompt: z.string(),
          modelA: z.custom<typeof models.$inferSelect>(),
          modelB: z.custom<typeof models.$inferSelect>(),
          outputA: z.string(),
          outputB: z.string()
        })
      }
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
        201: z.custom<typeof arenaBattles.$inferSelect>(),
        400: errorSchemas.validation
      }
    },
    leaderboard: {
      method: 'GET' as const,
      path: '/api/arena/leaderboard' as const,
      responses: {
        200: z.array(z.object({
          model: z.custom<typeof models.$inferSelect>(),
          rating: z.custom<typeof eloRatings.$inferSelect>()
        }))
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