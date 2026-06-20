# SPDX-License-Identifier: Apache-2.0
#
# Multi-stage Dockerfile for the QuickSense control-plane API.
#
# Build context: api/   (i.e. `docker build -t quicksense-api:dev api/`)
#
# Stage 1 — builder
#   golang:1.26-alpine satisfies the go 1.25 directive in go.mod (1.26 toolchain
#   builds it cleanly; image tag is pinned per air-gapped-first constraint).
#
# Stage 2 — runtime
#   gcr.io/distroless/static-debian12 provides no shell, minimal attack surface.
#   SQL migrations are embedded via //go:embed so no extra files are needed at
#   runtime.

# ─── Stage 1: builder ────────────────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS builder

# TARGETOS/TARGETARCH are provided automatically by BuildKit and default to the
# build host's platform, so a plain `docker build` on arm64 produces an arm64
# binary (matching the kind node) and cross-builds work via `--platform`.
ARG TARGETOS
ARG TARGETARCH

WORKDIR /src

# Cache module downloads before copying source so layer is reused when only
# source files change.
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the source.
COPY . .

# Build a fully static binary (CGO disabled for distroless compatibility),
# targeting the requested platform.
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-arm64} \
    go build -trimpath -ldflags="-s -w" \
    -o /quicksense-api ./cmd/quicksense-api

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
# :nonroot is a concrete, non-floating tag (avoids implicit :latest) and runs as
# an unprivileged user. A sha256 digest pin is the stricter follow-up.
FROM gcr.io/distroless/static-debian12:nonroot

# Copy the static binary from the builder stage.
COPY --from=builder /quicksense-api /quicksense-api

EXPOSE 8080

ENTRYPOINT ["/quicksense-api"]
