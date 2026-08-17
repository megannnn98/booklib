"""Нормализация имён файлов и разбор названия/автора/года."""

from __future__ import annotations

import pytest

from booklib.meta import normalize_basename, parse_meta


@pytest.mark.parametrize(
    ("stem", "expected"),
    [
        # варианты вёрстки одного текста
        ("Сюэ Фэй - Притчи - 2019.a4", "Сюэ Фэй - Притчи - 2019"),
        ("Сюэ Фэй - Притчи - 2019.a6", "Сюэ Фэй - Притчи - 2019"),
        # машинные хвосты генератора имён
        ("DS18B20_Programmable_Resolution_p33_1", "DS18B20_Programmable_Resolution"),
        ("s140_nrf52_release_notes_v4", "s140_nrf52_release_notes"),
        # `_v3` снимается, а `_p1083` уже нет: остаток «hfmcu» короче порога.
        # Так и в боевом каталоге — ключ карточки именно hfmcu_p1083.
        ("hfmcu_p1083_v3", "hfmcu_p1083"),
        # обычное имя не трогаем
        ("Юлиус Эвола - Даосизм - 2020", "Юлиус Эвола - Даосизм - 2020"),
    ],
)
def test_normalize_basename(stem: str, expected: str) -> None:
    assert normalize_basename(stem) == expected


def test_normalize_keeps_short_stem_intact() -> None:
    """Короткий остаток не срезаем — иначе имя схлопнется в пустоту."""
    assert normalize_basename("ab_v2") == "ab_v2"


@pytest.mark.parametrize(
    ("basename", "title", "author", "year"),
    [
        ("Юлиус Эвола - Даосизм - 2020", "Даосизм", "Юлиус Эвола", 2020),
        ("Торчинов Е.А. - Даосизм. - 1998", "Даосизм", "Торчинов Е.А.", 1998),
        (
            "Васильев Л.С. Дао и даосизм в Китае. 1982",
            "Васильев Л.С. Дао и даосизм в Китае",
            None,
            1982,
        ),
        ("DS18B20_Programmable_Resolution", "DS18B20 Programmable Resolution", None, None),
    ],
)
def test_parse_meta(basename: str, title: str, author: str | None, year: int | None) -> None:
    assert parse_meta(basename) == (title, author, year)


def test_parse_meta_truncates_machine_names() -> None:
    """Имена-первые-строки текста бывают по 200 символов — карточка их не переживёт."""
    long_name = "Preface_Thank_you_for_using_FV20_series_Variable_Frequency_Drive_" * 4
    title, _, _ = parse_meta(long_name)
    assert len(title) <= 120
    assert title.endswith("…")
