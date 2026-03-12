import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const models = sqliteTable("models", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  family: text("family"),
  params: text("params"),
  quantization: text("quantization"),
  sizeGb: real("size_gb"),
});

export const evalRuns = sqliteTable("eval_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: integer("timestamp", { mode: "timestamp" }).$defaultFn(() => new Date()),
  configJson: text("config_json", { mode: "json" }).notNull(),
  status: text("status").notNull(), // 'pending', 'running', 'completed', 'failed'
});

export const evalResults = sqliteTable("eval_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id").notNull().references(() => evalRuns.id),
  modelId: integer("model_id").notNull().references(() => models.id),
  metricName: text("metric_name").notNull(),
  score: real("score").notNull(),
  rawOutput: text("raw_output"),
});

export const goldenDatasets = sqliteTable("golden_datasets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  source: text("source"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  schemaVersion: integer("schema_version").default(1),
});

export const goldenItems = sqliteTable("golden_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  datasetId: integer("dataset_id").notNull().references(() => goldenDatasets.id),
  input: text("input").notNull(),
  expectedOutput: text("expected_output").notNull(),
  context: text("context"),
  tags: text("tags", { mode: "json" }),
  difficulty: text("difficulty"),
});

export const arenaBattles = sqliteTable("arena_battles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  modelAId: integer("model_a_id").notNull().references(() => models.id),
  modelBId: integer("model_b_id").notNull().references(() => models.id),
  prompt: text("prompt").notNull(),
  winner: text("winner").notNull(), // 'model_a', 'model_b', 'tie'
  timestamp: integer("timestamp", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const eloRatings = sqliteTable("elo_ratings", {
  modelId: integer("model_id").primaryKey().references(() => models.id),
  rating: integer("rating").notNull().default(1200),
  gamesPlayed: integer("games_played").notNull().default(0),
  lastUpdated: integer("last_updated", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const modelsRelations = relations(models, ({ many, one }) => ({
  evalResults: many(evalResults),
  arenaBattlesAsA: many(arenaBattles, { relationName: "modelA" }),
  arenaBattlesAsB: many(arenaBattles, { relationName: "modelB" }),
  eloRating: one(eloRatings, {
    fields: [models.id],
    references: [eloRatings.modelId],
  }),
}));

export const evalRunsRelations = relations(evalRuns, ({ many }) => ({
  evalResults: many(evalResults),
}));

export const evalResultsRelations = relations(evalResults, ({ one }) => ({
  run: one(evalRuns, { fields: [evalResults.runId], references: [evalRuns.id] }),
  model: one(models, { fields: [evalResults.modelId], references: [models.id] }),
}));

export const goldenDatasetsRelations = relations(goldenDatasets, ({ many }) => ({
  items: many(goldenItems),
}));

export const goldenItemsRelations = relations(goldenItems, ({ one }) => ({
  dataset: one(goldenDatasets, { fields: [goldenItems.datasetId], references: [goldenDatasets.id] }),
}));

export const insertModelSchema = createInsertSchema(models).omit({ id: true });
export const insertEvalRunSchema = createInsertSchema(evalRuns).omit({ id: true, timestamp: true });
export const insertEvalResultSchema = createInsertSchema(evalResults).omit({ id: true });
export const insertGoldenDatasetSchema = createInsertSchema(goldenDatasets).omit({ id: true, createdAt: true });
export const insertGoldenItemSchema = createInsertSchema(goldenItems).omit({ id: true });
export const insertArenaBattleSchema = createInsertSchema(arenaBattles).omit({ id: true, timestamp: true });
export const insertEloRatingSchema = createInsertSchema(eloRatings);

export type Model = typeof models.$inferSelect;
export type InsertModel = z.infer<typeof insertModelSchema>;
export type EvalRun = typeof evalRuns.$inferSelect;
export type InsertEvalRun = z.infer<typeof insertEvalRunSchema>;
export type EvalResult = typeof evalResults.$inferSelect;
export type InsertEvalResult = z.infer<typeof insertEvalResultSchema>;
export type GoldenDataset = typeof goldenDatasets.$inferSelect;
export type InsertGoldenDataset = z.infer<typeof insertGoldenDatasetSchema>;
export type GoldenItem = typeof goldenItems.$inferSelect;
export type InsertGoldenItem = z.infer<typeof insertGoldenItemSchema>;
export type ArenaBattle = typeof arenaBattles.$inferSelect;
export type InsertArenaBattle = z.infer<typeof insertArenaBattleSchema>;
export type EloRating = typeof eloRatings.$inferSelect;
export type InsertEloRating = z.infer<typeof insertEloRatingSchema>;
