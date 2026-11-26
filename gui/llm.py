"""One-shot JSON requests to the configured model, outside a conversation.

Reuses the client built by `tutor.EnglishTutor` so the desktop app talks to
the model exactly the way the tutor does (same provider, URL and key).
"""

import json
import os

import tutor
from gui import config


def _client(settings: dict) -> tutor.EnglishTutor:
    os.environ["BASE_URL"] = settings["base_url"] or config.DEFAULTS["base_url"]
    os.environ["API_KEY"] = settings["api_key"] or ""
    return tutor.EnglishTutor(settings["api"], settings["model"], "", "")


def _parse(text: str) -> dict:
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[text.find("{") :]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON object in the model's answer")
    data = json.loads(text[start : end + 1])
    if not isinstance(data, dict):
        raise ValueError("the model's answer is not a JSON object")
    return data


def ask_json(system: str, user: str, validate=None, attempts: int = 2) -> dict:
    """Ask for a JSON object; `validate(data)` may raise ValueError to retry."""
    settings = config.load()
    llm = _client(settings)
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    last_error = None
    for _ in range(attempts):
        try:
            if settings["api"] == "mistral":
                response = llm.client.chat.complete(
                    model=llm.model,
                    messages=messages,
                    response_format={"type": "json_object"},
                )
            else:
                response = llm.client.chat.completions.create(
                    model=llm.model,
                    messages=messages,
                    response_format={"type": "json_object"},
                )
            data = _parse(response.choices[0].message.content)
            if validate is not None:
                validate(data)
            return data
        except (ValueError, KeyError, TypeError) as error:
            last_error = error
    raise RuntimeError(
        "Le modèle n'a pas réussi à préparer ce contenu "
        f"({last_error}). Réessaie, ou choisis un modèle plus grand dans les réglages."
    )
