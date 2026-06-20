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
FROM golang:1.26-alpine AS builder

WORKDIR /src

# Cache module downloads before copying source so layer is reused when only
# source files change.
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the source.
COPY . .

# Build a fully static binary (CGO disabled for distroless compatibility).
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags="-s -w" \
    -o /quicksense-api ./cmd/quicksense-api

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12

# Copy the static binary from the builder stage.
COPY --from=builder /quicksense-api /quicksense-api

EXPOSE 8080

ENTRYPOINT ["/quicksense-api"]
