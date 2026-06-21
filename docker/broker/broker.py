#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""QuickSense Spark Connect execution broker.

The Go control-plane API has no Spark Connect client (Spark Connect is gRPC +
Arrow), so notebook cell execution is brokered here: the API POSTs
{connect_url, code} and this service runs the cell against a pyspark[connect]
session bound to that cluster's sc:// endpoint, returning captured stdout and
any traceback. Sessions are cached per connect_url.

Stdlib only (http.server) — no extra runtime deps, air-gapped. pyspark[connect]
is already present in the QuickSense Spark image this runs on.
"""
import glob
import io
import json
import os
import sys
import traceback
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

_sessions = {}


def _ensure_pyspark_path():
    """The Spark image bundles pyspark at $SPARK_HOME/python (not pip-installed),
    so add it (+ the py4j zip) to sys.path before importing pyspark. Version-robust
    via a glob so a py4j bump in the base image needs no change here."""
    spark_home = os.environ.get("SPARK_HOME", "/opt/spark")
    pyroot = os.path.join(spark_home, "python")
    for p in [pyroot, *glob.glob(os.path.join(pyroot, "lib", "py4j-*-src.zip"))]:
        if os.path.isdir(p) or os.path.isfile(p):
            if p not in sys.path:
                sys.path.insert(0, p)


def _session(connect_url):
    """Return a cached SparkSession for connect_url, creating it on first use."""
    s = _sessions.get(connect_url)
    if s is None:
        _ensure_pyspark_path()
        from pyspark.sql import SparkSession  # imported lazily so /healthz works without Spark

        s = SparkSession.builder.remote(connect_url).getOrCreate()
        _sessions[connect_url] = s
    return s


def _run(connect_url, code):
    """Execute code with `spark` in scope; capture stdout + traceback."""
    out = {"stdout": "", "error": ""}
    buf = io.StringIO()
    try:
        spark = _session(connect_url)
        with redirect_stdout(buf):
            exec(code, {"spark": spark})  # noqa: S102 — broker executes user cells by design
        out["stdout"] = buf.getvalue()
    except Exception:  # noqa: BLE001 — surface any cell error as a traceback frame
        out["stdout"] = buf.getvalue()
        out["error"] = traceback.format_exc()
    return out


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/healthz":
            self._json(200, {"ok": True})
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path != "/run":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", 0) or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._json(400, {"error": "invalid JSON body"})
            return
        connect_url = body.get("connect_url", "")
        code = body.get("code", "")
        if not connect_url or not code:
            self._json(400, {"error": "connect_url and code are required"})
            return
        self._json(200, _run(connect_url, code))

    def log_message(self, format, *args):  # noqa: A002 — match base signature; quiet logging
        pass


def main():
    port = int(os.environ.get("BROKER_PORT", "8099"))
    print(f"quicksense-broker: listening on :{port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
