"""Правила разделов для книг, которых нет в taxonomy.json."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from booklib.config.settings import get_settings
from booklib.grouping import Kind
from booklib.taxonomy import classify_new, load_rules, match_text

REPO_CONFIG = Path(__file__).resolve().parents[2] / "config"


@pytest.fixture(autouse=True)
def real_rules(tmp_path: Path) -> None:
    """Тестируем боевой rules.json, а не выдуманный."""
    config_dir = tmp_path / "config"
    config_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(get_settings().package_rules_path, config_dir / "rules.json")


def test_rules_file_is_valid_json_with_sections() -> None:
    rules, default = load_rules()
    assert rules, "правила не загрузились"
    assert default == "Новое"


@pytest.mark.parametrize(
    ("path", "section"),
    [
        # тип документа назван явно → даташит
        ("programming-embedded/STM32H7_reference_manual.pdf", "Даташиты и техдокументация"),
        # голое имя чипа → тоже даташит, но правилом из самого конца списка
        ("programming-embedded/STM32F407VG.pdf", "Даташиты и техдокументация"),
        # книга про чип должна остаться книгой
        ("новое/Программирование STM32 на C++.pdf", "Программирование"),
        ("новое/Zephyr RTOS для nRF52 микроконтроллеров.pdf", "Embedded и микроконтроллеры"),
        ("новое/Кропоткин - Взаимопомощь как фактор эволюции.pdf", "Анархизм и зины"),
        ("новое/Гудфеллоу - Глубокое обучение - 2018.pdf", "Machine Learning и LLM"),
        ("новое/Рецепты закваски и хлеба.pdf", "Ферментация и кулинария"),
    ],
)
def test_classify_new(path: str, section: str) -> None:
    assert classify_new(path)[0] == section


def test_unknown_goes_to_new_section() -> None:
    """По имени файла художественную литературу не опознать — честнее «Новое»."""
    assert classify_new("новое/Мураками - Норвежский лес.epub") == ("Новое", "default")


def test_audio_bypasses_rules() -> None:
    assert classify_new("languages/курс/Audio/__audio__", kind=Kind.AUDIO) == ("Аудио", "kind")


def test_match_text_ignores_directory() -> None:
    """Регрессия: слово 'embedded' в имени папки утаскивало все 136 файлов
    programming-embedded в раздел Embedded, потому что правила смотрели на весь путь."""
    assert "embedded" not in match_text("programming-embedded/The_Coming_Insurrection.pdf").lower()
    assert classify_new("programming-embedded/Кропоткин_Хлеб_и_воля.pdf")[0] == "Анархизм и зины"


def test_match_text_normalizes_separators() -> None:
    """Регрессия: 'reference_manual' с подчёркиванием не совпадал с паттерном."""
    assert match_text("x/STM32H7_reference_manual.pdf") == "STM32H7 reference manual pdf"


def test_taxonomy_covers_every_section_in_rules() -> None:
    """Правило не должно ссылаться на раздел, которого нет в списке разделов.

    Читаем taxonomy.example.json, а не боевой taxonomy.json: тот не коммитится
    (это опись личной библиотеки), а список разделов в примере тот же самый.
    """
    taxonomy = json.loads((REPO_CONFIG / "taxonomy.example.json").read_text(encoding="utf-8"))
    known = set(taxonomy["sections"])
    rules = json.loads(get_settings().package_rules_path.read_text(encoding="utf-8"))
    used = {item["section"] for item in rules["rules"]} | {rules["default"]}
    assert used <= known, f"разделы только в правилах: {used - known}"


def test_settings_point_at_isolated_config() -> None:
    assert get_settings().rules_path.exists()
