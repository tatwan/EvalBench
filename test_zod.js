import { z } from "zod";

const TaskTypeSchema = z.enum(["summarization", "qa", "chat", "translation", "code", "reasoning", "knowledge", "embedding", "classification", "safety"]);

const EvalRunConfigSchema = z.object({
  modelIds: z.array(z.number()).default([]),
  taskType: TaskTypeSchema.default("qa"),
  benchmarkKeys: z.array(z.string()).optional().default([]),
  datasetId: z.number().nullable().optional(),
  datasetItemCount: z.number().optional(),
  totalPairs: z.number().optional(),
  completedPairs: z.number().optional(),
  errorCount: z.number().optional(),
  retryCount: z.number().optional(),
  cacheHits: z.number().optional(),
  durationSeconds: z.number().optional(),
  cancelRequested: z.boolean().optional(),
  errors: z.array(z.string()).optional(),
}).passthrough();

const EvalRunSchema = z.object({
  id: z.number(),
  timestamp: z.string().nullable().optional(),
  configJson: EvalRunConfigSchema,
  status: z.string(),
});

import fs from "fs";
const data = JSON.parse(fs.readFileSync('runs.json', 'utf8'));
try {
  z.array(EvalRunSchema).parse(data);
  console.log("Success!");
} catch (e) {
  console.error("Zod Parse Failed:");
  console.error(JSON.stringify(e.errors, null, 2));
}
