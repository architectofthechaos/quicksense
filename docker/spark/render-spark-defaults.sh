#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

python3 - <<'PY'
from pathlib import Path
import os

template = Path("/opt/spark/conf/spark-defaults.conf.template")
target = Path("/opt/spark/conf/spark-defaults.conf")

content = template.read_text(encoding="utf-8")
for key in (
    "POLARIS_CLIENT_ID",
    "POLARIS_CLIENT_SECRET",
    "MINIO_ROOT_USER",
    "MINIO_ROOT_PASSWORD",
):
    content = content.replace("${" + key + "}", os.environ[key])

target.write_text(content, encoding="utf-8")
PY
