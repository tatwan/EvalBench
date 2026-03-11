import os
from openai import OpenAI
from typing import Tuple, Optional
from sqlalchemy.orm import Session
import anthropic
from backend.models import Setting

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
Score: <int>"""
}

def get_judge_client(db: Session) -> Tuple[Optional[OpenAI], Optional[str], Optional[anthropic.Anthropic]]:
    """Returns the OpenAI client (or Anthropic client) and the selected judge model name based on DB settings."""
    settings = {s.key: s.value for s in db.query(Setting).all()}
    
    judge_model = settings.get("judge_model")
    if not judge_model:
        return None, None, None
        
    # Default to Local Ollama OpenAI-compatible endpoint
    base_url = settings.get("ollama_host", "http://localhost:11434") + "/v1"
    api_key = settings.get("openai_api_key", "ollama")
    client_type = "openai"
    
    if judge_model.startswith("gpt-"):
        base_url = "https://api.openai.com/v1"
        api_key = settings.get("openai_api_key", "")
    elif judge_model.startswith("gemini-"):
        base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
        api_key = settings.get("gemini_api_key", "")
    elif judge_model.startswith("grok-"):
        base_url = "https://api.x.ai/v1"
        api_key = settings.get("grok_api_key", "")
    elif judge_model.startswith("claude-"):
        api_key = settings.get("anthropic_api_key", "")
        anthropic_client = anthropic.Anthropic(api_key=api_key)
        return None, judge_model, anthropic_client
        
    client = OpenAI(base_url=base_url, api_key=api_key)
    return client, judge_model, None

def evaluate_with_llm(db: Session, metric_name: str, input_text: str, output_text: str) -> Tuple[float, str]:
    """
    Evaluates an output using an LLM-as-Judge.
    Returns (score_scaled_0_to_1, rationale).
    """
    client, model, anthropic_client = get_judge_client(db)
    if (not client and not anthropic_client) or not model:
        return 0.0, "Judge model not configured in Settings."
        
    prompt_template = PROMPTS.get(metric_name.replace("llm_", ""), PROMPTS["coherence"])
    prompt = prompt_template.format(input=input_text, output=output_text)

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
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": "You are a strict and objective evaluator."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.0,
                max_tokens=150,
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
