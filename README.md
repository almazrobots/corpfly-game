# CORPFLY

A Telegram Mini App: 166,700 neurons of a male fruit fly versus the enterprise.
Tap to flap, dodge the buzzwords, grab the budget — do not fall, the floor is burnout.

<!-- Canvas game, no build step, no runtime dependencies. -->

## What it is

A small arcade runner that happens to be a complete, production-shaped Telegram
Mini App: signature verification, an anonymous leaderboard, a bot, containers,
and a test suite that actually blocks a bad release.

- **The game** is plain ES modules and a `<canvas>`. No bundler, no framework.
- **The API** is `node:http` and `node:sqlite`. **Zero runtime dependencies** —
  `npm` is needed for tests and linting only, and is removed from the production image.
- **The bot** uses long polling, so there is no inbound webhook to secure.

## Anonymous by design

A player is public **only** as `#<activation number> <two initials>` — for example
`#43 AS`. The number is assigned once, on first contact, and never changes.

No Telegram id, username, first or last name, or profile link appears in any API
response. Cyrillic names are transliterated to Latin so the board reads as one alphabet.

This is enforced, not promised: `tests/api.test.js` asserts that no response body
contains an id, a surname or a username, and the CI gate repeats that check against
a running container.

> It is **pseudonymity**, not anonymity. In a group of fifty people, "who joined
> third" plus two initials may well identify someone. Know that before you deploy
> this inside a company.

## Scoring

| Source | Points |
|---|---|
| Blocker passed | 10 |
| Budget coin | 5 |

Pickups appear in the corridor behind each pair of blockers:

| Pickup | Effect |
|---|---|
| **BUDGET** | points, and a collected-budget counter |
| **EXEC SPONSOR** | 5 s of passing straight through blockers (the floor still kills) |
| **DEADLINE SLIP** | 4.5 s of the world moving at 60% speed |
| **OKR ×2** | 8 s of double points |

## Running it

```bash
npm install
make check        # lint + unit tests — the fast gate
make e2e          # playwright against a real API process
```

Play locally in a browser (no Telegram, so the leaderboard stays offline):

```bash
CORPFLY_DB=:memory: BOT_TOKEN=dev:token PORT=8261 node server/src/server.js &
node tools/devstatic.js     # http://127.0.0.1:41731
```

## Self-hosting

1. Create a bot with [@BotFather](https://t.me/botfather) and keep the token out of git.
2. Put it in `deploy/.env`:

   ```
   BOT_TOKEN=123456:your-own-token
   APP_URL=https://your-domain.example
   ```

3. Bring the stack up:

   ```bash
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
   ```

4. Terminate TLS in front of it and route `/api/*` to the API — see
   `deploy/Caddyfile.example`. Telegram requires HTTPS for Mini Apps.

The bot configures its own menu button on startup, so `APP_URL` must be reachable
before you start it.

**Never reuse someone else's bot token.** It is the single key that verifies every
player's identity.

### Two things that will bite you

- **Do not send `X-Frame-Options: DENY`.** Telegram Web opens a Mini App inside an
  iframe, and that header breaks every web client. Restrict the frame with
  `Content-Security-Policy: frame-ancestors` instead, as `deploy/nginx.conf` does.
- **In nginx, `add_header` inside a `location` cancels every inherited one.** Put a
  cache header in `location = /index.html` and the page silently ships with no CSP
  at all. That is why this config computes cache control through a `map` and keeps
  all headers at one level.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Tests

213 unit and property tests (vitest + fast-check) and 16 end-to-end tests
(playwright, mobile viewport). Coverage sits near 97% of lines and 92% of branches
on the core modules, with thresholds enforced in CI.

The suite is layered deliberately: an independent oracle re-derives the Telegram
signature through WebCrypto rather than the same `node:crypto` path the app uses;
fault injection makes the database throw and asserts the failure is loud rather
than silent; a regression corpus in `tests/fixtures/` replays every hostile input
that once broke something.

## Licence

MIT — see [LICENSE](LICENSE). Security policy: [SECURITY.md](SECURITY.md).
