"""Tests of the desktop app's game layer (gui/progress.py) and updater helpers."""

import datetime

import pytest

from gui import progress, updater


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("LANGUAGE_TUTOR_DATA", str(tmp_path))


def test_level_for_xp_at_thresholds_returns_expected_levels():
    assert progress.level_for_xp(0) == 1
    assert progress.level_for_xp(49) == 1
    assert progress.level_for_xp(50) == 2
    assert progress.level_for_xp(progress.xp_for_level(10)) == 10
    assert progress.level_for_xp(progress.xp_for_level(10) - 1) == 9


def test_streak_with_consecutive_days_counts_them():
    today = datetime.date(2026, 11, 26)
    days = ["2026-11-24", "2026-11-25", "2026-11-26"]
    assert progress.streak(days, today) == 3


def test_streak_without_session_today_still_counts_until_yesterday():
    today = datetime.date(2026, 11, 26)
    assert progress.streak(["2026-11-24", "2026-11-25"], today) == 2


def test_streak_after_a_missed_day_restarts_at_zero():
    today = datetime.date(2026, 11, 26)
    assert progress.streak(["2026-11-22", "2026-11-23"], today) == 0


def test_extract_challenges_with_markdown_heading_returns_priority_items():
    feedback = (
        "## Overall assessment\nGood.\n\n"
        "## Vocabulary\n- plot\n- ending\n\n"
        "## Priority for improvement\n"
        "1. Keep your story in the **past tense**.\n"
        "2. Use “the ending” for films.\n"
    )
    assert progress.extract_challenges(feedback) == [
        "Keep your story in the past tense.",
        "Use “the ending” for films.",
    ]


def test_extract_challenges_with_numbered_section_titles_returns_priority_items():
    feedback = (
        "1. Overall assessment\nGood work.\n\n"
        "5. Vocabulary\n- plot\n\n"
        "6. Priorités d'amélioration\n"
        "- Raconter au passé.\n- Poser deux questions.\n"
    )
    assert progress.extract_challenges(feedback) == [
        "Raconter au passé.",
        "Poser deux questions.",
    ]


def test_extract_challenges_without_priority_section_falls_back_on_last_list():
    feedback = "Nice session.\n\n- First tip.\n- Second tip.\n"
    assert progress.extract_challenges(feedback) == ["First tip.", "Second tip."]


def test_extract_challenges_without_any_list_returns_nothing():
    assert progress.extract_challenges("Well done, keep going.") == []


def test_add_reply_grants_xp_and_marks_the_day():
    progress.add_reply()
    snapshot = progress.snapshot("en")
    assert snapshot["xp"] == progress.XP_PER_REPLY
    assert snapshot["streak"] == 1


def test_complete_session_on_fifth_session_opens_the_chest():
    rewards = None
    for _ in range(progress.CHEST_EVERY):
        rewards = progress.complete_session("en", with_feedback=True)
    assert rewards["chest_opened"] is True
    assert rewards["xp_gained"] == progress.XP_PER_FEEDBACK + progress.XP_PER_CHEST
    assert progress.snapshot("en")["sessions_done"] == progress.CHEST_EVERY


def test_toggle_challenge_twice_gives_then_takes_back_xp():
    challenge = progress.set_challenges("en", ["Speak in the past tense."])[0]
    _, gained = progress.toggle_challenge("en", challenge["id"])
    assert gained == progress.XP_PER_CHALLENGE
    _, gained = progress.toggle_challenge("en", challenge["id"])
    assert gained == -progress.XP_PER_CHALLENGE
    assert progress.snapshot("en")["xp"] == 0


def test_parse_version_with_v_prefix_returns_number_tuple():
    assert updater.parse_version("v1.2.3") == (1, 2, 3)
    assert updater.parse_version("1.10.0") > updater.parse_version("1.9.9")
