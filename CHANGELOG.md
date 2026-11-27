# Changelog

## Unreleased

- `pair --itmo-cookie` and `renew --itmo-cookie` (also `setup --itmo-cookie`) use pairing protocol 2 (ITMO.Widgets
  ADR 0040): `clientId: "itmo-mcp"` and `grants` instead of `client` and `scopes`. `pair` asks for the `--scopes`
  as `widgets:*` grants (default `widgets:reviews:read`, `widgets:links:read`), then
  `itmo:refresh:student-personal-cabinet` and `itmo:sso`, none required; `renew` asks for the two ITMO grants. The
  user picks every grant on the phone. Without the flag the requests are protocol 1 exactly as before. Needs the
  Backend and app protocol 2 changes.
- The sealed bundle v2 is read next to v1: `clientId` must be `itmo-mcp`, `itmo.items` carry `grant`, `value` and
  `expiresAt`, unknown grants are ignored. The refresh token and the cookie (`itmo:sso`, the session's
  `KEYCLOAK_IDENTITY`) go to `state.json` (0600), the granted ITMO grants to the connection. With no ITMO grant the
  server is connected for `widgets_*` tools only and lists no `itmo_*` tools.
- With a cookie, pairing signs in silently once to my.itmo and checks that the tokens carry the bundle's `sid` and
  the owner's ISU; otherwise it ends that session and fails. With a refresh token the refresh canary runs as before.
- A paired server falls back to its cookie (silent sign-in, same `sid` check) when ITMO.ID refuses its refresh
  token, before it marks the session closed. BARS uses the paired session's cookie; a pairing without `itmo:sso`
  keeps using `ITMO_KEYCLOAK_IDENTITY` as before. `unpair` and a revoked connection end the session with its
  refresh token or one minted from the cookie, then wipe the token, the cookie and the connection.
- `pair` prints what it asks for and what stops working without each grant; `status`, the BARS errors and the
  server instructions name `itmo:sso` and `itmo-mcp renew --itmo-cookie` when BARS is out of reach.
- `pair` and `renew` no longer show a code to compare: once the phone opens the link they say to confirm there and
  sign in to ITMO. The phone shows the server's name, version and platform and asks to approve only a QR on the
  user's own screen. The wire is unchanged.
- The API research (`research/`) moved to [my-itmo-api/spec](https://github.com/alllexey-dev/my-itmo-api/tree/master/spec).
  `openapi/my-itmo.yaml` and `openapi/bars.yaml` are now copies of the specifications there: `npm run spec:sync`
  updates them, `npm run spec:check` and the weekly `spec-drift` workflow report a difference.

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
