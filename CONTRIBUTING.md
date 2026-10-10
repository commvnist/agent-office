# Contributing

## Dev loop

```sh
npm install
npm test                      # node --test, native TS, no build step
npm run check:compliance      # observe-only guardrail
npm run typecheck             # tsc --noEmit (advisory for now)
npm run server                # daemon on 127.0.0.1:4747
npm run dev -w @agent-office/web   # Vite dev server proxying the daemon
npm run demo                  # fake sessions against the daemon
```

Node 22+ is required (native TypeScript type stripping).

## Rules (ponytail)

- Smallest complete change; reuse before writing; no speculative options or abstractions.
- New non-trivial logic gets a small `node --test` test next to it (`*.test.ts` / `*.test.mjs`).
- A known shortcut gets `// shortcut: <limit>, <when to upgrade>`.
- Observe-only: never read `~/.claude` credentials, spawn `claude`, or call the Anthropic API. Bind loopback only. Treat displayed text as untrusted.
- Keep `docs/improvements.md` status current.

## Where things go

- **Roles / rosters**: add a pack under `plugin/packs/<name>/pack.json` plus its agent `.md` files (each must end with the `DONE:`/`BLOCKED:` contract); apply with `scripts/apply-pack.mjs`. Subagent definitions live in `plugin/agents`.
- **Themes**: theme packs are JSON in `~/.agent-office/themes/<name>.json` (loader in progress, see `docs/improvements.md` #71).
- **Sprites**: procedural, in `packages/web/src/sprites.ts` and `pixel.ts`.
- **Event sources**: hook payload mapping lives only in `packages/server/src/adapter.ts`.
