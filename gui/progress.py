"""Game layer of the desktop app: XP, levels, day streak, chest and challenges.

Everything here is derived from what the learner does in the app and stored
in one JSON file; the tutor itself (tutor.py) is not involved.
"""

import datetime
import json
import re
import threading
import uuid
from pathlib import Path

from gui import paths

XP_PER_REPLY = 10
XP_PER_FEEDBACK = 50
XP_PER_CHALLENGE = 50
XP_PER_CHEST = 100
CHEST_EVERY = 5
MAX_CHALLENGES = 3

_lock = threading.RLock()


def _file() -> Path:
    return paths.data_dir() / "progress.json"


def _empty() -> dict:
    return {"xp": 0, "days": [], "sessions": {}, "challenges": {}}


def load() -> dict:
    try:
        data = json.loads(_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return _empty()
    base = _empty()
    if isinstance(data, dict):
        base.update({key: data[key] for key in base if key in data})
    return base


def _save(data: dict) -> None:
    tmp = _file().with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(_file())


# --- Levels -----------------------------------------------------------------


def xp_for_level(level: int) -> int:
    """Total XP needed to reach `level` (level 1 starts at 0 XP)."""
    return 25 * (level - 1) * level


def level_for_xp(xp: int) -> int:
    level = 1
    while xp >= xp_for_level(level + 1):
        level += 1
    return level


# --- Streak -----------------------------------------------------------------


def streak(days: list[str], today: datetime.date | None = None) -> int:
    """Consecutive active days ending today (or yesterday, still alive)."""
    today = today or datetime.date.today()
    active = set(days)
    cursor = today
    if cursor.isoformat() not in active:
        cursor -= datetime.timedelta(days=1)
    count = 0
    while cursor.isoformat() in active:
        count += 1
        cursor -= datetime.timedelta(days=1)
    return count


# --- Challenges -------------------------------------------------------------

_HEADING = re.compile(r"^\s*(?:#{1,6}\s+|\*\*|\d+[.)]\s+)?(.+?)\**\s*:?\s*$")
_ITEM = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+(.+)$")


def _is_heading(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if stripped.startswith("#"):
        return True
    if re.fullmatch(r"\*\*[^*]+\*\*:?", stripped):
        return True
    # "6. Priority for improvement": a numbered line that is short and has no
    # sentence punctuation is a section title, not a list item.
    return (
        bool(re.fullmatch(r"\d+[.)]\s+[^.!?]{3,60}:?", stripped))
        and stripped.count(" ") <= 7
    )


def extract_challenges(feedback: str) -> list[str]:
    """Pull the "priority for improvement" items out of the feedback markdown.

    The feedback is free text written by the model in the practiced language,
    so this looks for the priorities section by keyword and falls back on the
    last list of the document.
    """
    lines = feedback.splitlines()
    sections: list[tuple[str, list[str]]] = [("", [])]
    for line in lines:
        if _is_heading(line):
            match = _HEADING.match(line)
            sections.append((match.group(1) if match else line, []))
        else:
            sections[-1][1].append(line)

    def items(body: list[str]) -> list[str]:
        found = []
        for line in body:
            match = _ITEM.match(line)
            if match:
                text = re.sub(r"\*\*|__", "", match.group(1)).strip()
                if text:
                    found.append(text)
        return found

    for title, body in reversed(sections):
        if re.search(r"priori|focus|schwerpunkt", title, re.IGNORECASE):
            found = items(body)
            if found:
                return found[:MAX_CHALLENGES]
    for _title, body in reversed(sections):
        found = items(body)
        if found:
            return found[:MAX_CHALLENGES]
    return []


# --- Public API ---------------------------------------------------------------


def snapshot(language: str) -> dict:
    """Progress as shown by the interface for one practiced language."""
    with _lock:
        data = load()
    xp = data["xp"]
    level = level_for_xp(xp)
    done = int(data["sessions"].get(language, 0))
    total_done = sum(int(v) for v in data["sessions"].values())
    return {
        "xp": xp,
        "level": level,
        "level_floor_xp": xp_for_level(level),
        "level_next_xp": xp_for_level(level + 1),
        "streak": streak(data["days"]),
        "sessions_done": done,
        "chest_count": total_done % CHEST_EVERY,
        "chest_every": CHEST_EVERY,
    }


def challenges(language: str) -> list[dict]:
    with _lock:
        return list(load()["challenges"].get(language, []))


def _mark_today(data: dict) -> None:
    today = datetime.date.today().isoformat()
    if today not in data["days"]:
        data["days"].append(today)
        data["days"] = data["days"][-400:]


def add_reply() -> int:
    with _lock:
        data = load()
        data["xp"] += XP_PER_REPLY
        _mark_today(data)
        _save(data)
    return XP_PER_REPLY


def complete_session(language: str, with_feedback: bool) -> dict:
    """Count a finished session; returns the rewards it produced."""
    with _lock:
        data = load()
        level_before = level_for_xp(data["xp"])
        gained = XP_PER_FEEDBACK if with_feedback else 0
        data["sessions"][language] = int(data["sessions"].get(language, 0)) + 1
        total_done = sum(int(v) for v in data["sessions"].values())
        chest_opened = total_done % CHEST_EVERY == 0
        if chest_opened:
            gained += XP_PER_CHEST
        data["xp"] += gained
        _mark_today(data)
        _save(data)
        level = level_for_xp(data["xp"])
        return {
            "xp_gained": gained,
            "streak": streak(data["days"]),
            "level": level,
            "leveled_up": level > level_before,
            "chest_opened": chest_opened,
            # A chest that was just opened is shown full, not back at zero.
            "chest_count": CHEST_EVERY if chest_opened else total_done % CHEST_EVERY,
        }


def add_feedback_bonus() -> int:
    """XP for a feedback asked after the session was already counted."""
    with _lock:
        data = load()
        data["xp"] += XP_PER_FEEDBACK
        _save(data)
    return XP_PER_FEEDBACK


def set_challenges(language: str, texts: list[str]) -> list[dict]:
    with _lock:
        data = load()
        data["challenges"][language] = [
            {"id": uuid.uuid4().hex[:8], "text": text, "done": False} for text in texts
        ]
        _save(data)
        return list(data["challenges"][language])


def toggle_challenge(language: str, challenge_id: str) -> tuple[list[dict], int]:
    """Check or uncheck a challenge; XP is granted or taken back accordingly."""
    with _lock:
        data = load()
        gained = 0
        for challenge in data["challenges"].get(language, []):
            if challenge["id"] == challenge_id:
                challenge["done"] = not challenge["done"]
                gained = XP_PER_CHALLENGE if challenge["done"] else -XP_PER_CHALLENGE
                data["xp"] = max(0, data["xp"] + gained)
        _save(data)
        return list(data["challenges"].get(language, [])), gained


def add_xp(amount: int) -> int:
    """Grant XP earned outside a conversation (lessons) and mark the day active."""
    with _lock:
        data = load()
        data["xp"] += int(amount)
        _mark_today(data)
        _save(data)
    return int(amount)
