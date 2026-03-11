import { pgTable, text, serial, integer, numeric, timestamp, json, boolean } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const models = pgTable("models", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  family: text("family"),
  params: text("params"),
  quantization: text("quantization"),
  sizeGb: numeric("size_gb"),
});

export const evalRuns = pgTable("eval_runs", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").defaultNow(),
  configJson: json("config_json").notNull(),
  status: text("status").notNull(), // 'pending', 'running', 'completed', 'failed'
});

export const evalResults = pgTable("eval_results", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => evalRuns.id),
  modelId: integer("model_id").notNull().references(() => models.id),
  metricName: text("metric_name").notNull(),
  score: numeric("score").notNull(),
  rawOutput: text("raw_output"),
});

export const goldenDatasets = pgTable("golden_datasets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  source: text("source"),
  createdAt: timestamp("created_at").defaultNow(),
  schemaVersion: integer("schema_version").default(1),
});

export const goldenItems = pgTable("golden_items", {
  id: serial("id").primaryKey(),
  datasetId: integer("dataset_id").notNull().references(() => goldenDatasets.id),
  input: text("input").notNull(),
  expectedOutput: text("expected_output").notNull(),
  context: text("context"),
  tags: json("tags"),
  difficulty: text("difficulty"),
});

export const arenaBattles = pgTable("arena_battles", {
  id: serial("id").primaryKey(),
  modelAId: integer("model_a_id").notNull().references(() => models.id),
  modelBId: integer("model_b_id").notNull().references(() => models.id),
  prompt: text("prompt").notNull(),
  winner: text("winner").notNull(), // 'model_a', 'model_b', 'tie'
  timestamp: timestamp("timestamp").defaultNow(),
});

export const eloRatings = pgTable("elo_ratings", {
  modelId: integer("model_id").primaryKey().references(() => models.id),
  rating: integer("rating").notNull().default(1200),
  gamesPlayed: integer("games_played").notNull().default(0),
  lastUpdated: timestamp("last_updated").defaultNow(),
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