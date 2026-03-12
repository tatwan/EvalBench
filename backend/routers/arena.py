from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.schemas import (
    ArenaMatchupOut, ArenaVoteIn, ArenaBattleOut,
    LeaderboardEntry, ModelOut, EloRatingOut,
)
from backend.services import storage
from backend.services.ollama import generate

router = APIRouter(prefix="/api/arena", tags=["arena"])

ARENA_PROMPTS = [
    "Explain quantum computing in simple terms.",
    "What are the main differences between supervised and unsupervised learning?",
    "Write a Python function to reverse a string.",
    "Summarize the causes of World War I in 3 sentences.",
    "What is the difference between RAM and storage?",
    "Explain what a REST API is to a non-technical person.",
    "What are the pros and cons of renewable energy?",
    "How does the internet work at a high level?",
]


@router.get("/matchup", response_model=ArenaMatchupOut)
async def get_matchup(db: Session = Depends(get_db)):
    import random
    import asyncio
    pair = storage.get_random_model_pair(db)
    if not pair:
        raise HTTPException(
            status_code=400,
            detail="Need at least 2 models. Run model discovery first.",
        )
    model_a, model_b = pair
    prompt = random.choice(ARENA_PROMPTS)

    # Run both generations concurrently for speed
    result_a, result_b = await asyncio.gather(
        generate(model_a.name, prompt),
        generate(model_b.name, prompt),
    )

    def format_output(result: dict, model_name: str) -> str:
        if result["ok"]:
            return result.get("response", "[No response]")
        return f"⚠️ {model_name} could not respond: {result.get('error', 'Unknown error')[:120]}"

    return ArenaMatchupOut(
        prompt=prompt,
        model_a=ModelOut.model_validate(model_a),
        model_b=ModelOut.model_validate(model_b),
        output_a=format_output(result_a, model_a.name),
        output_b=format_output(result_b, model_b.name),
    )


@router.post("/vote", response_model=ArenaBattleOut)
def record_vote(vote: ArenaVoteIn, db: Session = Depends(get_db)):
    battle = storage.record_arena_battle(
        db,
        model_a_id=vote.model_a_id,
        model_b_id=vote.model_b_id,
        prompt=vote.prompt,
        winner=vote.winner,
    )
    return ArenaBattleOut.model_validate(battle)


@router.get("/leaderboard", response_model=list[LeaderboardEntry])
def get_leaderboard(db: Session = Depends(get_db)):
    rows = storage.get_arena_leaderboard(db)
    return [
        LeaderboardEntry(
            model=ModelOut.model_validate(row["model"]),
            rating=EloRatingOut.model_validate(row["elo"]),
        )
        for row in rows
    ]
