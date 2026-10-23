# Changelog

## 0.3.1 - 2026-10-23

- Tools that cannot work are not listed: `bars_*` without a `KEYCLOAK_IDENTITY` or once ITMO.ID rejected it (back
  with a new cookie), `widgets_*` without a pairing. A stdio client gets `tools/list_changed` when that changes; in
  HTTP mode every request lists what works at that moment. Agents stop calling BARS on a dead cookie.

## 0.3.0 - 2026-10-22

Connecting through the ITMO.Widgets app (ITMO.Widgets `vibe/plans/connected-clients-plan.md`, Backend
`docs/contracts/connections.md`).

- Add `itmo-mcp pair`, `setup`, `status`, `renew` and `unpair`. `pair` shows a QR code, a link and a verification
  code; the phone approves the scopes and signs in to ITMO.ID for this server in an isolated window, then hands over a
  separate ITMO.ID session (HPKE X25519 / HKDF-SHA256 / ChaCha20-Poly1305) and an `iwc_` ITMO.Widgets token. Both are
  kept in `state.json` (0600). `renew` gets a new ITMO session for the same connection and ends the old one; `setup`
  pairs and adds the server to Claude Code, Codex and Cursor, asking for each.
- A paired server uses only its own session for my.itmo.ru. When ITMO.ID refuses it (`invalid_grant`), the session
  is marked closed, reported to ITMO.Widgets (`PUT /api/client/status`) and no further ITMO.ID calls are made until
  `renew`. On `unpair` and on a revoked connection (Backend 401) the server ends its own ITMO.ID session with the OIDC
  logout and forgets the pairing.
- Add `widgets_get_teacher_reviews` (`reviews:read`), `widgets_get_subject_links` (`links:read`),
  `widgets_get_sport_queue` and, with writes on, `widgets_sport_queue_join_preview` /
  `widgets_sport_queue_leave_preview` (`sport:queue`). A tool without its scope names the switch to turn on in the
  app. `itmo_get_schedule` lessons carry `subject_id`.
- Add `ITMO_BROWSER_UA` (default `true`): own ITMO.ID sign-ins send a desktop Chrome User-Agent, `false` the honest
  `ITMO Widgets MCP bot/<version>` label. Add `ITMO_WIDGETS_URL`.
- Every ITMO.Widgets request sends `X-Client: kind=mcp; ...`.
- Breaking: `ITMO_USERNAME` and `ITMO_PASSWORD` are removed. `ITMO_REFRESH_TOKEN` and `ITMO_KEYCLOAK_IDENTITY` stay;
  BARS tools need `ITMO_KEYCLOAK_IDENTITY`, since pairing never hands over the cookie.
- Library: `ToolDeps.widgets` is required.
