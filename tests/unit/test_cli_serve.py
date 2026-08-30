"""Запуск ASGI-сервера не должен доверять forwarded-заголовкам прокси."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from booklib.cli.app import serve


def test_serve_disables_uvicorn_proxy_headers(monkeypatch) -> None:
    """Caddy добавляет X-Forwarded-For, но он не должен менять peer Booklib."""
    received: dict[str, Any] = {}

    monkeypatch.setattr(
        "booklib.cli.app.get_settings",
        lambda: SimpleNamespace(host="127.0.0.1", port=8765, scan_on_start=False),
    )
    monkeypatch.setattr(
        "booklib.cli.app.uvicorn.run",
        lambda *args, **kwargs: received.update(args=args, kwargs=kwargs),
    )

    serve()

    assert received["kwargs"]["proxy_headers"] is False
