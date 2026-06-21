# SPEC-004a Design — Branded Keycloak Login + Punch-list

Parent: `2026-06-20-spec-004-program-design.md`. Smallest phase, independent, high brand value — implemented first.

## Goal
Make the login page feel fully QuickSense via a Keycloak **login theme** mounted into the **stock** Keycloak image (no fork, no custom build, no ROPC). Auth Code + PKCE from SPEC-003 unchanged. Plus the SPEC-003 review punch-list.

## Current state (verified)
- Realm `docker/keycloak/realm-quicksense.json` sets only `displayName` + `displayNameHtml` (a wordmark snippet) on the **stock** `keycloak` theme. No `loginTheme`, no theme dir.
- App login page `ui/app/login/page.tsx` (the pre-Keycloak "Sign in with Keycloak" card) is already branded — out of scope here; the *Keycloak* page is what we theme.
- Sidebar `Connected/Disconnected` pill **already exists** (`ui/components/ConnectionStatus.tsx`, pings `/api/clusters`). Punch-list item largely done → verify only.
- "1 Issue" badge: no source match → it is the **Next.js dev-tools indicator**, fixed via `next.config.ts`.

## Deliverables
1. **Theme** `docker/keycloak/themes/quicksense/`:
   - `theme.properties` — `parent=keycloak`, `import=common/keycloak`, `styles=css/login.css`, locale + `kcHtmlClass`/`kcLogoIdP` overrides as needed.
   - `login/resources/css/login.css` — QuickSense indigo palette (mirror the design tokens), styled card/inputs/primary button, background, typography.
   - `login/resources/img/` — QuickSense logo (reuse `ui/public/logo-mark.png` / wordmark).
   - `login/resources/fonts/` — self-hosted Inter woff2 (air-gapped; `@font-face` in `login.css`).
   - Override `login/login.ftl` **only** for logo + layout hooks; inherit the rest of the base theme (keeps MFA / forgot-password / social intact).
2. **Realm:** set `"loginTheme": "quicksense"` in `realm-quicksense.json`.
3. **Mount (Compose):** bind-mount `./docker/keycloak/themes/quicksense` → `/opt/keycloak/themes/quicksense` on the `keycloak` service in `docker/docker-compose.yml`; ensure dev theme caching is off so edits show.
4. **Mount (kind):** ship the theme into the Keycloak pod — ConfigMap(s) from the theme files (or a small initContainer copy) mounted at `/opt/keycloak/themes/quicksense` in `deploy/k8s/base/keycloak.yaml`.
5. **Punch-list:** disable Next dev indicator in `ui/next.config.ts`; verify the Connected pill reflects health; fix the clusters NAME column width in `ui/components/ClustersView.tsx`.

## Tests (TDD)
- **Infra contract (pytest)** — new assertions in `tests/test_infrastructure_contract.py`:
  - theme dir + `theme.properties` + `login.css` + logo exist;
  - `realm-quicksense.json` has `loginTheme: quicksense`;
  - `docker-compose.yml` mounts the theme path;
  - `deploy/k8s/base/keycloak.yaml` mounts the theme (ConfigMap/volume) at the themes path;
  - `login.css` contains the indigo primary token and no `http(s)://` CDN URLs (air-gapped).
- **UI (Vitest):** `next.config.ts` sets `devIndicators:false`; clusters NAME column carries the width/no-clip class.

## DoD
1. Login shows a QuickSense-branded page served by Keycloak; `qsuser`/`qs-password` logs in; redirect to `/app/clusters` works.
2. Keycloak is the **stock image** + mounted theme only (documented in README).
3. Theme works in Compose **and** kind.
4. Punch-list fixed.
