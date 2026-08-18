"""CLI booklib (Typer). Точка входа: `booklib`."""

from __future__ import annotations

import json
import shutil
import sys
import time

import typer
import uvicorn

from booklib import covers, opener
from booklib.api.app import app as fastapi_app
from booklib.api.app import rescan
from booklib.config.settings import field_source, get_settings, write_runtime_config
from booklib.db import connect
from booklib.errors import LibraryUnavailable
from booklib.grouping import collect_groups, stats_report
from booklib.rootcheck import InvalidRoot, validate_root
from booklib.scanner import sync
from booklib.taxonomy import apply as apply_sections
from booklib.taxonomy import classify_new
from booklib.tools import REQUIRED_TOOLS

app = typer.Typer(help="Локальный веб-каталог библиотеки", no_args_is_help=True)


@app.command()
def scan(
    dry_run: bool = typer.Option(False, "--dry-run", help="только статистика, без записи в СУБД"),
    show: str | None = typer.Option(None, "--show", help="показать карточки по подстроке ключа"),
    limit: int = typer.Option(20, help="сколько карточек печатать для --show"),
) -> None:
    """Просканировать библиотеку и обновить каталог."""
    try:
        groups = collect_groups()
    except LibraryUnavailable as exc:
        typer.secho(f"ОШИБКА: {exc}", fg="red", err=True)
        raise typer.Exit(2) from exc

    if show:
        needle = show.casefold()
        matched = [g for k, g in groups.items() if needle in k.casefold()]
        typer.echo(f"совпадений: {len(matched)}")
        for group in matched[:limit]:
            title, author, year = group.title, group.author, group.year
            typer.echo(f"\n[{group.key}]")
            typer.echo(f"  название: {title}")
            typer.echo(f"  автор:    {author or '—'}   год: {year or '—'}")
            typer.echo(f"  форматы:  {', '.join(group.formats)} → {group.primary_file.name}")
            for path in group.files:
                typer.echo(f"    - {path.name}  ({path.stat().st_size / 1048576:.1f} MB)")
        return

    report = stats_report(groups)
    typer.echo(f"корень:        {get_settings().root}")
    typer.echo(f"файлов:        {report['files']}")
    typer.echo(
        f"карточек:      {report['cards']} (книг {report['books']}, аудио {report['audio']})"
    )
    typer.echo(f"мультиформат:  {report['multi_format']}, склеено: {report['merged_stems']}")
    typer.echo("расширения:    " + ", ".join(f"{k}:{v}" for k, v in report["by_ext"].items()))

    if dry_run:
        typer.echo("\n--dry-run: СУБД не тронута")
        return

    conn = connect()
    try:
        stats = sync(conn, groups)
        sections = apply_sections(conn)
    except LibraryUnavailable as exc:
        typer.secho(f"ОШИБКА: {exc}", fg="red", err=True)
        raise typer.Exit(2) from exc
    finally:
        conn.close()

    typer.echo("\n" + "  ".join(f"{k}={v}" for k, v in stats.items()))
    typer.echo("разделы: " + "  ".join(f"{k}={v}" for k, v in sections.items()))


@app.command("covers")
def covers_cmd(
    force: bool = typer.Option(False, "--force", help="перегенерировать даже готовые"),
    only: str | None = typer.Option(None, "--only", help="только карточки по подстроке ключа"),
    workers: int = typer.Option(0, help="потоков (0 — из настроек)"),
    report: bool = typer.Option(False, "--report", help="книги без обложки и причины"),
) -> None:
    """Сгенерировать превью обложек."""
    if report:
        covers.report()
        return

    started = time.time()
    try:
        stats = covers.generate(
            force=force, only=only, workers=workers or get_settings().cover_workers
        )
    except LibraryUnavailable as exc:
        typer.secho(f"ОШИБКА: {exc}", fg="red", err=True)
        raise typer.Exit(2) from exc
    typer.echo("  ".join(f"{k}={v}" for k, v in stats.items()))
    typer.echo(f"время: {time.time() - started:.1f} с   кэш: {get_settings().cover_dir}")


@app.command()
def sections() -> None:
    """Применить разделы к каталогу и показать раскладку."""
    conn = connect()
    stats = apply_sections(conn)
    rows = conn.execute(
        "SELECT section, COUNT(*) AS n FROM books WHERE missing = 0 GROUP BY 1 ORDER BY n DESC"
    ).fetchall()
    conn.close()
    for row in rows:
        typer.echo(f"{row['n']:4d}  {row['section']}")
    typer.echo("\nисточники: " + "  ".join(f"{k}={v}" for k, v in stats.items()))


@app.command("classify")
def classify_cmd(path: str) -> None:
    """Показать, в какой раздел попадёт новая книга с таким путём."""
    section, source = classify_new(path)
    typer.echo(f"{path}\n  -> {section}  (источник: {source})")


@app.command("config")
def config_cmd(
    show: bool = typer.Option(False, "--show", help="активные настройки и источник каждого"),
    root: str | None = typer.Option(None, "--root", help="сменить корень библиотеки"),
    reset: bool = typer.Option(
        False, "--reset", help="снять рантайм-конфиг (вернуться к env/умолчанию)"
    ),
) -> None:
    """Рантайм-конфиг: cache_dir/config.json поверх env.

    Без флагов и с --show печатает активные настройки и их источники
    (config > env > .env > умолчание).
    """
    if reset:
        path = get_settings().runtime_config_path
        path.unlink(missing_ok=True)
        get_settings.cache_clear()
        typer.echo(f"рантайм-конфиг снят: {path}")
        return

    if root:
        try:
            resolved = validate_root(root)
        except InvalidRoot as exc:
            typer.secho(f"ОШИБКА: {exc}", fg="red", err=True)
            raise typer.Exit(2) from exc
        write_runtime_config(root=str(resolved))
        typer.echo(f"корень применён: {resolved}")
        try:
            stats = rescan()
        except LibraryUnavailable as exc:
            typer.secho(f"ОШИБКА: корень применён, но скан невозможен: {exc}", fg="red", err=True)
            raise typer.Exit(2) from exc
        typer.echo("  ".join(f"{k}={v}" for k, v in stats.items()))
        return

    if not show:
        show = True
    settings = get_settings()
    if show:
        typer.echo(f"root:          {settings.root}   (источник: {field_source('root')})")
        typer.echo(
            f"scan_on_start: {settings.scan_on_start}   (источник: {field_source('scan_on_start')})"
        )
        typer.echo(f"cache_dir:     {settings.cache_dir}")
        typer.echo(f"слот:          {settings.slot_dir}")
        typer.echo(f"СУБД:          {settings.db_path}")
        typer.echo(f"обложки:       {settings.cover_dir}")
        typer.echo(f"файл конфига:  {settings.runtime_config_path}")


@app.command("open")
def open_cmd(
    key: str,
    dry_run: bool = typer.Option(False, "--dry-run", help="проверить путь, не открывая nemo"),
) -> None:
    """Открыть папку с книгой в файловом менеджере."""
    try:
        if dry_run:
            typer.echo(str(opener.resolve_target(key)))
        else:
            typer.echo(json.dumps(opener.open_book(key), ensure_ascii=False))
    except opener.OpenError as exc:
        typer.secho(f"ОШИБКА: {exc}", fg="red", err=True)
        raise typer.Exit(1) from exc


@app.command()
def doctor() -> None:
    """Проверить окружение: утилиты, библиотеку, каталог."""
    settings = get_settings()
    problems = 0

    for tool in REQUIRED_TOOLS:
        found = shutil.which(tool)
        typer.echo(f"{'✓' if found else '✗'} {tool:<12} {found or 'НЕ НАЙДЕН'}")
        problems += 0 if found else 1

    mounted = settings.root.is_dir()
    typer.echo(f"{'✓' if mounted else '✗'} библиотека   {settings.root}")
    problems += 0 if mounted else 1
    typer.echo(f"корень:      источник {field_source('root')}")
    typer.echo(f"слот:        {settings.slot_dir}")

    if settings.db_path.exists():
        conn = connect()
        row = conn.execute(
            "SELECT COUNT(*) AS n, SUM(missing) AS missing, SUM(has_cover) AS covers FROM books"
        ).fetchone()
        conn.close()
        if row["n"] == 0 and mounted:
            typer.echo(
                "✗ каталог      0 карточек — каталог пуст, проверьте корень (booklib config --show)"
            )
            problems += 1
        else:
            typer.echo(
                f"✓ каталог      {row['n']} карточек, обложек {row['covers'] or 0}, "
                f"пропало {row['missing'] or 0}"
            )
    else:
        typer.echo(f"✗ каталог      СУБД ещё нет: {settings.db_path}")
        problems += 1

    taxonomy = settings.taxonomy_path
    typer.echo(f"{'✓' if taxonomy.exists() else '✗'} {taxonomy.name:<12} {taxonomy}")
    problems += 0 if taxonomy.exists() else 1

    rules = settings.rules_path
    note = " (пакетный дефолт)" if rules == settings.package_rules_path else " (пользовательский)"
    typer.echo(f"{'✓' if rules.exists() else '✗'} {rules.name:<12} {rules}{note}")
    problems += 0 if rules.exists() else 1

    raise typer.Exit(1 if problems else 0)


@app.command()
def serve(
    host: str | None = typer.Option(None, help="по умолчанию из настроек (127.0.0.1)"),
    port: int | None = typer.Option(None),
    reload: bool = typer.Option(False, "--reload"),
    scan_on_start: bool | None = typer.Option(None, "--scan/--no-scan"),
) -> None:
    """Поднять веб-витрину."""
    settings = get_settings()
    do_scan = settings.scan_on_start if scan_on_start is None else scan_on_start

    if do_scan:
        try:
            typer.echo(f"скан при старте: {rescan()}")
        except LibraryUnavailable as exc:
            print(f"библиотека недоступна, каталог оставлен как есть: {exc}", file=sys.stderr)

    uvicorn.run(
        "booklib.api.app:app" if reload else fastapi_app,
        host=host or settings.host,
        port=port or settings.port,
        reload=reload,
        log_level="warning",
    )


def main() -> None:
    app()


if __name__ == "__main__":
    main()
