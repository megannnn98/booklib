.PHONY: help install lock fmt lint typecheck test test-unit test-integration hooks \
        scan covers sections doctor serve restart logs

PKG := booklib

help:
	@echo "booklib make targets:"
	@echo "  make install          - uv sync (dev deps)"
	@echo "  make lock             - refresh uv.lock"
	@echo "  make hooks            - install pre-commit hooks"
	@echo "  make fmt              - ruff format + ruff check --fix"
	@echo "  make lint             - ruff check"
	@echo "  make typecheck        - mypy"
	@echo "  make test             - pytest (all)"
	@echo "  make test-unit        - pytest unit only"
	@echo "  make test-integration - pytest integration only"
	@echo "  make scan             - пересканировать библиотеку"
	@echo "  make covers           - догенерировать обложки"
	@echo "  make sections         - применить разделы и показать раскладку"
	@echo "  make doctor           - проверка окружения"
	@echo "  make serve            - поднять витрину вручную (127.0.0.1:8765)"
	@echo "  make restart          - перезапустить systemd --user сервис"
	@echo "  make logs             - журнал сервиса"

install:
	uv sync

lock:
	uv lock

hooks:
	uv run pre-commit install
	uv run pre-commit run --all-files

fmt:
	uv run ruff format src tests scripts
	uv run ruff check --fix src tests scripts

lint:
	uv run ruff check src tests scripts

typecheck:
	uv run mypy src

test:
	uv run pytest

test-unit:
	uv run pytest tests/unit -v

test-integration:
	uv run pytest tests/integration -v

scan:
	uv run booklib scan

covers:
	uv run booklib covers

sections:
	uv run booklib sections

doctor:
	uv run booklib doctor

serve:
	uv run booklib serve

restart:
	systemctl --user restart booklib.service
	systemctl --user --no-pager status booklib.service | head -12

logs:
	journalctl --user -u booklib.service -n 50 --no-pager
