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

Provide a short justification, then a score from 1 to 5.
Format:
Justification: <short rationale>
Score: <int>"""

FAITHFULNESS_PROMPT = """You are evaluating whether an answer is faithful to a provided context (i.e., does not state facts beyond what the context contains).

Context: {context}
Answer: {answer}

Score the faithfulness from 1 to 5:
1 = Answer contradicts or completely ignores the context
2 = Answer mostly ignores the context
3 = Answer is partially grounded in the context
4 = Answer is mostly grounded in the context
5 = Answer is fully grounded in the context with no unsupported claims

Provide a short justification, then a score from 1 to 5.
Format:
Justification: <short rationale>
Score: <int>"""


def _parse_score_and_rationale(text: str) -> tuple[float, str]:
    """Extract a 1-5 integer from LLM response and normalize to 0-1."""
    text = text.strip()
    score = 3
    for line in reversed(text.splitlines()):
        line = line.strip()
        if line.lower().startswith("score:"):
            try:
                score = int(line.split(":", 1)[1].strip())
                break
            except Exception:
                continue
        if line.isdigit():
            score = int(line)
            break
    score = max(1, min(5, score))
    return (score - 1) / 4.0, text


def _chat_completion_with_fallback(client: Any, *, model: str, prompt: str) -> Any:
    messages = [{"role": "user", "content": prompt}]
    try:
        return client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=120,
            temperature=0,
        )
    except Exception as exc:
        error_text = str(exc)
        if "max_completion_tokens" not in error_text and "unsupported_parameter" not in error_text:
            raise
        return client.chat.completions.create(
            model=model,
            messages=messages,
            max_completion_tokens=120,
            temperature=0,
        )


def _call_openai_judge(client: Any, model: str, prompt: str) -> tuple[float, str]:
    try:
        resp = _chat_completion_with_fallback(client, model=model, prompt=prompt)
        return _parse_score_and_rationale(resp.choices[0].message.content or "Score: 3")
    except Exception as e:
        logger.warning(f"RAG judge call failed: {e}")
        return 0.0, f"Judge API Error: {e}"


def _call_anthropic_judge(client: Any, model: str, prompt: str) -> tuple[float, str]:
    try:
        resp = client.messages.create(
            model=model,
            max_tokens=120,
            messages=[{"role": "user", "content": prompt}],
        )
        return _parse_score_and_rationale(resp.content[0].text or "Score: 3")
    except Exception as e:
        logger.warning(f"RAG Anthropic judge call failed: {e}")
        return 0.0, f"Judge API Error: {e}"


def compute_rag_metrics_with_rationale(
    question: str,
    context: str,
    answer: str,
    client: Optional[Any],
    anthropic_client: Optional[Any],
    model: str,
) -> dict[str, dict[str, float | str]]:
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

    context_score, context_rationale = call(
        active_client, model,
        CONTEXT_RELEVANCE_PROMPT.format(question=question, context=context),
    )
    faithfulness_score, faithfulness_rationale = call(
        active_client, model,
        FAITHFULNESS_PROMPT.format(context=context, answer=answer),
    )

    return {
        "context_relevance": {
            "score": context_score,
            "rationale": context_rationale,
        },
        "faithfulness": {
            "score": faithfulness_score,
            "rationale": faithfulness_rationale,
        },
    }


def compute_rag_metrics(
    question: str,
    context: str,
    answer: str,
    client: Optional[Any],
    anthropic_client: Optional[Any],
    model: str,
) -> dict[str, float]:
    detailed = compute_rag_metrics_with_rationale(
        question=question,
        context=context,
        answer=answer,
        client=client,
        anthropic_client=anthropic_client,
        model=model,
    )
    return {
        metric_name: float(payload.get("score", 0.0))
        for metric_name, payload in detailed.items()
    }
