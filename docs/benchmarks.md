# Benchmarks — Problem Explorer Engine (M7)

Measured with `scripts/bench/engine-bench.mjs` (`pnpm bench`) on a Windows 11
laptop (Node 22+, dist build). Times exclude fixture generation.

Harness: `DiagnosticsAPI` with a **synthetic provider** (no external tools):
every 10th file carries one error, the rest are clean. Workspaces are
generated in a temp dir and removed after each run.

## Target numbers (1.0 release spec)

| Metric | 10k files | 50k files | Scaling (linear ≈ 5x) |
|---|---|---|---|
| Startup (index + rebuild) | < 1 s | < 4 s | ≤ 6x |
| Full scan (idle→idle) | < 300 ms | < 1.5 s | ≤ 8x |
| `getTotals()` per call | < 50 µs | < 50 µs | ~1x |
| `getProblems(folder)` per call | < 1 ms | < 5 ms | ≤ 6x |
| `getProblems(file)` per call | < 100 µs | < 100 µs | ~1x |
| Heap growth (whole run) | < 100 MB | < 150 MB | ~n |

## Recorded measurement (Aug 08 2026, Node 25.9, Windows 11)

```
-- 10,000 files --
  index            555.0 ms
  full scan        126.8 ms
  getTotals        0.000 ms (per call)
  getProblems(src) 0.014 ms (per call)
  getProblems(file) 0.000 ms (per call)
  heap growth      25.4 MB
-- 50,000 files --
  index            2479.7 ms
  full scan        529.5 ms
  getTotals        0.000 ms (per call)
  getProblems(src) 0.002 ms (per call)
  getProblems(file) 0.000 ms (per call)
  heap growth      86.7 MB
-- linear-scaling check (50k vs 10k) --
  indexMs: 4.5x   scanMs: 4.2x   totalsMs: 0.4x   folderMs: 0.1x   fileMs: 0.6x
```

Verdict: **no O(n²) hot paths under the 5x workload** — scan and startup
scale linearly (4.2x / 4.4x for 5x the files), all queries stay O(1) per call as designed, memory stays well under budget.

## History — the O(n²) that the benchmark caught (and the fix)

Initial runs before the fix:

| | 10k | 20k | 50k |
|---|---|---|---|
| full scan | ~150 ms | ~1.7 s | **4.2 s (23x for 5x files)** |

Root cause: `normalizeUriKey` in `@pe/core` cached normalized keys in an
`LRUCache<string, string>` of 10 000 entries. Every lookup beyond the cache
size did a `Map.delete + Map.set` (LRU maintenance) — the whole-workspace
scan path normalizes one key per file, so scanning N files degenerated to
O(N²) LRU churn.

Fix (dedicated to M7): replace the LRU with a `WeakMap<Uri, string>` keyed
by the Uri object — O(1) amortized lookups, no eviction, entries die with
their Uri (no unbounded growth). `clearUriKeyCache()` stays as a no-op for
API compatibility.

Result: 50k full scan 4241 ms → **530 ms**, scaling below the 5x linear
line. No other stage showed superlinear behavior under the profiler.

## Running

```bash
pnpm build && pnpm bench          # 10k + 50k
pnpm bench -- --files=20000       # single custom size
```

The script exits non-zero when any phase exceeds its budget (loud
watchdog, deliberately generous) or the 50k/10k ratio exceeds 15x
(5x expected for linear work, 25x for O(n²)).