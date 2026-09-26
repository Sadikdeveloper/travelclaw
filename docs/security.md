# Security

TravelClaw 0.1 authenticates the control UI with an email/password (and optional
Google) account, but it still does not authenticate arbitrary API clients — see
Pairing below before you expose this past your own machine.

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

## Pairing (still open)

Cookie sign-in secures the control UI in a browser. It does **not** replace a device
token for other, non-browser clients (a channel bot, a CLI, a second box) — that is
still the pairing-auth roadmap item. Do not expose this gateway to the internet before
that exists.
