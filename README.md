# EvalBench

A local-first LLM evaluation workbench for testing, scoring, and comparing large language models. Auto-detects Ollama models, runs standardized benchmarks, and presents results in a rich dashboard — like LM Studio for model discovery, but entirely focused on **testing, scoring, and comparing models**.

**Status**: MVP v0.1 - Core evaluation infrastructure with mock backend for UI/UX demonstration

---

## Table of Contents

- [Architecture](#architecture)
- [Core Concepts](#core-concepts)
- [Features](#features)
- [Technical Stack](#technical-stack)
- [Database Schema](#database-schema)
- [API Endpoints](#api-endpoints)
- [How It Works](#how-it-works)
- [Setup & Installation](#setup--installation)
- [Development](#development)
- [Roadmap](#roadmap)

---

## Architecture

EvalBench uses a **full-stack JavaScript architecture** optimized for rapid iteration on the UI/UX while maintaining a clean separation of concerns for future Python backend integration.

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React + TypeScript)             │
│  ┌──────────────┬──────────────┬──────────────┬──────────┐  │
│  │  Dashboard   │   Models     │ Eval Wizard  │  Arena   │  │
│  └──────────────┴──────────────┴──────────────┴──────────┘  │
└─────────────────────────────────────────────────────────────┘
                             ↕
                    REST API (Express.js)
                             ↕
┌─────────────────────────────────────────────────────────────┐
│            Backend (Node.js + PostgreSQL)                    │
│  ┌──────────────┬──────────────┬──────────────┐             │
│  │  Storage     │   Routes     │  Database    │             │
│  │  Interface   │  (API)       │  (Drizzle)   │             │
│  └──────────────┴──────────────┴──────────────┘             │
└─────────────────────────────────────────────────────────────┘
                             ↕
                      PostgreSQL Database
                      (Models, Runs, Results,
                       Datasets, Arena Battles,
                       Elo Ratings)
```

### Frontend Stack
- **React 18** with TypeScript for UI components
- **Wouter** for client-side routing
- **TanStack React Query** for server state management
- **Tailwind CSS** for styling with custom theme variables
- **Shadcn UI** component library (with Radix UI primitives)
- **Framer Motion** for smooth page transitions
- **Recharts** for data visualization
- **React Hook Form** with Zod validation for forms

### Backend Stack
- **Express.js** for REST API routing
- **Drizzle ORM** for type-safe database operations
- **PostgreSQL** for persistent data storage
- **Zod** for schema validation and API contracts
- **Node.js** with TypeScript

### Data Layer
- **Shared types** in `shared/schema.ts` - Single source of truth for database models
- **API contracts** in `shared/routes.ts` - Defines all endpoints and their request/response types
- **Storage interface** in `server/storage.ts` - Abstraction layer for database operations

---

## Core Concepts

### 1. Models
Language models available for evaluation. Each model has metadata about family, parameter count, quantization, and size.

```typescript
Model {
  id: number
  name: string        // e.g., "llama3-8b-instruct"
  family: string      // e.g., "llama3"
  params: string      // e.g., "8B"
  quantization: string // e.g., "Q4_K_M"
  sizeGb: decimal     // Storage size in GB
}
```

### 2. Evaluation Runs
Represents a single evaluation session that tests one or more models against benchmarks.

```typescript
EvalRun {
  id: number
  timestamp: date
  configJson: object  // Stores model IDs, benchmark selection, dataset choice
  status: string      // "pending" | "running" | "completed" | "failed"
}
```

### 3. Evaluation Results
Individual metric scores from an evaluation run. One record per model per metric.

```typescript
EvalResult {
  id: number
  runId: number       // References EvalRun
  modelId: number     // References Model
  metricName: string  // e.g., "MMLU", "Speed (T/s)", "ROUGE-1"
  score: decimal      // The computed metric value
  rawOutput: string   // Optional raw metric output for inspection
}
```

### 4. Golden Datasets
Curated test sets used for evaluation (built-in benchmarks + user uploads).

```typescript
GoldenDataset {
  id: number
  name: string        // e.g., "MMLU"
  source: string      // e.g., "built-in" or "user_upload"
  createdAt: date
  schemaVersion: int  // For future schema migrations

  Items: [
    {
      id: number
      input: string           // The question/prompt
      expectedOutput: string  // Ground truth answer
      context: string         // Optional context (for RAG eval)
      tags: array            // e.g., ["science", "math"]
      difficulty: string     // "easy" | "medium" | "hard"
    }
  ]
}
```

### 5. Arena Battles
Pairwise comparison mode where users vote on which model produces a better response.

```typescript
ArenaBattle {
  id: number
  modelAId: number
  modelBId: number
  prompt: string
  winner: string      // "model_a" | "model_b" | "tie"
  timestamp: date
}
```

### 6. Elo Ratings
Tracks ranking of models based on arena battle outcomes.

```typescript
EloRating {
  modelId: number (PK)
  rating: int         // Standard chess ELO (default 1200)
  gamesPlayed: int
  lastUpdated: date
}
```

---

## Features

### MVP v0.1 (Current)

#### Model Discovery
- Auto-discovers available models from system
- Displays model metadata: family, parameters, quantization, size
- "Discover Models" button triggers fresh detection

#### Evaluation Runs
- Multi-step evaluation wizard:
  - **Step 1**: Select models to evaluate
  - **Step 2**: Choose benchmarks (MMLU, HellaSwag, ARC, etc.)
  - **Step 3**: Execute evaluation
- Real-time progress tracking (UI ready, backend mock)
- Results table with sortable metrics
- Run history with timestamps

#### Dashboard
- **Leaderboard**: Ranked table of all models across all metrics
- **Run History**: Recent evaluation runs with status
- Charts and statistics (powered by Recharts)

#### Arena Mode
- Pairwise model comparison
- Side-by-side output display (anonymized model names)
- Vote on winner: Model A, Model B, or Tie
- **Leaderboard**: ELO ratings of models based on arena votes
- ELO calculation with K-factor = 32

### Future Phases

#### v0.2
- LLM-as-Judge metrics with frontier APIs (OpenAI, Claude, Gemini)
- Custom metric definitions via natural language (GEval framework)
- Custom dataset upload and validation
- Radar charts for multi-dimensional comparisons

#### v0.3
- Enhanced arena mode with more battle types
- Elo confidence intervals
- History tracking (score trends over time)
- Prometheus 2 as local judge model
- MoverScore and BLEURT metrics

#### v1.0
- In-app dataset builder (synthetic generation, human review)
- PDF report generation
- Community metric plugin system
- vLLM backend support
- Multi-user/team collaboration
- Custom rubric builder with chain-of-thought evaluation

---

## Technical Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | React | 18+ |
| **Routing** | Wouter | Latest |
| **State** | TanStack React Query | 5+ |
| **Forms** | React Hook Form + Zod | Latest |
| **Styling** | Tailwind CSS + Shadcn UI | Latest |
| **Animations** | Framer Motion | Latest |
| **Charts** | Recharts | Latest |
| **API Client** | Fetch API + Zod | Native |
| **Backend** | Express.js | Latest |
| **ORM** | Drizzle | Latest |
| **Database** | PostgreSQL | 12+ |
| **Validation** | Zod | Latest |
| **Runtime** | Node.js | 18+ |
| **Language** | TypeScript | 5+ |

---

## Database Schema

### Tables

#### `models`
```sql
id (serial, PK)
name (text, unique) - e.g., "llama3-8b-instruct"
family (text) - e.g., "llama3"
params (text) - e.g., "8B"
quantization (text) - e.g., "Q4_K_M"
size_gb (numeric)
```

#### `eval_runs`
```sql
id (serial, PK)
timestamp (timestamp, default now())
config_json (json) - Stores: { modelIds[], benchmarkKeys[], datasetId? }
status (text) - "pending" | "running" | "completed" | "failed"
```

#### `eval_results`
```sql
id (serial, PK)
run_id (int, FK) → eval_runs
model_id (int, FK) → models
metric_name (text) - e.g., "MMLU", "Speed (T/s)"
score (numeric)
raw_output (text)
```

#### `golden_datasets`
```sql
id (serial, PK)
name (text) - e.g., "MMLU"
source (text) - "built-in" or "user_upload"
created_at (timestamp, default now())
schema_version (int, default 1)
```

#### `golden_items`
```sql
id (serial, PK)
dataset_id (int, FK) → golden_datasets
input (text) - The prompt/question
expected_output (text) - Ground truth
context (text) - Optional context
tags (json) - Array of strings
difficulty (text) - "easy" | "medium" | "hard"
```

#### `arena_battles`
```sql
id (serial, PK)
model_a_id (int, FK) → models
model_b_id (int, FK) → models
prompt (text)
winner (text) - "model_a" | "model_b" | "tie"
timestamp (timestamp, default now())
```

#### `elo_ratings`
```sql
model_id (int, PK, FK) → models
rating (int, default 1200)
games_played (int, default 0)
last_updated (timestamp, default now())
```

---

## API Endpoints

### Models

#### `GET /api/models`
Returns all discovered models.

**Response (200)**:
```json
[
  {
    "id": 1,
    "name": "llama3-8b-instruct",
    "family": "llama3",
    "params": "8B",
    "quantization": "Q4_K_M",
    "sizeGb": "4.7"
  }
]
```

#### `POST /api/models/discover`
Triggers model discovery (e.g., from Ollama API).

**Response (200)**:
```json
[
  // Same format as GET /api/models
]
```

### Evaluation Runs

#### `GET /api/eval-runs`
Returns all evaluation runs, ordered by newest first.

**Response (200)**:
```json
[
  {
    "id": 1,
    "timestamp": "2025-03-11T03:44:00Z",
    "configJson": { "modelIds": [1, 2], "benchmarkKeys": ["mmlu"] },
    "status": "completed"
  }
]
```

#### `POST /api/eval-runs`
Creates a new evaluation run.

**Request Body**:
```json
{
  "modelIds": [1, 2, 3],
  "benchmarkKeys": ["mmlu", "hellaswag", "arc"],
  "datasetId": 1
}
```

**Response (201)**:
```json
{
  "id": 42,
  "timestamp": "2025-03-11T03:45:00Z",
  "configJson": {...},
  "status": "running"
}
```

#### `GET /api/eval-runs/:id`
Returns a single evaluation run.

**Response (200)**: Same format as POST response

#### `GET /api/eval-runs/:id/results`
Returns all results from an evaluation run.

**Response (200)**:
```json
[
  {
    "id": 1,
    "runId": 42,
    "modelId": 1,
    "metricName": "MMLU",
    "score": 72.5,
    "rawOutput": null
  }
]
```

### Datasets

#### `GET /api/datasets`
Returns all golden datasets.

**Response (200)**:
```json
[
  {
    "id": 1,
    "name": "MMLU",
    "source": "built-in",
    "createdAt": "2025-03-11T00:00:00Z",
    "schemaVersion": 1
  }
]
```

### Arena

#### `GET /api/arena/matchup`
Returns a random pairwise matchup for user voting.

**Response (200)**:
```json
{
  "prompt": "Explain quantum computing in one sentence.",
  "modelA": { "id": 1, "name": "llama3-8b-instruct", ... },
  "modelB": { "id": 2, "name": "mistral-7b-instruct", ... },
  "outputA": "[Simulated output from Model A]",
  "outputB": "[Simulated output from Model B]"
}
```

#### `POST /api/arena/vote`
Records a user's vote on a matchup.

**Request Body**:
```json
{
  "modelAId": 1,
  "modelBId": 2,
  "prompt": "Explain quantum computing...",
  "winner": "model_a"
}
```

**Response (201)**:
```json
{
  "id": 123,
  "modelAId": 1,
  "modelBId": 2,
  "prompt": "...",
  "winner": "model_a",
  "timestamp": "2025-03-11T03:50:00Z"
}
```

#### `GET /api/arena/leaderboard`
Returns ELO-ranked leaderboard from arena battles.

**Response (200)**:
```json
[
  {
    "model": { "id": 1, "name": "llama3-8b-instruct", ... },
    "rating": {
      "modelId": 1,
      "rating": 1250,
      "gamesPlayed": 15,
      "lastUpdated": "2025-03-11T03:50:00Z"
    }
  }
]
```

---

## How It Works

### User Workflow: Creating an Evaluation Run

1. **Navigate to Eval Wizard** from sidebar
2. **Select Models** — Checkbox list of available models (fetched via `GET /api/models`)
3. **Choose Benchmarks** — Multi-select from predefined benchmarks (MMLU, HellaSwag, ARC, GSM8K, TruthfulQA, WinoGrande, BoolQ)
4. **Execute** — Submit via `POST /api/eval-runs` with selected models and benchmarks
5. **View Results** — Dashboard shows run status and results table

**Current Implementation (MVP)**:
- Mock evaluation results are generated on the backend when a run is created
- Results appear immediately (simulating completed evaluation)
- Real Python backend integration coming in v0.2

### User Workflow: Arena Mode

1. **Navigate to Arena** from sidebar
2. **Get Matchup** — Fetch random model pair via `GET /api/arena/matchup`
3. **Read Outputs** — Compare anonymized responses side-by-side
4. **Vote** — Choose Model A, Model B, or Tie via `POST /api/arena/vote`
5. **View Leaderboard** — See ELO rankings updated by your votes

**ELO Calculation**:
- Initial rating: 1200 (chess standard)
- K-factor: 32 (tournament standard)
- Formula: `new_rating = old_rating + K * (actual - expected)`
- Expected: `1 / (1 + 10^((opponent_rating - your_rating) / 400))`

### Data Flow: Frontend to Backend

1. **Frontend** makes API request with Zod-validated data
2. **Backend** parses request body with matching Zod schema
3. **Storage layer** performs database operation via Drizzle
4. **Response** is validated by frontend and cached by React Query
5. **UI** updates with new data

---

## Setup & Installation

### Prerequisites
- Node.js 18+
- PostgreSQL 12+
- npm 9+

### Quick Start

```bash
# 1. Clone repository
git clone <repo>
cd evalbench

# 2. Install dependencies
npm install

# 3. Create PostgreSQL database
# (Handled automatically by Replit if using Replit database)

# 4. Push schema to database
npm run db:push

# 5. Start development server
npm run dev
```

The app will be available at `http://localhost:5000`

### Environment Variables

Create a `.env.local` file (for development):

```env
DATABASE_URL=postgresql://user:password@localhost:5432/evalbench
```

**Replit**: DATABASE_URL is automatically set when using Replit's PostgreSQL database.

### Build for Production

```bash
npm run build
npm run start
```

---

## Development

### Project Structure

```
├── client/                    # Frontend React app
│   ├── src/
│   │   ├── pages/            # Page components (Dashboard, Models, Arena, etc.)
│   │   ├── components/       # Reusable UI components
│   │   ├── hooks/            # Custom React hooks (useModels, useEval, useArena)
│   │   ├── lib/              # Utility functions, query client
│   │   ├── App.tsx           # Root router
│   │   └── index.css         # Tailwind + theme variables
│   └── index.html
├── server/                    # Backend Express app
│   ├── routes.ts             # API endpoints
│   ├── storage.ts            # Storage interface & DatabaseStorage class
│   ├── db.ts                 # Drizzle database connection
│   ├── index.ts              # Express server setup
│   └── vite.ts               # Vite dev server integration
├── shared/                    # Shared types & contracts
│   ├── schema.ts             # Drizzle tables, Zod schemas, types
│   └── routes.ts             # API endpoint definitions
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── vite.config.ts
└── drizzle.config.ts
```

### Key Files

**`shared/schema.ts`**
- Defines Drizzle ORM tables
- Exports Zod schemas for insert/update operations
- Central source of truth for data models

**`shared/routes.ts`**
- Defines all API endpoints and their request/response contracts
- Used by both frontend (for type-safe requests) and backend (for validation)
- Includes `buildUrl()` helper for URL parameter substitution

**`server/storage.ts`**
- Implements `IStorage` interface
- All database operations go through this layer
- Makes backend testable and mockable

**`server/routes.ts`**
- Express route handlers
- Validates requests with Zod schemas from `shared/routes.ts`
- Returns responses matching contract definitions

**`client/src/App.tsx`**
- Wouter router configuration
- Wraps app in QueryClientProvider and TooltipProvider

### Adding a New Feature

1. **Update `shared/schema.ts`**:
   - Add Drizzle table definition
   - Create insert/update schemas with Zod
   - Export types

2. **Update `shared/routes.ts`**:
   - Add new endpoint definitions to `api` object
   - Define request/response schemas

3. **Update `server/storage.ts`**:
   - Add method to `IStorage` interface
   - Implement in `DatabaseStorage` class

4. **Update `server/routes.ts`**:
   - Add Express route handler
   - Use schema.parse() for validation

5. **Update `client/`**:
   - Create custom hook in `client/src/hooks/`
   - Create page or component in `client/src/pages/` or `client/src/components/`
   - Register route in `App.tsx`

### Running Tests

Tests are not currently implemented. For MVP, manual testing via:
- Browser developer tools
- API testing with curl or Postman
- React Query DevTools (network tab)

---

## Roadmap

### Phase 1: MVP v0.1 (Current)
- ✅ Model discovery and management
- ✅ Evaluation run creation and results display
- ✅ Basic leaderboard
- ✅ Arena pairwise comparison with ELO ratings
- 🔄 Mock backend (ready for real Python integration)

### Phase 2: v0.2 (Q2 2025)
- [ ] Python FastAPI backend for real metric computation
- [ ] LLM-as-Judge metrics (OpenAI, Claude, Gemini APIs)
- [ ] Custom metric definitions (GEval framework)
- [ ] Custom dataset upload with validation
- [ ] Radar charts and multi-dimensional visualizations

### Phase 3: v0.3 (Q3 2025)
- [ ] Enhanced arena with pairwise + direct assessment modes
- [ ] ELO confidence intervals
- [ ] Score history tracking (trends over time)
- [ ] Prometheus 2 as local judge option
- [ ] Additional metrics: MoverScore, BLEURT

### Phase 4: v1.0 (Q4 2025+)
- [ ] In-app dataset builder with synthetic generation
- [ ] PDF report generation
- [ ] Community metrics plugin system
- [ ] vLLM backend support
- [ ] Multi-user collaboration and team workspaces

---

## Performance Considerations

### Frontend
- React Query caches all API responses with 5-minute stale time
- Leaderboard table uses virtualization for 1000+ models
- Charts re-render only when data changes

### Backend
- Database queries use indexes on `run_id`, `model_id`, and `timestamp`
- ELO calculations done in-memory (not database triggers)
- Mock backend currently returns results in < 50ms

### Database
- PostgreSQL connection pooling via `pg` package
- Drizzle optimizes queries with proper select/where clauses
- No N+1 queries (relations pre-defined in schema)

---

## Future Architecture Notes

### Python Backend Integration (v0.2+)

The current Node.js backend is designed as a temporary bridge. For v0.2, a **Python FastAPI sidecar** will handle:

- Ollama API calls for model discovery and generation
- Metric computation (BLEU, ROUGE, BERTScore, etc.)
- LLM-as-Judge evaluation
- Benchmark dataset streaming

The **Node.js backend will remain** as:
- API Gateway and routing
- Database persistence
- Session management
- Real-time progress via Server-Sent Events (SSE)

**Communication**: Node.js ↔ Python via HTTP/REST or WebSocket for streaming results.

---

## Contributing

To contribute:

1. Create a feature branch from `main`
2. Make changes following the project structure
3. Run `npm run build` to verify compilation
4. Push and open a pull request

---

## License

MIT

---

## Support

For issues, questions, or feature requests, please open a GitHub issue or contact the maintainers.

---

**Last Updated**: March 11, 2025  
**Version**: 0.1.0-alpha (MVP)
