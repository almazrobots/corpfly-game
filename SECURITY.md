# Security Policy

## Reporting a vulnerability

Please report security issues through **GitHub's private vulnerability reporting**
(the *Security* tab → *Report a vulnerability*). This keeps the report private
until a fix is available.

Do not open a public issue for a security problem, and do not include real
credentials or another person's data in a report.

## Scope

This repository contains a Telegram Mini App: a client-side canvas game plus a
small HTTP API that verifies Telegram `initData` and stores an anonymous
leaderboard.

Particularly relevant areas:

- **`server/src/initdata.js`** — signature verification. This is the entire
  authentication surface of the project. Any bypass is high severity.
- **`server/src/identity.js`** — anonymisation. Players are public only as
  `#<activation number> <two initials>`. Any path that exposes a Telegram user
  id, username or full name is a privacy defect, not a feature request.
- **`server/src/api.js`** — rate limiting and input validation.

## Known and accepted limitations

- **Scores are reported by the client.** The server checks plausibility against
  elapsed time and a hard ceiling derived from the game's physics, but a
  determined player can still inflate their own score within those bounds.
  Fully closing this would require replaying the run server-side. The game
  engine is already a pure, deterministic module with an injectable RNG, which
  is what such a check would build on.
- **`initData` is valid for 24 hours** and cannot be revoked individually;
  rotating the bot token invalidates all of them at once.
- **Identification is pseudonymous, not anonymous.** In a small group, an
  activation number plus two initials may be enough to recognise someone.

## Running your own instance

Never reuse the production bot token. Create your own bot, keep the token out
of the repository, and pass it as `BOT_TOKEN` at runtime.
