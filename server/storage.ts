import {
  models, evalRuns, evalResults, goldenDatasets, goldenItems, arenaBattles, eloRatings,
  type Model, type InsertModel, type EvalRun, type InsertEvalRun,
  type EvalResult, type GoldenDataset, type ArenaBattle, type InsertArenaBattle, type EloRating
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, sql } from "drizzle-orm";
import { listOllamaModels, generate } from "./ollama";

export interface IStorage {
  getModels(): Promise<Model[]>;
  discoverModels(): Promise<Model[]>;
  getEvalRuns(): Promise<EvalRun[]>;
  createEvalRun(run: InsertEvalRun): Promise<EvalRun>;
  getEvalRun(id: number): Promise<EvalRun | undefined>;
  getEvalResults(runId: number): Promise<EvalResult[]>;
  getGoldenDatasets(): Promise<GoldenDataset[]>;
  getArenaMatchup(): Promise<{ prompt: string, modelA: Model, modelB: Model, outputA: string, outputB: string }>;
  createArenaVote(vote: InsertArenaBattle): Promise<ArenaBattle>;
  getArenaLeaderboard(): Promise<{ model: Model, rating: EloRating }[]>;
}

export class DatabaseStorage implements IStorage {
  async getModels(): Promise<Model[]> {
    return await db.select().from(models);
  }

  async discoverModels(): Promise<Model[]> {
    const ollamaModels = await listOllamaModels();

    if (ollamaModels.length === 0) {
      // Ollama is offline or has no models — return what's in DB
      return await this.getModels();
    }

    // Bulk upsert all Ollama models in one atomic statement
    await db.insert(models)
      .values(ollamaModels.map(om => ({
        name: om.name,
        family: om.details.family ?? null,
        params: om.details.parameter_size ?? null,
        quantization: om.details.quantization_level ?? null,
        sizeGb: parseFloat((om.size / 1e9).toFixed(2)),
      })))
      .onConflictDoUpdate({
        target: models.name,
        set: {
          family: sql`excluded.family`,
          params: sql`excluded.params`,
          quantization: sql`excluded.quantization`,
          sizeGb: sql`excluded.size_gb`,
        },
      });

    // Init ELO for any newly inserted models (no-op for existing ones)
    const syncedModels = await this.getModels();
    for (const m of syncedModels) {
      await db.insert(eloRatings)
        .values({ modelId: m.id, rating: 1200, gamesPlayed: 0 })
        .onConflictDoNothing();
    }

    return syncedModels;
  }

  async getEvalRuns(): Promise<EvalRun[]> {
    return await db.select().from(evalRuns).orderBy(desc(evalRuns.timestamp));
  }

  async createEvalRun(run: InsertEvalRun): Promise<EvalRun> {
    const [inserted] = await db.insert(evalRuns).values(run).returning();
    
    // Mock evaluation results for this run since we don't have a real Python backend running
    const allModels = await this.getModels();
    const mockResults = [];
    
    // Just mock results for the first two models to simulate an eval run
    for (const model of allModels.slice(0, 2)) {
      mockResults.push({
        runId: inserted.id,
        modelId: model.id,
        metricName: "Speed (T/s)",
        score: parseFloat((Math.random() * 50 + 20).toFixed(2)), // Random speed 20-70 T/s
      });
      mockResults.push({
        runId: inserted.id,
        modelId: model.id,
        metricName: "MMLU",
        score: parseFloat((Math.random() * 40 + 40).toFixed(2)), // Random MMLU 40-80
      });
    }
    
    if (mockResults.length > 0) {
      await db.insert(evalResults).values(mockResults);
    }
    
    return inserted;
  }

  async getEvalRun(id: number): Promise<EvalRun | undefined> {
    const [run] = await db.select().from(evalRuns).where(eq(evalRuns.id, id));
    return run;
  }

  async getEvalResults(runId: number): Promise<EvalResult[]> {
    return await db.select().from(evalResults).where(eq(evalResults.runId, runId));
  }

  async getGoldenDatasets(): Promise<GoldenDataset[]> {
    return await db.select().from(goldenDatasets);
  }

  async getArenaMatchup(): Promise<{ prompt: string, modelA: Model, modelB: Model, outputA: string, outputB: string }> {
    const allModels = await this.getModels();
    if (allModels.length < 2) {
      throw new Error("At least 2 models are required for an arena matchup.");
    }

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

  async createArenaVote(vote: InsertArenaBattle): Promise<ArenaBattle> {
    const [battle] = await db.insert(arenaBattles).values(vote).returning();
    
    // Update Elo ratings
    if (vote.winner !== 'tie') {
      const winnerId = vote.winner === 'model_a' ? vote.modelAId : vote.modelBId;
      const loserId = vote.winner === 'model_a' ? vote.modelBId : vote.modelAId;
      
      const [winnerRating] = await db.select().from(eloRatings).where(eq(eloRatings.modelId, winnerId));
      const [loserRating] = await db.select().from(eloRatings).where(eq(eloRatings.modelId, loserId));
      
      if (winnerRating && loserRating) {
        const K = 32;
        const expectedWinner = 1 / (1 + Math.pow(10, (loserRating.rating - winnerRating.rating) / 400));
        const expectedLoser = 1 / (1 + Math.pow(10, (winnerRating.rating - loserRating.rating) / 400));
        
        await db.update(eloRatings)
          .set({ rating: Math.round(winnerRating.rating + K * (1 - expectedWinner)), gamesPlayed: winnerRating.gamesPlayed + 1 })
          .where(eq(eloRatings.modelId, winnerId));
          
        await db.update(eloRatings)
          .set({ rating: Math.round(loserRating.rating + K * (0 - expectedLoser)), gamesPlayed: loserRating.gamesPlayed + 1 })
          .where(eq(eloRatings.modelId, loserId));
      }
    } else {
      const [ratingA] = await db.select().from(eloRatings).where(eq(eloRatings.modelId, vote.modelAId));
      const [ratingB] = await db.select().from(eloRatings).where(eq(eloRatings.modelId, vote.modelBId));
      
      if (ratingA && ratingB) {
        await db.update(eloRatings).set({ gamesPlayed: ratingA.gamesPlayed + 1 }).where(eq(eloRatings.modelId, vote.modelAId));
        await db.update(eloRatings).set({ gamesPlayed: ratingB.gamesPlayed + 1 }).where(eq(eloRatings.modelId, vote.modelBId));
      }
    }
    
    return battle;
  }

  async getArenaLeaderboard(): Promise<{ model: Model, rating: EloRating }[]> {
    const allModels = await db.select().from(models);
    const allRatings = await db.select().from(eloRatings);
    
    const leaderboard = allModels.map(model => {
      const rating = allRatings.find(r => r.modelId === model.id) || { modelId: model.id, rating: 1200, gamesPlayed: 0, lastUpdated: new Date() };
      return { model, rating };
    });
    
    return leaderboard.sort((a, b) => b.rating.rating - a.rating.rating);
  }
}

export const storage = new DatabaseStorage();