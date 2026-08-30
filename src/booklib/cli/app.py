"""CLI booklib (Typer). Точка входа: `booklib`."""

from __future__ import annotations

import json
import shutil
import sys
import time
from contextlib import closing

import typer
import uvicorn

from booklib import covers, opener
from booklib.api.app import app as fastapi_app
from booklib.config.settings import Settings, field_source, get_settings
from booklib.db import connect, init_state
from booklib.errors import LibraryUnavailable
from booklib.grouping import collect_groups, stats_report
from booklib.rootcheck import InvalidRoot
from booklib.scanner import sync
from booklib.service import apply_root, rescan
from booklib.taxonomy import apply as apply_sections
from booklib.taxonomy import classify_new
from booklib.tools import REQUIRED_TOOLS

app = typer.Typer(help="Локальный веб-каталог библиотеки", no_args_is_help=True)


@app.callback()
def prepare_state() -> None:
    """Старт любого CLI-вызова: одноразовая подготовка слота состояния.

    Пока корень ещё «до переключения» (активный на момент запуска), переносим
    legacy-состояние и пишем root.txt в слот. Дальше migrations/marker в connect()
    не выполняются — см. db.init_state.
    """
    init_state()


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
        typer.echo("\n--dry-run: каталог не изменён")
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
    root: str | None = typer.Option(None, "--root", help="сменить корень библиотеки"),
    reset: bool = typer.Option(
        False, "--reset", help="снять рантайм-конфиг (вернуться к env/умолчанию)"
    ),
) -> None:
    """Рантайм-конфиг: cache_dir/config.json поверх env.

    Без флагов печатает активные настройки и их источники
    (config > env > .env > умолчание).
    """
    if reset:
        path = get_settings().runtime_config_path
        path.unlink(missing_ok=True)
        get_settings.cache_clear()
        typer.echo(f"рантайм-конфиг снят: {path}")
        return

    if root:
        # apply_root из service: валидация → запись конфига → рескан атомарно
        # под замком (как в API). Раньше write_runtime_config звался до rescan(),
        # вне замка, — ровно то, что в API-ветке чинили отдельным коммитом.
        try:
            stats = apply_root(root)
        except (InvalidRoot, LibraryUnavailable) as exc:
            typer.secho(f"ОШИБКА: {exc}", fg="red", err=True)
            raise typer.Exit(2) from exc
        typer.echo(f"корень применён: {get_settings().root}")
        typer.echo("  ".join(f"{k}={v}" for k, v in stats.items()))
        return

    settings = get_settings()
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


def _check(ok: bool, line: str) -> int:
    """Напечатать строку проверки и вернуть её вклад в счётчик проблем.

    Пять копий `problems += 0 if ok else 1` рядом с пятью f-строками с галочкой
    читались хуже, чем один helper: галочка и счётчик не могут разъехаться.
    """
    typer.echo(f"{'✓' if ok else '✗'} {line}")
    return 0 if ok else 1


def _catalog_line(settings: Settings, mounted: bool) -> tuple[bool, str]:
    """Строка про каталог: 0 карточек при смонтированном корне — это проблема.

    Иначе расхождение «конфиг указывает не на библиотеку» выглядело бы как
    нормальное состояние (✓ и exit 0).
    """
    if not settings.db_path.exists():
        return False, f"каталог      СУБД ещё нет: {settings.db_path}"
    with closing(connect()) as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS n, SUM(missing) AS missing, SUM(has_cover) AS covers FROM books"
        ).fetchone()
    if row["n"] == 0 and mounted:
        return False, "каталог      0 карточек — каталог пуст, проверьте корень (booklib config)"
    return True, (
        f"каталог      {row['n']} карточек, обложек {row['covers'] or 0}, "
        f"пропало {row['missing'] or 0}"
    )


@app.command()
def doctor() -> None:
    """Проверить окружение: утилиты, библиотеку, каталог."""
    settings = get_settings()
    problems = 0

    for tool in REQUIRED_TOOLS:
        found = shutil.which(tool)
        problems += _check(bool(found), f"{tool:<12} {found or 'НЕ НАЙДЕН'}")

    mounted = settings.root.is_dir()
    problems += _check(mounted, f"библиотека   {settings.root}")
    typer.echo(f"корень:      источник {field_source('root')}")
    typer.echo(f"слот:        {settings.slot_dir}")

    problems += _check(*_catalog_line(settings, mounted))

    for name in ("taxonomy.json", "rules.json"):
        path, source = settings.resolve_config_file(name)
        problems += _check(path.exists(), f"{name:<13} {path} ({source})")

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
        # Caddy проставляет X-Forwarded-For автоматически. Права Booklib
        # определяет только по непосредственному peer, поэтому не позволяем
        # Uvicorn заменить loopback-peer значением этого заголовка.
        proxy_headers=False,
    )


def main() -> None:
    app()


if __name__ == "__main__":
    main()
