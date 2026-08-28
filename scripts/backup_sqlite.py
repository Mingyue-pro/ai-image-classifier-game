"""Create and verify a consistent downloadable backup of the research SQLite file."""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
import hashlib
from pathlib import Path
import sqlite3


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def create_verified_backup(source: Path, output_directory: Path) -> tuple[Path, str]:
    source = source.expanduser().resolve()
    output_directory = output_directory.expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(f"SQLite database does not exist: {source}")
    output_directory.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    destination = output_directory / f"final-evaluation-{timestamp}.db"
    if destination.exists():
        raise FileExistsError(f"Backup destination already exists: {destination}")

    with sqlite3.connect(source) as source_connection:
        with sqlite3.connect(destination) as destination_connection:
            source_connection.backup(destination_connection)

    with sqlite3.connect(destination) as backup_connection:
        integrity = backup_connection.execute("PRAGMA integrity_check").fetchone()
        foreign_keys = backup_connection.execute("PRAGMA foreign_key_check").fetchall()
    if integrity != ("ok",) or foreign_keys:
        destination.unlink(missing_ok=True)
        raise RuntimeError("SQLite backup integrity validation failed")
    return destination, file_sha256(destination)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument("--output-directory", type=Path, default=Path("/data/backups"))
    args = parser.parse_args()
    destination, digest = create_verified_backup(args.database, args.output_directory)
    print(f"Backup: {destination}")
    print(f"SHA256: {digest}")


if __name__ == "__main__":
    main()
