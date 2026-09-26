# Security

TravelClaw 0.1 authenticates the control UI with an email/password (and optional
Google) account, or a no-signup guest identity, but it still does not authenticate
arbitrary API clients — see Pairing below before you expose this past your own machine.

- Bind to `127.0.0.1` if you do not trust the network. The default `0.0.0.0` is for the dev preview and Docker.
- Do not store card numbers, passport numbers, or medical details in memory or chat. The database is a plain SQLite file.
- Tools cannot run shell commands. Keep it that way.
- Workspace writes are limited to the five persona files, and paths are checked against the workspace root.
- A live model key in `.env` is sent only to `TRAVELCLAW_MODEL_BASE_URL`. Tool HTTP calls go to Open-Meteo and Frankfurter when the network flag is on.
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
- Chat turns are paced **per model and per tier**, in ten-minute windows: each model in the catalog carries its own guest and account allowance, so a bigger, costlier model is rationed tighter than a small one, and running out on one model does not take another away. A signed-in account's allowance is several times a guest's on every model — that is what signing in buys. Guests are additionally capped per IP across all models, so a guest that hits a model's pace and mints a fresh guest to dodge it still hits the address-wide cap. The catalog and the numbers live in `apps/api/src/models/model-catalog.ts` and are served by `GET /api/models`.
- A session token travels two ways: an HttpOnly `SameSite=Lax` cookie (primary) and, for clients that cannot keep cookies, the same token as `Authorization: Bearer`, returned as `sessionToken` by the sign-in and guest routes. The control UI keeps that copy in `localStorage`, so it is readable by any script running on the page — weaker than the cookie, and accepted deliberately, because an embedded preview (a cross-site iframe, or third-party cookies blocked) otherwise cannot hold a session at all. The cookie wins whenever both are present, sign-out revokes the token server-side and clears the stored copy, and only the token's hash is ever written to `auth_sessions`.
- A caller that presents no credential at all — no cookie, no bearer token — is recognised by its address plus user agent for up to twelve hours, so an embedded frame that refuses both cookies and storage still gets one guest session instead of a new one per request. Cookies and tokens always win, and a _stale_ token never falls back to the pin, so signing out sticks. This is a deliberate trade: guests are ephemeral and turn-limited, and two people behind one address on identical browsers would share one guest session — sign in for a private account.
- Because of that, cross-origin callers are no longer reflected: the gateway answers only the origins in `TRAVELCLAW_ALLOWED_ORIGINS`, and no origin at all by default. An origin-reflecting policy with credentials would let any site reach the guest inferred from the connection.
- A limit is a pace, not an authentication demand. The 429 from guest minting and from a guest turn says what the limit is and that an account is optional, and the control UI shows it with a retry rather than a sign-in page. An expired cookie is recovered in place (`setSessionRecovery` in `apps/web/src/api.ts`), so `unauthenticated` reaches a traveler only when a real account's session has ended.
- A guest's chats are mirrored into that browser's `localStorage` purely for a fast reload; the server-side row under its guest id is still what actually runs each turn and is the source of truth. Clearing that browser's storage or cookies does not delete anything server-side, but nothing else can read it back either — sign in to keep it.
- Registering, signing in, or completing Google sign-in from a guest session folds that guest's chats into the resulting account (in place when it is a brand-new account, by reassigning `sessions` rows when it is an existing one) — see `AuthService.absorbGuest` in `apps/api/src/auth/auth.service.ts`. A failed sign-in attempt never touches the guest or its chats.

## Pairing (still open)

Cookie sign-in secures the control UI in a browser. It does **not** replace a device
token for other, non-browser clients (a channel bot, a CLI, a second box) — that is
still the pairing-auth roadmap item. Do not expose this gateway to the internet before
that exists.
