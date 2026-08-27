from pathlib import Path
import sqlite3

from scripts.backup_sqlite import create_verified_backup, file_sha256


def test_create_verified_backup_copies_a_consistent_database(tmp_path: Path) -> None:
    source = tmp_path / "final-evaluation.db"
    with sqlite3.connect(source) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("CREATE TABLE participants (id TEXT PRIMARY KEY)")
        connection.execute("INSERT INTO participants VALUES ('participant-1')")

    destination, digest = create_verified_backup(source, tmp_path / "backups")

    assert destination.is_file()
    assert digest == file_sha256(destination)
    with sqlite3.connect(destination) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute("SELECT id FROM participants").fetchall() == [
            ("participant-1",)
        ]


def test_create_verified_backup_refuses_a_missing_database(tmp_path: Path) -> None:
    missing = tmp_path / "missing.db"

    try:
        create_verified_backup(missing, tmp_path / "backups")
    except FileNotFoundError as error:
        assert str(missing) in str(error)
    else:
        raise AssertionError("Expected a missing source database to be rejected")
