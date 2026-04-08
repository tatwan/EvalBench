"""
RAG evaluation metrics — context relevance and faithfulness.
Both metrics use LLM-as-Judge since they require semantic reasoning.
Called by eval_runner when task_type="rag".
"""
import logging
from typing import Optional, Any

logger = logging.getLogger(__name__)

CONTEXT_RELEVANCE_PROMPT = """You are evaluating whether a retrieved context is relevant to a question.

Question: {question}
Retrieved Context: {context}

Score the relevance of the context to the question from 1 to 5:
1 = Completely irrelevant
2 = Mostly irrelevant
3 = Partially relevant
4 = Mostly relevant
5 = Highly relevant and directly addresses the question

Respond with only a single integer (1-5). No explanation."""

FAITHFULNESS_PROMPT = """You are evaluating whether an answer is faithful to a provided context (i.e., does not state facts beyond what the context contains).

Context: {context}
Answer: {answer}

Score the faithfulness from 1 to 5:
1 = Answer contradicts or completely ignores the context
2 = Answer mostly ignores the context
3 = Answer is partially grounded in the context
4 = Answer is mostly grounded in the context
5 = Answer is fully grounded in the context with no unsupported claims

Respond with only a single integer (1-5). No explanation."""


def _parse_score(text: str) -> float:
    """Extract a 1-5 integer from LLM response and normalize to 0-1."""
    text = text.strip()
    digit = next((c for c in text if c.isdigit()), "3")
    score = max(1, min(5, int(digit)))
    return (score - 1) / 4.0


def _call_openai_judge(client: Any, model: str, prompt: str) -> float:
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=5,
            temperature=0,
        )
        return _parse_score(resp.choices[0].message.content or "3")
    except Exception as e:
        logger.warning(f"RAG judge call failed: {e}")
        return 0.0


def _call_anthropic_judge(client: Any, model: str, prompt: str) -> float:
    try:
        resp = client.messages.create(
            model=model,
            max_tokens=5,
            messages=[{"role": "user", "content": prompt}],
        )
        return _parse_score(resp.content[0].text or "3")
    except Exception as e:
        logger.warning(f"RAG Anthropic judge call failed: {e}")
        return 0.0


def compute_rag_metrics(
    question: str,
    context: str,
    answer: str,
    client: Optional[Any],
    anthropic_client: Optional[Any],
    model: str,
) -> dict[str, float]:
    """
    Compute context_relevance and faithfulness for a RAG output.
    Returns empty dict if no judge client is configured.
    """
    if not client and not anthropic_client:
        logger.warning(
            "RAG metrics require a judge model configured in Settings. "
            "context_relevance and faithfulness will be skipped."
        )
        return {}

    call = _call_anthropic_judge if anthropic_client else _call_openai_judge
    active_client = anthropic_client if anthropic_client else client

    return {
        "context_relevance": call(
            active_client, model,
            CONTEXT_RELEVANCE_PROMPT.format(question=question, context=context),
        ),
        "faithfulness": call(
            active_client, model,
            FAITHFULNESS_PROMPT.format(context=context, answer=answer),
        ),
    }
