# Security

TravelClaw 0.1 authenticates the control UI with an email/password (and optional
Google) account, or a no-signup guest identity, and gates remote API clients with device pairing. Read Pairing below before you
expose this past your own machine.

- Bind to `127.0.0.1` if you do not trust the network. The default `0.0.0.0` is for the dev preview and Docker.
- Do not store card numbers, passport numbers, or medical details in memory or chat. The database is a plain SQLite file.
- Tools cannot run shell commands. Keep it that way.
- Workspace writes are limited to the five persona files, and paths are checked against the workspace root. A per-agent override lives under `workspace/agents/<id>/`; the agent id is one validated lowercase segment, so it cannot climb out of the workspace, and `GET /api/workspace?agentId=` reports which file backs each slot.
- A live model key in `.env` is sent only to `TRAVELCLAW_MODEL_BASE_URL`. Tool HTTP calls go to Open-Meteo and Frankfurter by default when the network flag is on; an operator connector may repoint one at a compatible base URL (see Connectors).
- Treat visa and safety text as a checklist. The desk is not an authority.

## Accounts

- Passwords are hashed with Argon2id (`apps/api/src/auth/password.ts`, via `hash-wasm`), OWASP's current first-choice algorithm, salted per user with parameters from OWASP's Password Storage Cheat Sheet (m=19 MiB, t=2, p=1). The plaintext password is never written to disk or logged. A hash minted by an earlier build of this branch with scrypt still verifies and is transparently upgraded to Argon2id the next time that account logs in.
- A session is a random 256-bit token. Only its SHA-256 hash is stored (`auth_sessions`); the browser holds the raw token in an `HttpOnly`, `SameSite=Lax` cookie so client-side JavaScript cannot read it and a plain cross-site form post cannot ride along.
- Set `TRAVELCLAW_COOKIE_SECURE=1` once you are behind HTTPS so that cookie is also marked `Secure`. It defaults to off for local http development.
- Login and registration are rate-limited per caller. Login failures return the same generic error whether the email does not exist, the password is wrong, or the account only has a Google sign-in — that keeps a failed attempt from confirming whether an email is registered.
- A chat (`sessions` row) belongs to exactly one account. A request for another account's chat id gets a 404, the same response as a chat that does not exist.
- Google sign-in is opt-in per deploy: it only activates when the operator sets `TRAVELCLAW_GOOGLE_CLIENT_ID`. The credential's RS256 signature is verified locally against Google's published JWKS (`apps/api/src/auth/google-verify.ts`), not by calling Google's `tokeninfo` endpoint per login, and the gateway checks issuer, expiry, audience, and the verified-email claim before trusting it.
- There is no password reset flow yet and no email is ever sent. A traveler who forgets a password needs a new account or a direct database fix.

## Guests

- A visitor who has not signed in is auto-provisioned a guest account (`POST /api/auth/guest`) rather than being forced through registration. It is a real `users` row (so chat, tasks, and history all work normally) but with no password, no Google id, and `is_guest = 1` — there is nothing in it worth stealing, and nothing in it identifies a person.
- Guest account creation is rate-limited per IP (60/hour) since, unlike a real registration, it costs an attacker nothing to repeat. The number is loose on purpose: a household shares one address, and behind a reverse proxy every visitor can look like one caller. Guest turns, not guest creation, are what bound spend.
- Chat turns are paced **per model**, not by the desk. A limit is a property of a model: the desk's own model runs in this process, costs nothing per turn, and is therefore not paced at all, while a model with a provider bill behind it carries a guest and an account allowance in `apps/api/src/models/model-catalog.ts`. Where a model is paced, a bigger, costlier one is rationed tighter than a small one, an account's allowance is several times a guest's on the same model, and guests are additionally capped per IP across priced models so that minting a fresh guest does not dodge a model's pace. The model is the desk's choice, not the traveler's — a guest cannot select one, a signed-in account does not get to either, and a request that names one is refused. `GET /api/models` publishes each model's limits, or `null` where there is nothing to pace.
- A session token travels two ways: an HttpOnly `SameSite=Lax` cookie (primary) and, for clients that cannot keep cookies, the same token as `Authorization: Bearer`, returned as `sessionToken` by the sign-in and guest routes. The control UI keeps that copy in `localStorage`, so it is readable by any script running on the page — weaker than the cookie, and accepted deliberately, because an embedded preview (a cross-site iframe, or third-party cookies blocked) otherwise cannot hold a session at all. The cookie wins whenever both are present, sign-out revokes the token server-side and clears the stored copy, and only the token's hash is ever written to `auth_sessions`.
- A caller that presents no credential at all — no cookie, no bearer token — is recognised by its address plus user agent for up to twelve hours, so an embedded frame that refuses both cookies and storage still gets one guest session instead of a new one per request. Cookies and tokens always win, and a _stale_ token never falls back to the pin, so signing out sticks. This is a deliberate trade: guests are ephemeral and turn-limited, and two people behind one address on identical browsers would share one guest session — sign in for a private account.
- Because of that, cross-origin callers are no longer reflected: the gateway answers only the origins in `TRAVELCLAW_ALLOWED_ORIGINS`, and no origin at all by default. An origin-reflecting policy with credentials would let any site reach the guest inferred from the connection.
- A limit is a pace, not an authentication demand. The 429 from guest minting and from a guest turn says what the limit is and that an account is optional, and the control UI shows it with a retry rather than a sign-in page. An expired cookie is recovered in place (`setSessionRecovery` in `apps/web/src/api.ts`), so `unauthenticated` reaches a traveler only when a real account's session has ended.
- A guest's chats are mirrored into that browser's `localStorage` purely for a fast reload; the server-side row under its guest id is still what actually runs each turn and is the source of truth. Clearing that browser's storage or cookies does not delete anything server-side, but nothing else can read it back either — sign in to keep it.
- Registering, signing in, or completing Google sign-in from a guest session folds that guest's chats into the resulting account (in place when it is a brand-new account, by reassigning `sessions` rows when it is an existing one) — see `AuthService.absorbGuest` in `apps/api/src/auth/auth.service.ts`. A failed sign-in attempt never touches the guest or its chats.

## Connectors

- Connector secrets live in the operator's env, alongside the model key — never in SQLite, and never provided by the traveler. There is no HTTP surface for reading or writing them.
- The secret is never logged, never persisted into a chat message or tool trace, and never placed in the model prompt. Tools send it only as an `Authorization: Bearer` header to the connector's own base URL — never as a query parameter, where it would land in logs. A rejection warning names the connector, never the key.
- A connector cannot introduce new code, new tool definitions, new prompt text, or new destinations beyond its own base URL — the path and parameters stay the tool's. Non-http base URLs are ignored at call time.

## Pairing

Cookie sign-in secures the control UI in a browser, and the **device token** below
gates non-loopback listeners. They are separate layers and do not replace each other.

- `TRAVELCLAW_DEVICE_TOKEN` sets a shared secret that any non-loopback caller must
  present on every HTTP request and WebSocket connection. Only **direct** loopback
  peers with no forwarding headers and not listed as trusted proxies are exempt.
  - HTTP clients send it in the `X-Device-Token` header.
  - WebSocket clients send it as the `deviceToken` query parameter on the handshake
    (or as the same header, when using a long-polling path that carries custom headers).
- When `TRAVELCLAW_DEVICE_TOKEN` is _unset_ and a non-loopback request arrives, the
  gateway answers `401 pairing_required` with a message that names the env var and
  points at `HOST=127.0.0.1` for local-only use — rather than silently opening on
  `0.0.0.0` with no gate. This is the safe default while the gateway binds all
  interfaces for the dev preview and Docker.
- The raw token is hashed with SHA-256 at boot; only the hash is kept in memory, and
  incoming tokens are compared with `crypto.timingSafeEqual` against that hash. The
  token never appears in error bodies or logs, and a caller-presented wrong token is
  never echoed back.
- `/health` is exempt from pairing so container / load-balancer liveness probes work
  without a token.
- Set `TRAVELCLAW_TRUST_PROXY=1` **and** `TRAVELCLAW_TRUSTED_PROXIES` to a comma-separated
  list of the proxy IPs/CIDRs you operate. For a same-host proxy, for example:
  `TRAVELCLAW_TRUSTED_PROXIES=127.0.0.1/32,::1/128`. Use exact addresses where possible;
  never trust client networks. An empty list, invalid address, `/0`, or named alias
  refuses startup in proxy mode. Docker port publication alone does not justify
  trusting forwarded headers; list only an actual HTTP reverse proxy.
- Express resolves the caller right-to-left from the TCP peer, stopping at the first
  untrusted hop. This identity is used for rate limits and guest pins. Headers from
  an untrusted peer cannot override its identity.
- Pairing **does not use forwarded client identity**. A configured proxy must always
  pair, even if it sends no `X-Forwarded-For` or claims its client was `127.0.0.1`.
  Forwarding headers (`X-Forwarded-For`, `Forwarded`, `X-Real-IP`) also remove the
  direct-loopback exemption. HTTP and WebSocket use the same policy.
- Your ingress must overwrite untrusted forwarding headers or append the actual
  connecting peer, and restrict direct access to the gateway. If a proxy strips all
  forwarding headers and is not listed, a same-host proxy is indistinguishable from
  a local caller; no application can infer that missing topology.
- **Migration:** deployments that previously used only `TRAVELCLAW_TRUST_PROXY=1`
  must now add the explicit proxy list. Configure clients to send the device token
  on both HTTP and WebSocket; do not publish the operator token in frontend code.
  A proxy that injects it is itself a paired client and must authenticate/restrict
  downstream callers, not turn a publicly reachable ingress into an open gateway.
  Restart after changing these settings.
- WebSocket query tokens can be captured by reverse-proxy access logs. Redact query
  strings on `/socket.io` (including failed handshakes), or use a header-capable
  client. Application errors never echo the token.
- Deploy TLS termination in front of the gateway. The device token is a bearer secret
  and must travel over HTTPS — the gateway itself speaks plain HTTP, on purpose.

A channel bot, a CLI, or a second box is a paired client first, and may then
authenticate a user session inside that pairing. The pairing gate runs before
account/guest auth and before any route handler, on both HTTP and WebSocket.

## Browser research (opt-in)

- The public-search browser is a separate worker, never the gateway's process or a
  traveler's existing profile. Keep its RPC private, authenticate the gateway with
  a dedicated worker token, and run it without gateway files or provider/model keys.
- Chromium sandboxing is mandatory in production. No automatic sandbox bypass,
  stealth/CAPTCHA solving, password entry, arbitrary evaluate, shell, upload or
  checkout tool is exposed. Blockers produce a handoff instead of an evasion attempt.
- Context-wide HTTP interception uses an origin/method policy and a DNS-pinned Node
  transport; native browser network traffic is directed to a dead proxy. DNS checks
  alone are not enough to secure Chromium navigation. Add infrastructure-level
  isolation from private networks; application checks are not a browser-exploit sandbox.
- Snapshot text remains untrusted. The browser-only model loop has no memory, connector
  or general tool access. Actions/bytes/time/contexts are bounded outside the model.
- Price observations are stored separately from offers, are not holdable, and carry
  visible evidence and source/time labels. Exact text matching is not an assurance
  of checkout availability or complete conditions.
- Reusable procedures accept only finite step names and travel-field slots, start
  pending, and require an operator's local review before reuse. No search values,
  page text, cookies or credentials can fit the procedure schema.
- See [setup, threat boundaries and outstanding validation](browser-agent.md) and the
  [Hermes/OpenClaw research decisions](browser-research.md). Do not interpret the
  fixture test results as a production audit or a demonstrated live airline search.
