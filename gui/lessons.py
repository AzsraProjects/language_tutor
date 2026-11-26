"""Lessons of the desktop app: vocabulary, grammar, pronunciation and review.

The model only writes the *content* of a lesson (words, a rule, sentences) as
a small JSON object that is validated here; the exercises themselves are
assembled by code, so a lesson always has a sound structure whatever the
model. Results feed the learning path, the review queue and the XP.
"""

import datetime
import difflib
import json
import random
import re
import threading
import unicodedata
import uuid
from pathlib import Path

import tutor
from gui import curriculum, llm, paths, progress, tts

NATIVE = "French"
XP_PER_EXERCISE = 5
XP_LESSON_BONUS = 20
XP_PERFECT_BONUS = 10
REVIEW_BATCH = 8
REVIEW_SUGGEST_AT = 6

_lock = threading.RLock()
_active: dict[str, dict] = {}


# --- Storage ------------------------------------------------------------------


def _file() -> Path:
    return paths.data_dir() / "learning.json"


def _load() -> dict:
    base = {"levels": {}, "lessons": {}, "reviews": {}, "pron_foci": {}}
    try:
        data = json.loads(_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return base
    if isinstance(data, dict):
        base.update({key: data[key] for key in base if key in data})
    return base


def _save(data: dict) -> None:
    tmp = _file().with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(_file())


def _cache_file(language: str, unit_id: str, kind: str) -> Path:
    folder = paths.data_dir() / "lessons" / language
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{unit_id}_{kind}.json"


# --- Level ----------------------------------------------------------------------


def level(language: str) -> str | None:
    with _lock:
        return _load()["levels"].get(language)


def set_level(language: str, code: str) -> None:
    if code not in curriculum.LEVEL_CODES:
        raise ValueError(f"Niveau inconnu : {code}")
    with _lock:
        data = _load()
        data["levels"][language] = code
        _save(data)


def starter_questions(language: str) -> list[dict]:
    return [
        {"id": index, "text": text, "translation": translation}
        for index, (text, translation) in enumerate(
            curriculum.STARTER_QUESTIONS[language]
        )
    ]


def assess_level(language: str, answers: list[dict]) -> dict:
    """Estimate the starting level from the spoken answers to the starter questions."""
    questions = curriculum.STARTER_QUESTIONS[language]
    spoken = []
    for answer in answers:
        index = int(answer.get("id", -1))
        text = (answer.get("transcript") or "").strip()
        if 0 <= index < len(questions):
            spoken.append((questions[index][0], text))

    if not any(text for _question, text in spoken):
        return {"level": "A1", "reason": "On part des bases, tranquillement."}

    language_name = tutor.LANGUAGE_MAP[language]
    transcript = "\n".join(
        f"Question: {question}\nAnswer: {text or '(no answer - the learner skipped it)'}"
        for question, text in spoken
    )
    system = (
        f"You are an experienced {language_name} teacher placing a new learner. "
        "You receive the learner's spoken answers (transcribed by speech recognition, "
        "so ignore punctuation and small transcription glitches) to three questions of "
        "increasing difficulty. Estimate the CEFR level the learner should START at. "
        "When in doubt choose the lower level. A learner who skipped or could not "
        "answer the harder questions is A1 or A2. "
        'Answer with a JSON object: {"level": "A1" | "A2" | "B1" | "B2", '
        '"reason": "one short encouraging sentence in French, addressed to the learner '
        'with tu, saying what they already do well"}'
    )

    def validate(data):
        if data.get("level") not in curriculum.LEVEL_CODES:
            raise ValueError("level missing")
        if not isinstance(data.get("reason"), str):
            raise ValueError("reason missing")

    data = llm.ask_json(system, transcript, validate)
    return {"level": data["level"], "reason": data["reason"].strip()}


# --- Text helpers -----------------------------------------------------------------


def normalize(text: str) -> list[str]:
    """Lower-case words without punctuation, for comparing speech to a target."""
    text = unicodedata.normalize("NFKC", text).lower().replace("’", "'")
    text = re.sub(r"[^\w\s']", " ", text, flags=re.UNICODE)
    return [word.strip("'") for word in text.split() if word.strip("'")]


def compare_speech(target: str, heard: list[tuple[str, float]]) -> dict:
    """Word-by-word comparison of what was heard with the target sentence.

    `heard` holds (word, confidence) pairs from the speech recogniser. A word
    is "ok" when recognised with confidence, "weak" when recognised with low
    confidence (understood, but not clearly) and "miss" when not recognised.
    """
    shown = target.split()
    wanted = [(" ".join(normalize(word)) or word.lower()) for word in shown]
    heard_norm = []
    for word, confidence in heard:
        for part in normalize(word):
            heard_norm.append((part, confidence))
    got = [word for word, _ in heard_norm]

    statuses = ["miss"] * len(wanted)
    matcher = difflib.SequenceMatcher(a=wanted, b=got, autojunk=False)
    for block in matcher.get_matching_blocks():
        for offset in range(block.size):
            confidence = heard_norm[block.b + offset][1]
            statuses[block.a + offset] = "ok" if confidence >= 0.4 else "weak"

    points = sum(1.0 if s == "ok" else 0.5 if s == "weak" else 0.0 for s in statuses)
    score = points / len(wanted) if wanted else 0.0
    return {
        "heard": " ".join(word for word, _ in heard),
        "words": [
            {"word": word, "status": status} for word, status in zip(shown, statuses)
        ],
        "score": round(score, 2),
        "passed": score >= 0.8,
    }


def _text(value, limit: int = 400) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("missing text")
    return value.strip()[:limit]


def _pairs(items, keys: tuple[str, ...], minimum: int, maximum: int) -> list[dict]:
    if not isinstance(items, list):
        raise ValueError("list expected")
    clean = []
    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            clean.append({key: _text(item.get(key)) for key in keys})
        except ValueError:
            continue
    if len(clean) < minimum:
        raise ValueError(f"need at least {minimum} complete items")
    return clean[:maximum]


# --- Content generation --------------------------------------------------------------


def _system(language_name: str, level_code: str) -> str:
    return (
        f"You write lesson content for a {NATIVE}-speaking learner of {language_name} "
        f"at CEFR level {level_code}. Everything in {language_name} must be correct, "
        f"natural and suited to level {level_code}. Explanations and translations are "
        f"written in {NATIVE}, addressing the learner with 'tu'. "
        "Answer with one JSON object only, exactly in the requested shape."
    )


def validate_vocab(data: dict) -> None:
    data["words"] = _pairs(
        data.get("words"),
        ("word", "translation", "example", "example_translation"),
        4,
        6,
    )
    if len({w["word"].lower() for w in data["words"]}) < len(data["words"]):
        raise ValueError("duplicate words")


def _vocab_content(language_name: str, level_code: str, unit: dict) -> dict:
    user = (
        f"Theme: {unit['vocab']}.\n"
        'Shape: {"words": [{"word": "...", "translation": "...", "example": "...", '
        '"example_translation": "..."}]}\n'
        f"Give exactly 6 useful {language_name} words or short expressions on this theme "
        f"(with their article when the language uses one), each with its {NATIVE} "
        f"translation, one short example sentence in {language_name} (4 to 9 words) "
        f"using the word, and the {NATIVE} translation of that sentence."
    )
    return llm.ask_json(_system(language_name, level_code), user, validate_vocab)


def validate_grammar(data: dict) -> None:
    data["rule"] = _text(data.get("rule"), 900)
    data["examples"] = _pairs(data.get("examples"), ("sentence", "translation"), 2, 3)
    data["sentences"] = _pairs(data.get("sentences"), ("sentence", "translation"), 2, 3)
    questions = []
    for item in data.get("questions") or []:
        if not isinstance(item, dict):
            continue
        options = item.get("options")
        if not isinstance(options, list):
            continue
        options = [str(o).strip() for o in options if str(o).strip()]
        answer = str(item.get("answer", "")).strip()
        sentence = re.sub(r"_{3,}", "___", str(item.get("sentence", "")).strip())
        if sentence.count("___") != 1 or answer not in options:
            continue
        if len(set(options)) < 2 or len(set(options)) != len(options):
            continue
        questions.append(
            {
                "sentence": sentence[:300],
                "options": options[:4],
                "answer": answer,
                "why": str(item.get("why", "")).strip()[:300],
            }
        )
    if len(questions) < 3:
        raise ValueError("need at least 3 valid questions")
    data["questions"] = questions[:5]


def _grammar_content(language_name: str, level_code: str, unit: dict) -> dict:
    user = (
        f"Grammar goal: {unit['grammar']}.\n"
        'Shape: {"rule": "...", "examples": [{"sentence": "...", "translation": "..."}], '
        '"questions": [{"sentence": "... ___ ...", "options": ["...", "...", "..."], '
        '"answer": "...", "why": "..."}], '
        '"sentences": [{"sentence": "...", "translation": "..."}]}\n'
        f"- rule: a clear explanation in {NATIVE} (3 to 5 short sentences) of how this "
        f"works in {language_name}.\n"
        f"- examples: 3 {language_name} sentences showing the rule, with translations.\n"
        f"- questions: 5 {language_name} sentences with exactly one blank written ___ ; "
        "3 options of which exactly one is correct; answer = the correct option, copied "
        f"exactly; why = one sentence in {NATIVE} explaining the answer.\n"
        f"- sentences: 3 other short {language_name} sentences (4 to 9 words) using the "
        "rule, with translations."
    )
    return llm.ask_json(_system(language_name, level_code), user, validate_grammar)


def validate_pron(data: dict) -> None:
    data["focus"] = _text(data.get("focus"), 80)
    data["advice"] = _text(data.get("advice"), 600)
    data["words"] = _pairs(data.get("words"), ("word", "translation"), 4, 6)
    data["sentences"] = _pairs(data.get("sentences"), ("sentence", "translation"), 1, 2)
    try:
        pairs = _pairs(data.get("pairs"), ("a", "b"), 1, 3)
    except ValueError:
        pairs = []
    data["pairs"] = [p for p in pairs if p["a"].lower() != p["b"].lower()]


def _pron_content(language_name: str, level_code: str, covered: list[str]) -> dict:
    avoid = (
        f" Do not choose any of these, already studied: {', '.join(covered)}."
        if covered
        else ""
    )
    user = (
        f"Choose ONE sound or pronunciation difficulty of {language_name} that {NATIVE} "
        f"speakers typically get wrong.{avoid}\n"
        'Shape: {"focus": "...", "advice": "...", "words": [{"word": "...", '
        '"translation": "..."}], "pairs": [{"a": "...", "b": "..."}], '
        '"sentences": [{"sentence": "...", "translation": "..."}]}\n'
        f"- focus: a short name of the difficulty, in {NATIVE} (for example: le son « th »).\n"
        f"- advice: 2 or 3 sentences in {NATIVE} on how to place the mouth and tongue, "
        f"and the typical {NATIVE}-speaker mistake to avoid.\n"
        f"- words: 6 common {language_name} words containing the sound, with translations.\n"
        f"- pairs: 3 pairs of real {language_name} words that differ only by this sound "
        "(minimal pairs), a containing the sound.\n"
        f"- sentences: 2 short {language_name} sentences (4 to 8 words) rich in this sound."
    )
    return llm.ask_json(_system(language_name, level_code), user, validate_pron)


# --- Exercises ------------------------------------------------------------------------


def _shuffled(items: list) -> list:
    items = list(items)
    random.shuffle(items)
    return items


def _choice(
    prompt: str, options: list[str], correct: str, sentence="", explanation=""
) -> dict:
    options = _shuffled(options)
    return {
        "kind": "choice",
        "prompt": prompt,
        "sentence": sentence,
        "options": options,
        "answer": options.index(correct),
        "explanation": explanation,
    }


def _listen(options: list[str], correct: str) -> dict:
    options = _shuffled(options)
    return {
        "kind": "listen",
        "prompt": "Écoute et choisis ce que tu entends.",
        "audio_text": correct,
        "options": options,
        "answer": options.index(correct),
    }


def _order(sentence: str, translation: str) -> dict | None:
    tokens = sentence.split()
    if not 3 <= len(tokens) <= 10:
        return None
    mixed = _shuffled(tokens)
    if mixed == tokens:
        mixed = tokens[1:] + tokens[:1]
    return {
        "kind": "order",
        "prompt": "Remets les mots dans l'ordre.",
        "translation": translation,
        "sentence": sentence,
        "tokens": mixed,
    }


def _speak(text: str, translation: str) -> dict:
    return {
        "kind": "speak",
        "prompt": "Écoute, puis répète à voix haute.",
        "text": text,
        "translation": translation,
    }


def _vocab_exercises(content: dict) -> tuple[str, list[dict]]:
    words = content["words"]
    items: list[dict] = [
        {
            "kind": "info",
            "title": "Les mots du jour",
            "text": "Écoute chaque mot, puis on s'entraîne.",
            "examples": [
                {"text": w["word"], "translation": w["translation"]} for w in words
            ],
        }
    ]
    translations = [w["translation"] for w in words]
    spellings = [w["word"] for w in words]
    for word in _shuffled(words)[:4]:
        others = _shuffled([t for t in translations if t != word["translation"]])[:2]
        items.append(
            _choice(
                "Que veut dire ce mot ?",
                [word["translation"], *others],
                word["translation"],
                sentence=word["word"],
            )
        )
    for word in _shuffled(words)[:2]:
        others = _shuffled([s for s in spellings if s != word["word"]])[:2]
        items.append(_listen([word["word"], *others], word["word"]))
    for word in _shuffled(words)[:3]:
        exercise = _order(word["example"], word["example_translation"])
        if exercise:
            items.append(exercise)
    for word in _shuffled(words)[:3]:
        items.append(_speak(word["word"], word["translation"]))
    for word in _shuffled(words)[:2]:
        items.append(_speak(word["example"], word["example_translation"]))
    return "Vocabulaire", items


def _grammar_exercises(content: dict) -> tuple[str, list[dict]]:
    items: list[dict] = [
        {
            "kind": "info",
            "title": "La règle",
            "text": content["rule"],
            "examples": [
                {"text": e["sentence"], "translation": e["translation"]}
                for e in content["examples"]
            ],
        }
    ]
    for question in content["questions"]:
        items.append(
            _choice(
                "Complète la phrase.",
                question["options"],
                question["answer"],
                sentence=question["sentence"],
                explanation=question["why"],
            )
        )
    for sentence in content["sentences"]:
        exercise = _order(sentence["sentence"], sentence["translation"])
        if exercise:
            items.append(exercise)
    for sentence in content["sentences"][:2]:
        items.append(_speak(sentence["sentence"], sentence["translation"]))
    return "Grammaire", items


def _pron_exercises(content: dict) -> tuple[str, list[dict]]:
    items: list[dict] = [
        {
            "kind": "info",
            "title": content["focus"],
            "text": content["advice"],
            "examples": [
                {"text": w["word"], "translation": w["translation"]}
                for w in content["words"][:3]
            ],
        }
    ]
    for pair in content["pairs"]:
        correct = random.choice([pair["a"], pair["b"]])
        items.append(_listen([pair["a"], pair["b"]], correct))
    for word in content["words"]:
        items.append(_speak(word["word"], word["translation"]))
    for sentence in content["sentences"]:
        items.append(_speak(sentence["sentence"], sentence["translation"]))
    return "Prononciation", items


# --- Lessons ----------------------------------------------------------------------------


def _register(lesson: dict) -> dict:
    for index, item in enumerate(lesson["items"]):
        item["index"] = index
    lesson["id"] = uuid.uuid4().hex[:12]
    with _lock:
        _active.clear()  # one lesson at a time
        _active[lesson["id"]] = lesson
    return lesson


VALIDATORS = {
    "vocab": validate_vocab,
    "grammar": validate_grammar,
    "pron": validate_pron,
}


def bundled_content(language: str, unit_id: str, kind: str) -> dict | None:
    """Lesson content written and reviewed ahead of time, shipped with the app.

    One file per language and level: gui/content/<language>/<level>.json,
    shaped {unit_id: {"vocab": {...}, "grammar": {...}, "pron": {...}}}.
    Languages or units without such content fall back on the model.
    """
    level_code = unit_id.split("-")[0]
    path = paths.resource_root() / "gui" / "content" / language / f"{level_code}.json"
    try:
        content = json.loads(path.read_text(encoding="utf-8"))[unit_id][kind]
        VALIDATORS[kind](content)
    except (OSError, ValueError, KeyError, TypeError):
        return None
    return content


def get_lesson(
    language: str, kind: str, unit_id: str, regenerate: bool = False
) -> dict:
    """Build a lesson for a unit; its content is cached so a replay is instant."""
    if kind not in curriculum.LESSON_KINDS:
        raise ValueError(f"Type de leçon inconnu : {kind}")
    unit = curriculum.unit(unit_id)
    language_name = tutor.LANGUAGE_MAP[language]
    cache = _cache_file(language, unit_id, kind)

    content = bundled_content(language, unit_id, kind)
    source = "bundled" if content is not None else "generated"
    if content is None and not regenerate and cache.is_file():
        try:
            content = json.loads(cache.read_text(encoding="utf-8"))
        except ValueError:
            content = None

    if content is None:
        if kind == "vocab":
            content = _vocab_content(language_name, unit["level"], unit)
        elif kind == "grammar":
            content = _grammar_content(language_name, unit["level"], unit)
        else:
            with _lock:
                covered = list(_load()["pron_foci"].get(language, []))
            content = _pron_content(language_name, unit["level"], covered)
            with _lock:
                data = _load()
                foci = data["pron_foci"].setdefault(language, [])
                if content["focus"] not in foci:
                    foci.append(content["focus"])
                _save(data)
        cache.write_text(
            json.dumps(content, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    builder = {
        "vocab": _vocab_exercises,
        "grammar": _grammar_exercises,
        "pron": _pron_exercises,
    }
    label, items = builder[kind](content)
    if not tts.available(language):
        # Without a voice there is nothing to listen to: drop listening
        # exercises and ask the learner to read aloud instead of repeating.
        items = [item for item in items if item["kind"] != "listen"]
        for item in items:
            if item["kind"] == "speak":
                item["prompt"] = "Lis à voix haute."
    subtitle = content.get("focus") if kind == "pron" else unit["title"]
    return _register(
        {
            "kind": kind,
            "unit_id": unit_id,
            "language": language,
            "source": source,
            "title": f"{label} · {subtitle}",
            "items": items,
        }
    )


def review_lesson(language: str) -> dict:
    """A lesson made of the exercises the learner got wrong, due for review."""
    today = datetime.date.today().isoformat()
    with _lock:
        queue = _load()["reviews"].get(language, [])
    due = [entry for entry in queue if entry["due"] <= today][:REVIEW_BATCH]
    if not due:
        raise RuntimeError("Rien à réviser pour l'instant.")
    items = []
    for entry in due:
        item = dict(entry["exercise"])
        item["review_key"] = entry["key"]
        if item["kind"] == "order":
            item["tokens"] = _shuffled(item["sentence"].split())
        items.append(item)
    return _register(
        {
            "kind": "review",
            "unit_id": None,
            "language": language,
            "title": "Révision · tes points à consolider",
            "items": items,
        }
    )


def _review_key(item: dict) -> str:
    core = item.get("text") or item.get("sentence") or item.get("audio_text") or ""
    return f"{item['kind']}:{core}:{item.get('prompt', '')}"[:200]


def finish(lesson_id: str, results: list[dict]) -> dict:
    """Score a finished lesson: stars, XP, path progress and review queue."""
    with _lock:
        lesson = _active.pop(lesson_id, None)
    if lesson is None:
        raise RuntimeError("Cette leçon n'est plus en cours.")

    by_index = {int(r.get("index", -1)): r for r in results or []}
    scorable = [item for item in lesson["items"] if item["kind"] != "info"]
    first_try = 0
    solved = 0
    missed = []
    for item in scorable:
        result = by_index.get(item["index"], {})
        correct = bool(result.get("correct"))
        tries = int(result.get("tries", 1) or 1)
        if correct:
            solved += 1
        if correct and tries <= 1:
            first_try += 1
        else:
            missed.append(item)

    ratio = first_try / len(scorable) if scorable else 1.0
    stars = 3 if ratio >= 0.9 else 2 if ratio >= 0.7 else 1
    gained = (
        solved * XP_PER_EXERCISE
        + XP_LESSON_BONUS
        + (XP_PERFECT_BONUS if stars == 3 else 0)
    )

    language = lesson["language"]
    today = datetime.date.today()
    with _lock:
        data = _load()
        queue = data["reviews"].setdefault(language, [])
        by_key = {entry["key"]: entry for entry in queue}

        # Exercises answered right during a review move further away, then leave.
        for item in scorable:
            key = item.get("review_key")
            if key and key in by_key and item not in missed:
                entry = by_key[key]
                entry["streak"] += 1
                entry["due"] = (
                    today + datetime.timedelta(days=2 ** entry["streak"])
                ).isoformat()
        queue[:] = [entry for entry in queue if entry["streak"] < 3]

        by_key = {entry["key"]: entry for entry in queue}
        for item in missed:
            key = item.get("review_key") or _review_key(item)
            exercise = {
                k: v for k, v in item.items() if k not in ("index", "review_key")
            }
            entry = by_key.get(key)
            if entry is None:
                queue.append({"key": key, "exercise": exercise, "streak": 0, "due": ""})
                entry = queue[-1]
            entry["streak"] = 0
            entry["due"] = (today + datetime.timedelta(days=1)).isoformat()
        del queue[:-60]

        if lesson["unit_id"]:
            unit_lessons = (
                data["lessons"]
                .setdefault(language, {})
                .setdefault(lesson["unit_id"], {})
            )
            previous = unit_lessons.get(lesson["kind"], {"stars": 0, "count": 0})
            unit_lessons[lesson["kind"]] = {
                "stars": max(previous["stars"], stars),
                "count": previous["count"] + 1,
            }
        _save(data)

    level_before = progress.snapshot(language)["level"]
    progress.add_xp(gained)
    snapshot = progress.snapshot(language)
    return {
        "stars": stars,
        "xp_gained": gained,
        "correct": first_try,
        "total": len(scorable),
        "leveled_up": snapshot["level"] > level_before,
        "progress": snapshot,
        "path": path_state(language),
    }


# --- Learning path ----------------------------------------------------------------------


def path_state(language: str) -> dict | None:
    """Units of the learner's level with their results, and what to do next."""
    with _lock:
        data = _load()
    code = data["levels"].get(language)
    if code is None:
        return None

    done_lessons = data["lessons"].get(language, {})
    today = datetime.date.today().isoformat()
    review_due = sum(
        1 for entry in data["reviews"].get(language, []) if entry["due"] <= today
    )

    units = []
    current = None
    for unit in curriculum.units(code):
        results = done_lessons.get(unit["id"], {})
        lessons = {
            kind: results.get(kind, {}).get("stars", 0)
            for kind in curriculum.LESSON_KINDS
        }
        complete = all(lessons.values())
        entry = {
            "id": unit["id"],
            "number": unit["number"],
            "title": unit["title"],
            "lessons": lessons,
            "done": complete,
            "current": False,
            "locked": current is not None,
        }
        if not complete and current is None:
            current = entry
            entry["current"] = True
        units.append(entry)

    labels = {"vocab": "Vocabulaire", "grammar": "Grammaire", "pron": "Prononciation"}
    if review_due >= REVIEW_SUGGEST_AT:
        recommended = {"kind": "review", "unit_id": None, "label": "Révision"}
    elif current is not None:
        kind = next(k for k in curriculum.LESSON_KINDS if not current["lessons"][k])
        recommended = {
            "kind": kind,
            "unit_id": current["id"],
            "label": f"{labels[kind]} · {current['title']}",
        }
    else:
        recommended = {
            "kind": "conversation",
            "unit_id": None,
            "label": "Conversation libre",
        }

    position = curriculum.LEVEL_CODES.index(code)
    return {
        "level": code,
        "level_name": curriculum.LEVELS[position]["name"],
        "units": units,
        "recommended": recommended,
        "review_due": review_due,
        "level_complete": current is None,
        "next_level": curriculum.LEVEL_CODES[position + 1]
        if current is None and position + 1 < len(curriculum.LEVEL_CODES)
        else None,
    }
