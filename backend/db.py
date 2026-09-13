import os
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
import storage


def connect():
    return psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row)


def migrate_documents(db):
    columns = {
        row["column_name"]
        for row in db.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='jobs'"
        )
    }
    for kind in ("input", "output"):
        if kind not in columns:
            continue
        # One document at a time; retain legacy bytes until all writes commit.
        with db.cursor(name="migrate_" + kind) as cursor:
            cursor.execute(
                f"SELECT id, {kind} AS content FROM jobs WHERE {kind} IS NOT NULL"
            )
            for row in cursor:
                reference = storage.key(row["id"], kind)
                storage.write(reference, bytes(row["content"]))
                db.execute(
                    f"UPDATE jobs SET {kind}_path=%s WHERE id=%s",
                    (reference, row["id"]),
                )
        db.execute(f"ALTER TABLE jobs DROP COLUMN {kind}")


def initialize():
    storage.root()
    with connect() as db:
        db.execute("SELECT pg_advisory_xact_lock(7359021)")
        db.execute(Path(__file__).with_name("schema.sql").read_text())
        migrate_documents(db)
