# Polaris

Polaris service configuration for Sprint 1 lives in `docker/docker-compose.yml`. The bootstrap root principal is created with the pinned `apache/polaris-admin-tool` image, and `scripts/bootstrap.sh` creates the `quicksense` catalog idempotently.

