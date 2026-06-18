# SPDX-License-Identifier: Apache-2.0

FROM python:3.12-slim

ARG TRINO_CLIENT_VERSION=0.337.0

RUN pip install --no-cache-dir "trino==${TRINO_CLIENT_VERSION}"

WORKDIR /workspace

