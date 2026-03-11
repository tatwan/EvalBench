import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Seed Database with mock initial data if empty
  const existingModels = await storage.getModels();
  if (existingModels.length === 0) {
    await storage.discoverModels();
  }

  // Models
  app.get(api.models.list.path, async (req, res) => {
    const models = await storage.getModels();
    res.json(models);
  });

  app.post(api.models.discover.path, async (req, res) => {
    const models = await storage.discoverModels();
    res.json(models);
  });

  // Eval Runs
  app.get(api.evalRuns.list.path, async (req, res) => {
    const runs = await storage.getEvalRuns();
    res.json(runs);
  });

  app.post(api.evalRuns.create.path, async (req, res) => {
    try {
      const input = api.evalRuns.create.input.parse(req.body);
      const run = await storage.createEvalRun({
        configJson: input,
        status: 'completed' // Mocking immediate completion for the UI demo
      });
      res.status(201).json(run);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.get(api.evalRuns.get.path, async (req, res) => {
    const run = await storage.getEvalRun(Number(req.params.id));
    if (!run) return res.status(404).json({ message: "Run not found" });
    res.json(run);
  });

  app.get(api.evalRuns.results.path, async (req, res) => {
    const results = await storage.getEvalResults(Number(req.params.id));
    res.json(results);
  });

  // Datasets
  app.get(api.datasets.list.path, async (req, res) => {
    const datasets = await storage.getGoldenDatasets();
    res.json(datasets);
  });

  // Arena
  app.get(api.arena.getMatchup.path, async (req, res) => {
    try {
      const matchup = await storage.getArenaMatchup();
      res.json(matchup);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post(api.arena.vote.path, async (req, res) => {
    try {
      const input = api.arena.vote.input.parse(req.body);
      const battle = await storage.createArenaVote(input);
      res.status(201).json(battle);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.get(api.arena.leaderboard.path, async (req, res) => {
    const leaderboard = await storage.getArenaLeaderboard();
    res.json(leaderboard);
  });

  return httpServer;
}