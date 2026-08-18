"""Doctor: пустой каталог при смонтированном корне — проблема."""

from __future__ import annotations

from pathlib import Path

import pytest
from typer.testing import CliRunner

from booklib.cli.app import app
from booklib.config.settings import get_settings
from booklib.db import connect

runner = CliRunner()


def test_doctor_empty_catalog_returns_nonzero(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Пустой каталог при смонтированном корне — exit code != 0."""
    library = tmp_path / "library"
    library.mkdir()
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "taxonomy.json").write_text('{"sections": [], "books": {}}')
    monkeypatch.setenv("BOOKLIB_ROOT", str(library))
    monkeypatch.setenv("BOOKLIB_CONFIG_DIR", str(config_dir))
    get_settings.cache_clear()

    conn = connect()
    conn.close()

    result = runner.invoke(app, ["doctor"])
    assert result.exit_code == 1
    assert "0 карточек" in result.output
    assert "проверьте корень" in result.output
