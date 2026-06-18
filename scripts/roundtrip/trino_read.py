# SPDX-License-Identifier: Apache-2.0

import os
import sys
from datetime import datetime

import trino


EXPECTED_ROWS = [
    (1, "alpha", "2026-01-01 12:00:00"),
    (2, "bravo", "2026-01-01 12:05:00"),
    (3, "charlie", "2026-01-01 12:10:00"),
]


def normalize_ts(value: object) -> str:
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    text = str(value)
    return text.split(".", maxsplit=1)[0]


def main() -> int:
    conn = trino.dbapi.connect(
        host=os.environ.get("TRINO_HOST", "localhost"),
        port=int(os.environ.get("TRINO_PORT", "8080")),
        user=os.environ.get("TRINO_USER", "quicksense"),
        catalog="iceberg",
        schema="demo",
    )

    cur = conn.cursor()
    cur.execute("SELECT id, name, ts FROM iceberg.demo.events ORDER BY id")
    actual_rows = [(int(row[0]), row[1], normalize_ts(row[2])) for row in cur.fetchall()]

    if actual_rows != EXPECTED_ROWS:
        print("ROUNDTRIP FAILED", file=sys.stderr)
        print(f"expected: {EXPECTED_ROWS}", file=sys.stderr)
        print(f"actual:   {actual_rows}", file=sys.stderr)
        return 1

    print("TRINO READ")
    for row in actual_rows:
        print(f"{row[0]},{row[1]},{row[2]}")
    print("ROUNDTRIP OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

