from typing import Any, Tuple, Optional
from sqlalchemy.orm import Session
from backend.models import Setting
from backend.security import decrypt_value, is_sensitive

# Standard Prompt Templates for G-Eval
PROMPTS = {
    "fluency": """You are an expert linguistic evaluator.
Score the following text from 1 to 5 based on its fluency, grammar, and readability.
A score of 1 means completely unreadable.
A score of 5 means perfect native-like fluency.

Text to evaluate:
{output}

Provide a short 1-2 sentence justification, followed by a newline, followed by the integer score (1-5).
Format:
Justification: <rationale>
Score: <int>""",

    "relevance": """You are an expert evaluator.
Score how relevant the model's output is to the given prompt from 1 to 5.
A score of 1 means completely irrelevant or off-topic.
A score of 5 means perfectly relevant and answers the prompt directly.

Prompt: {input}
Output: {output}

Provide a short 1-2 sentence justification, followed by a newline, followed by the integer score (1-5).
Format:
Justification: <rationale>
Score: <int>""",

    "coherence": """You are an expert evaluator.
Score the coherence and logical flow of the following text from 1 to 5.
A score of 1 means self-contradictory and disjointed.
A score of 5 means perfectly logical, cohesive, and easy to follow.

Text to evaluate:
{output}

Provide a short 1-2 sentence justification, followed by a newline, followed by the integer score (1-5).
Format:
Justification: <rationale>
Score: <int>""",

    "correctness": """You are an expert evaluator.
Score the factual correctness of the model's output compared to the expected correct answer from 1 to 5.
A score of 1 means completely incorrect or contradicting the expected answer.
A score of 5 means perfectly correct and factually aligned with the expected answer.

Prompt: {input}
Expected Answer: {context}
Model Output: {output}

Provide a short 1-2 sentence justification, followed by a newline, followed by the integer score (1-5).
Format:
Justification: <rationale>
Score: <int>""",

    "faithfulness": """You are an expert evaluator.
Score the faithfulness of the model's output to the provided source context from 1 to 5.
A score of 1 means the output is entirely hallucinated or contradicts the source context.
A score of 5 means the output is strictly grounded in the provided source context without any hallucination.

Context: {context}
Model Output: {output}

Provide a short 1-2 sentence justification, followed by a newline, followed by the integer score (1-5).
Format:
Justification: <rationale>
Score: <int>"""
}

FALSEY_SETTING_VALUES = {"", "0", "false", "no", "off"}


def _chat_completion_with_fallback(client: Any, *, model: str, messages: list[dict], temperature: float, max_output_tokens: int):
    try:
        return client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_output_tokens,
        )
    except Exception as exc:
        error_text = str(exc)
        if "max_completion_tokens" not in error_text and "unsupported_parameter" not in error_text:
            raise
        return client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
            max_completion_tokens=max_output_tokens,
        )


def _embedding_with_fallback(client: Any, *, model: str, input_text: str):
    return client.embeddings.create(
        model=model,
        input=input_text,
    )

def _provider_for_model(model_name: str | None) -> tuple[str | None, str | None]:
    if not model_name:
        return None, None
    if model_name.startswith("groq-"):
        return "groq", model_name.removeprefix("groq-")
    if model_name.startswith(("gpt-", "o1", "o3", "o4", "chatgpt-", "text-embedding-")):
        return "openai", model_name
    if model_name.startswith("claude-"):
        return "anthropic", model_name
    if model_name.startswith("gemini-"):
        return "gemini", model_name
    if model_name.startswith("grok-"):
        return "grok", model_name
    return "ollama", model_name


def _decrypted_settings(db: Session) -> dict[str, str]:
    raw_settings = {s.key: s.value for s in db.query(Setting).all()}
    settings: dict[str, str] = {}
    for k, v in raw_settings.items():
        settings[k] = decrypt_value(v or "") if is_sensitive(k) else (v or "")
    return settings


def _setting_enabled(value: str | None, default: bool = True) -> bool:
    if value is None:
        return default
    return value.strip().lower() not in FALSEY_SETTING_VALUES


def judge_is_enabled(db: Session) -> bool:
    settings = _decrypted_settings(db)
    return _setting_enabled(settings.get("judge_enabled"), default=True)


def get_judge_model_name(db: Session) -> str | None:
    settings = _decrypted_settings(db)
    judge_model = (settings.get("judge_model") or "").strip()
    return judge_model or None


def get_model_client(db: Session, model_name: str | None) -> Tuple[Optional[Any], Optional[str], Optional[Any], Optional[str]]:
    """Return a provider client for the requested model id plus the invocation model name."""
    if not model_name:
        return None, None, None, None

    settings = _decrypted_settings(db)
    provider, invocation_model = _provider_for_model(model_name)
    if not provider or not invocation_model:
        return None, None, None, "Model provider could not be determined."

    base_url = settings.get("ollama_host", "http://localhost:11434") + "/v1"
    api_key = settings.get("openai_api_key", "ollama")

    if provider == "openai":
        base_url = "https://api.openai.com/v1"
        api_key = settings.get("openai_api_key", "")
    elif provider == "gemini":
        base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
        api_key = settings.get("gemini_api_key", "")
    elif provider == "grok":
        base_url = "https://api.x.ai/v1"
        api_key = settings.get("grok_api_key", "")
    elif provider == "groq":
        base_url = "https://api.groq.com/openai/v1"
        api_key = settings.get("groq_api_key", "")
    elif provider == "anthropic":
        api_key = settings.get("anthropic_api_key", "")
        try:
            import anthropic
        except ImportError:
            return None, invocation_model, None, "Anthropic SDK is not installed. Install dependencies before using Claude models."
        anthropic_client = anthropic.Anthropic(api_key=api_key)
        return None, invocation_model, anthropic_client, None

    try:
        from openai import OpenAI
    except ImportError:
        return None, invocation_model, None, "OpenAI-compatible SDK is not installed. Install dependencies before using cloud models."

    client = OpenAI(base_url=base_url, api_key=api_key)
    return client, invocation_model, None, None


def get_judge_client(db: Session) -> Tuple[Optional[Any], Optional[str], Optional[Any], Optional[str]]:
    """Return the judge client, invocation model name, optional Anthropic client, and any setup error."""
    settings = _decrypted_settings(db)
    if not _setting_enabled(settings.get("judge_enabled"), default=True):
        return None, None, None, None

    judge_model = (settings.get("judge_model") or "").strip()
    if not judge_model:
        return None, None, None, None

    provider, invocation_model = _provider_for_model(judge_model)
    provider_key_map = {
        "openai": "openai_api_key",
        "anthropic": "anthropic_api_key",
        "gemini": "gemini_api_key",
        "groq": "groq_api_key",
        "grok": "grok_api_key",
    }
    provider_key = provider_key_map.get(provider or "")
    if provider_key and not (settings.get(provider_key) or "").strip():
        return None, invocation_model, None, None

    return get_model_client(db, judge_model)

def evaluate_with_llm(db: Session, metric_name: str, input_text: str, output_text: str, context_text: str = "") -> Tuple[float, str]:
    """
    Evaluates an output using an LLM-as-Judge.
    Returns (score_scaled_0_to_1, rationale).
    """
    client, model, anthropic_client, setup_error = get_judge_client(db)
    if setup_error:
        return 0.0, setup_error
    if (not client and not anthropic_client) or not model:
        return 0.0, "Judge model not configured in Settings."
        
    prompt_template = PROMPTS.get(metric_name.replace("llm_", ""), PROMPTS["coherence"])
    # Some prompts require {context}, passing an empty string if omitted safely avoids key errors.
    prompt = prompt_template.format(input=input_text, output=output_text, context=context_text)

    try:
        reply = ""
        if anthropic_client:
            response = anthropic_client.messages.create(
                model=model,
                max_tokens=150,
                temperature=0.0,
                system="You are a strict and objective evaluator.",
                messages=[
                    {"role": "user", "content": prompt}
                ]
            )
            reply = response.content[0].text.strip()
        else:
            response = _chat_completion_with_fallback(
                client,
                model=model,
                messages=[
                    {"role": "system", "content": "You are a strict and objective evaluator."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.0,
                max_output_tokens=150,
            )
            reply = response.choices[0].message.content.strip()
        
        # Parse the output
        # Format expected:
        # Justification: The text flows perfectly.
        # Score: 5
        lines = reply.split("\n")
        score = 0.0
        rationale = reply
        
        for line in reversed(lines):
            line = line.strip()
            if line.startswith("Score:"):
                try:
                    raw_score = int(line.replace("Score:", "").strip())
                    # Convert 1-5 scale to 0.0-1.0 scale
                    score = ((raw_score - 1) / 4.0)
                except ValueError:
                    pass
                break
            # Fallback if the model just returns a number at the end
            elif line.isdigit():
                 raw_score = int(line)
                 score = ((raw_score - 1) / 4.0)
                 break
                 
        return score, rationale
        
    except Exception as e:
        return 0.0, f"Judge API Error: {str(e)}"
