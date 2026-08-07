# Problem Explorer Engine

A platform-agnostic **workspace diagnostics engine** — a reusable, provider-driven platform
that discovers, scans, and aggregates diagnostics (errors, warnings, info) across a workspace,
consumable by editor extensions, CLI tools, CI runners, AI assistants, and dashboards.

> **Status: WIP — pre-1.0.0.** Scaffolding in progress. Packages are not yet published.

---

## What it is

The engine extracts the diagnostics pipeline from *Problem Explorer v1* (a VS Code extension
that shows per-file problem counts in the explorer) into a standalone product:

- **Editor-agnostic** — zero runtime dependency on VS Code. A generic `Uri` interface keeps
  it compatible with `vscode.Uri` (and anything else) via structural typing.
- **Provider-agnostic** — scanners register against a public SDK. Ships with TypeScript,
  ESLint, Ruff, and a VS Code realtime adapter.
- **Multi-consumer** — the same engine powers an editor extension, a CLI, a CI step, an AI
  assistant, and a dashboard.
- **Publishable** — distributed as `@pe/*` npm packages, consumed like a library.

## Repositories

| Repo | Contents | Status |
|---|---|---|
| `problem-explorer-engine` | **This repo** — the engine monorepo | Active |
| `problem-explorer-vscode` | VS Code extension (Problem Explorer v2.0), depends on `@pe/api` | Planned |
| `problem-explorer-examples` | Node / CLI / VS Code / AI / Dashboard examples | Future |

---

## Packages

All packages are `@pe/*`-scoped. **Public** packages are published to npm; **internal**
packages are workspace-only. All public packages share a single version (changesets
`fixed` mode) — see [Versioning](#versioning).

| Package | npm name | Public | Purpose |
|---|---|---|---|
| `packages/core` | `@pe/core` | internal | Types, `Uri` interface, config validation, events, errors, `Result` |
| `packages/store` | `@pe/store` | internal | `ProblemStore` — current diagnostic state, gated writes, totals |
| `packages/workspace-index` | `@pe/workspace-index` | internal | Filesystem discovery owner: file list, mtimes, project roots |
| `packages/scheduler` | `@pe/scheduler` | internal | Provider registry, scan scheduler, capability-based queue |
| `packages/api` | `@pe/api` | **public** | The consumer surface — `DiagnosticsAPI` + stable types |
| `packages/provider-sdk` | `@pe/provider-sdk` | **public** | The contract external provider authors code against |
| `packages/providers/base` | `@pe/provider-base` | **public** | `BaseScannerProvider` — common config, spawning, lifecycle |
| `packages/providers/tsc` | `@pe/provider-tsc` | **public** | `tsc --noEmit` scanner |
| `packages/providers/eslint` | `@pe/provider-eslint` | **public** | `eslint --format=json` scanner |
| `packages/providers/ruff` | `@pe/provider-ruff` | **public** | `ruff check --output-format=json` scanner |
| `packages/providers/vscode-realtime` | `@pe/provider-vscode-realtime` | **public** | VS Code realtime diagnostics adapter |

## Architecture at a glance

```
core ─► store ─► scheduler ─► api ── (public consumer surface)
 │      ▲            ▲
 └──────┴──── workspace-index

provider-sdk (type-only dep on core)
 └─ provider-base ── provider-{tsc,eslint,ruff,vscode-realtime}
```

- **Internal** (`core`, `store`, `workspace-index`, `scheduler`) — private, free to break.
- **Public** (`api`, `provider-sdk`, `providers/*`) — published, stable.
- The dependency graph is **machine-enforced** by `pnpm check:deps` in CI. Forbidden edges
  (e.g. `scheduler → api`, any provider → internal packages, any runtime `vscode` dep) fail the build.
- `api` is a leaf: nothing depends on it internally. Providers sit **outside** the core and
  depend only on the SDK — adding a language never touches engine internals.

## Architectural rules

1. **Never modify core packages for a provider** — improve the provider abstraction instead.
2. **The scheduler never knows provider names** — it schedules *capabilities* (test-enforced).
3. **The cache never becomes a second store** — scan-memory is internal; consumers read the store.
4. **The workspace index owns discovery** — providers never walk the filesystem.
5. **The engine never crashes** — providers are isolated; failures become health transitions.
6. **The engine is editor-agnostic** — zero runtime `vscode` dependency.
7. **All public packages share one version** — changesets `fixed` mode.
8. **Strict dependency graph** — enforced in CI (`pnpm check:deps`).
9. **External providers depend only on `@pe/provider-sdk`.**
10. **Four scan types only** — Startup, Save, Manual, Periodic.
11. **TTL (24h) is a safety net, not a strategy** — staleness is event-driven.
12. **Ownership is computed, not configured** — capability + workspace + availability,
    with `ConfidenceTier` (WorkspaceScanner=3 > Realtime=2 > Fallback=1) and deterministic tie-breaks.

## Scan model

| Scan type | Trigger |
|---|---|
| `Startup` | Engine activation / workspace open |
| `Save` | File save (debounced, per file) |
| `Manual` | Consumer command |
| `Periodic` | Idle timer, lowest priority |

Scans are classified by **cost** (`cheap` <500ms, `medium` 0.5–3s, `expensive` >3s) and
scheduled with concurrency slots 4/2/1 — cheap scans parallelize, expensive scans serialize.

## Roadmap

| # | Milestone | Status |
|---|---|---|
| M1 | Foundation — monorepo, CI green, all packages compile | **In progress** |
| M2 | Storage & Index — ProblemStore, DiagnosticCache, WorkspaceIndex | Planned |
| M3 | Orchestration — Registry, Scheduler, DiagnosticsAPI | Planned |
| M4 | Providers — tsc, eslint, vscode-realtime run standalone | Planned |
| M5 | Extension Migration — swap Problem Explorer v1 internals | Planned |
| M6 | Architecture Proof — add Ruff with zero engine changes | Planned |
| M7 | Performance Validation — 10k/50k files | Planned |
| M8 | Release — engine v1.0.0 | Planned |

## Quick start

> Stub until packages are built — M1 is in progress.

```bash
pnpm install
pnpm build       # typecheck + build all packages (project references)
pnpm test        # vitest, all packages
pnpm check:deps  # dependency-graph enforcement
```

## Versioning

- Version bumps are managed with [Changesets](https://github.com/changesets/changesets)
  in **fixed mode**: all public `@pe/*` packages share one version, so compatibility is
  easy to reason about (`@pe/api 1.2.0` always pairs with `@pe/core 1.2.0`).
- On merge to `main`, CI versions and publishes automatically (npm token required).
- Internal packages are `private: true` and never published.

## Contributing

- Read the **strict rules** above before touching code.
- The dependency graph is enforced — a new edge is a design discussion, not a code change.
- Add a changeset (`pnpm changeset`) for any public-package change.
- CI runs, in order: lint → typecheck → build → unit tests → integration tests → version → publish.
  No stage publishes if any earlier stage fails.

## License

[MIT](./LICENSE) — Copyright (c) 2026 Problem Explorer Engine Contributors
