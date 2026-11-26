"""Tests of the desktop app's lessons: content, scoring, path and review."""

import json
from pathlib import Path

import pytest

from gui import curriculum, lessons

CONTENT_DIR = Path(__file__).resolve().parent.parent / "gui" / "content"

VOCAB = {
    "words": [
        {
            "word": f"word{i}",
            "translation": f"mot{i}",
            "example": f"This is word{i} for you.",
            "example_translation": f"Voici le mot{i} pour toi.",
        }
        for i in range(6)
    ]
}


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("LANGUAGE_TUTOR_DATA", str(tmp_path))


def _content_files():
    return sorted(CONTENT_DIR.glob("*/*.json"))


@pytest.mark.parametrize(
    "path", _content_files(), ids=lambda p: f"{p.parent.name}/{p.stem}"
)
def test_bundled_content_file_is_complete_and_valid(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    expected_units = [unit["id"] for unit in curriculum.units(path.stem)]
    assert sorted(data) == sorted(expected_units)
    for unit_id, kinds in data.items():
        assert sorted(kinds) == sorted(curriculum.LESSON_KINDS), unit_id
        for kind, content in kinds.items():
            lessons.VALIDATORS[kind](content)
            assert lessons.bundled_content(path.parent.name, unit_id, kind) is not None


def test_bundled_pronunciation_focus_is_never_repeated_within_a_language():
    for folder in CONTENT_DIR.iterdir() if CONTENT_DIR.is_dir() else []:
        foci = []
        for path in folder.glob("*.json"):
            data = json.loads(path.read_text(encoding="utf-8"))
            foci += [kinds["pron"]["focus"] for kinds in data.values()]
        assert len(foci) == len(set(foci))


def test_normalize_with_punctuation_and_case_returns_plain_words():
    assert lessons.normalize("Hello, World! It's fine.") == [
        "hello",
        "world",
        "it's",
        "fine",
    ]


def test_compare_speech_with_exact_words_passes():
    heard = [("I", 0.9), ("went", 0.9), ("home.", 0.9)]
    result = lessons.compare_speech("I went home.", heard)
    assert result["passed"] is True
    assert [word["status"] for word in result["words"]] == ["ok", "ok", "ok"]


def test_compare_speech_with_wrong_word_marks_it_missed():
    heard = [("I", 0.9), ("go", 0.9), ("home", 0.9)]
    result = lessons.compare_speech("I went home.", heard)
    assert [word["status"] for word in result["words"]] == ["ok", "miss", "ok"]
    assert result["passed"] is False


def test_compare_speech_with_low_confidence_word_marks_it_weak():
    result = lessons.compare_speech("thin", [("thin", 0.2)])
    assert result["words"][0]["status"] == "weak"
    assert result["score"] == 0.5


def test_validate_grammar_with_wrong_answer_drops_the_question():
    content = {
        "rule": "Une règle.",
        "examples": [{"sentence": "I went.", "translation": "Je suis allé."}] * 2,
        "sentences": [{"sentence": "She went home early.", "translation": "…"}] * 2,
        "questions": [
            {
                "sentence": "I ___ home.",
                "options": ["go", "went", "gone"],
                "answer": "went",
                "why": "",
            },
            {
                "sentence": "I ______ out.",
                "options": ["go", "went", "gone"],
                "answer": "went",
                "why": "",
            },
            {
                "sentence": "We ___ it.",
                "options": ["do", "did", "done"],
                "answer": "did",
                "why": "",
            },
            {"sentence": "No blank.", "options": ["a", "b"], "answer": "a", "why": ""},
            {"sentence": "He ___ it.", "options": ["a", "b"], "answer": "c", "why": ""},
        ],
    }
    lessons.validate_grammar(content)
    assert len(content["questions"]) == 3
    assert content["questions"][1]["sentence"] == "I ___ out."


def test_validate_vocab_with_too_few_words_raises():
    with pytest.raises(ValueError):
        lessons.validate_vocab({"words": VOCAB["words"][:2]})


def test_path_state_without_level_returns_none():
    assert lessons.path_state("en") is None


def test_finish_lesson_records_stars_and_queues_missed_exercises(monkeypatch):
    lessons.set_level("en", "A1")
    monkeypatch.setattr(
        lessons, "bundled_content", lambda *args: json.loads(json.dumps(VOCAB))
    )
    lesson = lessons.get_lesson("en", "vocab", "A1-1")
    scorable = [item for item in lesson["items"] if item["kind"] != "info"]
    results = [
        {"index": item["index"], "correct": True, "tries": 1} for item in scorable
    ]
    results[0] = {"index": scorable[0]["index"], "correct": False, "tries": 3}

    outcome = lessons.finish(lesson["id"], results)

    assert outcome["total"] == len(scorable)
    assert outcome["correct"] == len(scorable) - 1
    assert outcome["stars"] >= 2
    path = outcome["path"]
    assert path["units"][0]["lessons"]["vocab"] == outcome["stars"]
    assert path["recommended"] == {
        "kind": "grammar",
        "unit_id": "A1-1",
        "label": "Grammaire · Se présenter",
    }
    assert path["review_due"] == 0  # the missed exercise is due tomorrow


def test_finish_lesson_twice_raises():
    lessons.set_level("en", "A1")
    lesson = lessons._register(
        {"kind": "review", "unit_id": None, "language": "en", "items": []}
    )
    lessons.finish(lesson["id"], [])
    with pytest.raises(RuntimeError):
        lessons.finish(lesson["id"], [])
