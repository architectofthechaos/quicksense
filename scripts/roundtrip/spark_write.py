# SPDX-License-Identifier: Apache-2.0

import os
from datetime import datetime

from pyspark.sql import SparkSession
from pyspark.sql.types import LongType, StringType, StructField, StructType, TimestampType


EXPECTED_ROWS = [
    (1, "alpha", datetime(2026, 1, 1, 12, 0, 0)),
    (2, "bravo", datetime(2026, 1, 1, 12, 5, 0)),
    (3, "charlie", datetime(2026, 1, 1, 12, 10, 0)),
]


def main() -> None:
    builder = SparkSession.builder.appName("quicksense-raw-iceberg-write")
    sc_remote = os.environ.get("SC_REMOTE")
    if sc_remote:
        builder = builder.remote(sc_remote)
    spark = builder.getOrCreate()

    spark.sql("CREATE NAMESPACE IF NOT EXISTS quicksense.demo")
    spark.sql(
        """
        CREATE TABLE IF NOT EXISTS quicksense.demo.events (
          id BIGINT,
          name STRING,
          ts TIMESTAMP
        ) USING iceberg
        """
    )
    spark.sql("DELETE FROM quicksense.demo.events")

    schema = StructType(
        [
            StructField("id", LongType(), nullable=False),
            StructField("name", StringType(), nullable=False),
            StructField("ts", TimestampType(), nullable=False),
        ]
    )
    spark.createDataFrame(EXPECTED_ROWS, schema=schema).createOrReplaceTempView("expected_events")
    spark.sql("INSERT INTO quicksense.demo.events SELECT id, name, ts FROM expected_events")

    rows = spark.sql(
        """
        SELECT id, name, date_format(ts, 'yyyy-MM-dd HH:mm:ss') AS ts
        FROM quicksense.demo.events
        ORDER BY id
        """
    ).collect()

    print("SPARK WROTE")
    for row in rows:
        print(f"{row.id},{row.name},{row.ts}")

    spark.stop()


if __name__ == "__main__":
    main()

