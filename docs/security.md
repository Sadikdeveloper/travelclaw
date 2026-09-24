# Security

TravelClaw 0.1 is a local desk. It does not authenticate clients.

- Bind to `127.0.0.1` if you do not trust the network. The default `0.0.0.0` is for the dev preview and Docker.
- Do not store card numbers, passport numbers, or medical details in memory or chat. The database is a plain SQLite file.
- Skills cannot run shell commands. Markdown is not executable. Keep it that way.
- Workspace writes are limited to the five persona files, and paths are checked against the workspace root.
- A live model key in `.env` is sent only to `TRAVELCLAW_MODEL_BASE_URL`. Skill HTTP calls go to Open-Meteo and Frankfurter when the network flag is on.
- Treat visa and safety text as a checklist. The desk is not an authority.

Pairing for non-local clients is the first item on the roadmap. Do not expose this process to the internet until that exists.
