# Third-party material

`apps/browser-worker/seccomp_profile.json` is from Microsoft Playwright v1.63.0:
https://github.com/microsoft/playwright/blob/v1.63.0/utils/docker/seccomp_profile.json

Copyright Microsoft Corporation and contributors. Licensed under Apache-2.0;
the license is included in `playwright-LICENSE` in this directory. The profile is
unmodified except repository formatting. Review it with the host's security policy
before deployment; it enables the syscalls required for Chromium user namespaces.

Hermes and OpenClaw were consulted for design patterns, not vendored or embedded as
agent runtimes. See `docs/browser-research.md` for commit-pinned source references,
the licenses inspected, and the adaptation decisions. No Hermes/OpenClaw source
or skill text has been copied into TravelClaw's runtime or prompts.
