"""Ядро тегов: ручные назначения и словарь."""

from __future__ import annotations

from pathlib import Path

import pytest

from booklib.db import connect_at
from booklib.tags import (
    DESCRIPTION_UNSET,
    TagConflict,
    TagInUse,
    TagInvalid,
    TagNotFound,
    add_alias,
    create_tag,
    delete_tag,
    list_tags,
    merge_tags,
    normalize,
    resolve,
    set_book_tags,
    tags_for,
    update_tag,
)


def test_normalize_trims_and_rejects_empty() -> None:
    assert normalize("  Гегель  ") == "Гегель"
    with pytest.raises(TagInvalid):
        normalize("   ")


def test_create_tag_rejects_unknown_kind(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    with pytest.raises(TagInvalid):
        create_tag(conn, "Гегель", "unknown", None)


def test_create_tag_treats_blank_description_as_absent(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    tag = create_tag(conn, "Гегель", "topic", "   ")

    assert tag["description"] is None


def test_create_tag_trims_description(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    tag = create_tag(conn, "Гегель", "topic", "  немецкая философия  ")

    assert tag["description"] == "немецкая философия"


def test_tags_are_case_insensitively_unique(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    create_tag(conn, "Гегель", "topic", None)
    with pytest.raises(TagConflict):
        create_tag(conn, "гегель", "topic", None)


def test_create_tag_rejects_empty_name(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    with pytest.raises(TagInvalid):
        create_tag(conn, "   ", "topic", None)


def test_create_tag_rejects_empty_kind(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    with pytest.raises(TagInvalid):
        create_tag(conn, "Гегель", "   ", None)


def test_name_and_alias_conflict_cross_tables(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    left = create_tag(conn, "Гегель", "topic", None)
    right = create_tag(conn, "Диалектика", "topic", None)
    add_alias(conn, right["id"], "идеализм")

    with pytest.raises(TagConflict):
        add_alias(conn, left["id"], "диалектика")


def test_empty_alias_is_rejected(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    tag = create_tag(conn, "Гегель", "topic", None)
    with pytest.raises(TagInvalid):
        add_alias(conn, tag["id"], "   ")


def test_alias_matching_name_is_rejected(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    tag = create_tag(conn, "Диалектика", "topic", None)

    with pytest.raises(TagConflict):
        add_alias(conn, tag["id"], "диалектика")


def test_update_tag_rejects_name_matching_own_alias(tmp_path: Path) -> None:
    """Переименование — вторая дверь к инварианту «алиас != имя»: она тоже закрыта."""
    conn = connect_at(tmp_path / "tags.db")
    tag = create_tag(conn, "Диалектика", "topic", None)
    add_alias(conn, tag["id"], "Логика")

    with pytest.raises(TagConflict):
        update_tag(conn, tag["id"], "логика", None)

    assert list_tags(conn)[0]["name"] == "Диалектика"


def test_aliases_are_case_insensitively_unique(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    left = create_tag(conn, "Гегель", "topic", None)
    right = create_tag(conn, "Диалектика", "topic", None)
    add_alias(conn, left["id"], "немецкий идеализм")

    with pytest.raises(TagConflict):
        add_alias(conn, right["id"], "НЕМЕЦКИЙ ИДЕАЛИЗМ")


def test_update_tag_changes_name_kind_and_description(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    tag = create_tag(conn, "Гегель", "topic", "old")

    updated = update_tag(conn, tag["id"], "Диалектика", "person", "new")

    assert updated["name"] == "Диалектика"
    assert updated["kind"] == "person"
    assert updated["description"] == "new"


def test_update_tag_preserves_description_when_missing(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    tag = create_tag(conn, "Гегель", "topic", "old")

    updated = update_tag(conn, tag["id"], "Диалектика", None, DESCRIPTION_UNSET)

    assert updated["description"] == "old"


def test_update_tag_clears_description_when_blank(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    tag = create_tag(conn, "Гегель", "topic", "old")

    updated = update_tag(conn, tag["id"], None, None, "   ")

    assert updated["description"] is None


def test_update_tag_rejects_alias_conflict(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    left = create_tag(conn, "Гегель", "topic", None)
    right = create_tag(conn, "Диалектика", "topic", None)
    add_alias(conn, right["id"], "немецкий идеализм")

    with pytest.raises(TagConflict):
        update_tag(conn, left["id"], "немецкий идеализм", None, None)


def test_resolve_accepts_alias(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    tag = create_tag(conn, "Гегель", "topic", None)
    add_alias(conn, tag["id"], "немецкий идеализм")

    assert resolve(conn, ["немецкий идеализм"]) == [tag["id"]]


def test_merge_moves_book_links_and_aliases(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    source = create_tag(conn, "Гегель", "topic", None)
    target = create_tag(conn, "Философия", "topic", None)
    add_alias(conn, source["id"], "немецкий идеализм")
    _insert_book(conn, "book-1")
    _insert_book(conn, "book-2")
    conn.commit()
    set_book_tags(conn, "book-1", ["Гегель"])
    set_book_tags(conn, "book-2", ["Гегель", "Философия"])
    conn.commit()

    summary = merge_tags(conn, source["id"], target["id"])

    assert summary["moved"] == 1
    assert summary["aliases_moved"] == 1
    assert summary["dropped"] == 1
    assert resolve(conn, ["немецкий идеализм"]) == [target["id"]]
    tags = tags_for(conn, ["book-1", "book-2"])
    assert {item["name"] for item in tags["book-1"]} == {"Философия"}
    assert {item["name"] for item in tags["book-2"]} == {"Философия"}


def test_set_book_tags_replaces_manual_tags_only(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    left = create_tag(conn, "Гегель", "topic", None)
    right = create_tag(conn, "Диалектика", "topic", None)
    _insert_book(conn, "book-1")
    conn.commit()
    set_book_tags(conn, "book-1", ["Гегель", "Диалектика"])
    conn.execute("UPDATE book_tags SET source = 'auto' WHERE tag_id = ?", (right["id"],))
    conn.commit()

    set_book_tags(conn, "book-1", ["Гегель"])
    rows = conn.execute(
        "SELECT tag_id, source FROM book_tags WHERE book_key = ? ORDER BY tag_id",
        ("book-1",),
    ).fetchall()

    assert [(row["tag_id"], row["source"]) for row in rows] == [
        (left["id"], "manual"),
        (right["id"], "auto"),
    ]


def test_tags_count_ignores_missing_books(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    create_tag(conn, "Гегель", "topic", None)
    _insert_book(conn, "book-1")
    _insert_book(conn, "book-2", missing=1)
    conn.commit()
    set_book_tags(conn, "book-1", ["Гегель"])
    set_book_tags(conn, "book-2", ["Гегель"])
    conn.commit()

    rows = list_tags(conn)
    assert rows[0]["count"] == 1


def test_manual_tags_survive_rescan_and_missing_return(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    create_tag(conn, "Гегель", "topic", None)
    _insert_book(conn, "book-1")
    conn.commit()
    set_book_tags(conn, "book-1", ["Гегель"])
    conn.commit()
    conn.execute("UPDATE books SET missing = 1 WHERE key = ?", ("book-1",))
    conn.commit()
    assert {item["name"] for item in tags_for(conn, ["book-1"])["book-1"]} == {"Гегель"}
    conn.execute("UPDATE books SET missing = 0 WHERE key = ?", ("book-1",))
    conn.commit()
    assert {item["name"] for item in tags_for(conn, ["book-1"])["book-1"]} == {"Гегель"}


def test_delete_used_tag_is_blocked(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    tag = create_tag(conn, "Гегель", "topic", None)
    _insert_book(conn, "book-1")
    conn.commit()
    set_book_tags(conn, "book-1", ["Гегель"])
    conn.commit()

    with pytest.raises(TagInUse):
        delete_tag(conn, tag["id"])


def test_list_tags_reports_counts_and_aliases(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    tag = create_tag(conn, "Гегель", "topic", "desc")
    add_alias(conn, tag["id"], "немецкий идеализм")
    _insert_book(conn, "book-1")
    conn.commit()
    set_book_tags(conn, "book-1", ["Гегель"])
    conn.commit()

    rows = list_tags(conn)
    assert rows[0]["count"] == 1
    assert rows[0]["aliases"] == ["немецкий идеализм"]


def test_set_book_tags_unknown_name_rolls_back(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    create_tag(conn, "Гегель", "topic", None)
    _insert_book(conn, "book-1")
    conn.commit()

    with pytest.raises(TagNotFound):
        set_book_tags(conn, "book-1", ["Гегель", "Неизвестный"])

    assert tags_for(conn, ["book-1"]) == {"book-1": []}


def _insert_book(conn, key: str, missing: int = 0) -> None:
    conn.execute(
        "INSERT INTO books(key, dir, basename, title, author, year, section, section_source, "
        "kind, formats_json, files_json, primary_file, size, mtime, has_cover, cover_error, "
        "added_at, seen_at, missing) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            key,
            ".",
            "b.pdf",
            "Book",
            None,
            None,
            None,
            None,
            "book",
            "[]",
            "[]",
            "b.pdf",
            1,
            1.0,
            0,
            None,
            1.0,
            1.0,
            missing,
        ),
    )
