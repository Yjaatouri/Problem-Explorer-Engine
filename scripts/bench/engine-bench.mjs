// M7 performance harness — 10k / 50k file workspaces through the consumer
// surface (DiagnosticsAPI): startup, full-scan latency, query latency, memory.
//
// Run after `pnpm build`:
//   pnpm bench                        # 10k + 50k
//   pnpm bench -- --files=20000       # custom size
//
// Uses a synthetic provider (no external binaries): every 10th file is marked
// with one error, the 9 remaining clean — a realistic mixed workspace. The
// generator runs outside the measured windows. Exits non-zero when a phase
// exceeds its budget or the 5x file growth scales beyond 15x (the
// "no O(n^2)" check — linear is ~5x).

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { ConfidenceTier, ProblemSeverity, ProviderHealth, ScanType } from '../../packages/core/dist/index.js'
import { DiagnosticsAPI } from '../../packages/api/dist/index.js'

const DEFAULT_SIZES = [10_000, 50_000]
// Fail line for the scaling check: ~5x is linear; 25x is O(n^2). 15x = slack.
const SCALE_RATIO_LIMIT = 15

// Generous wall-clock budgets — loud watchdog, not a spec (spec numbers live
// in docs/benchmarks.md).
const BUDGETS = {
  indexMs: 60_000,
  scanMs: 30_000,
  folderMs: 2_000,
  fileMs: 2_000,
  heapDeltaMb: 1_200,
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitUntilIdle(api, timeoutMs = 120_000) {
  const start = performance.now()
  while (api.runningCount > 0 || api.queuedCount > 0) {
    if (performance.now() - start > timeoutMs) {
      throw new Error('bench: engine never reached idle')
    }
    await sleep(2)
  }
}

function makeProvider() {
  return {
    id: 'bench',
    displayName: 'Bench',
    capabilities: {
      confidenceTier: ConfidenceTier.WorkspaceScanner,
      supportedConfigTypes: ['typescript'],
      workspaceScan: true,
      incrementalScan: true,
      realtime: false,
      extensions: ['.ts'],
      cost: 'cheap',
    },
    configSchema: { type: 'object', properties: {} },
    defaultConfig: {},
    healthCheck: async () => ({ health: ProviderHealth.Ready }),
    scan: async (context) => ({
      changedUris: context.uris ?? [],
      files: (context.uris ?? []).map((uri, i) =>
        i % 10 === 0
          ? {
              uri,
              diagnostics: [
                {
                  severity: ProblemSeverity.Error,
                  source: 'bench',
                  code: 'BENCH-ERR',
                  message: 'benchmark error',
                  line: 1,
                  column: 1,
                },
              ],
            }
          : { uri, diagnostics: [] },
      ),
    }),
  }
}

function fileUri(fsPath) {
  const slash = fsPath.replace(/\\/g, '/')
  return {
    scheme: 'file',
    authority: '',
    path: slash,
    fsPath,
    toString: () => `file:///${slash}`,
    with: (change) => fileUri(change.path ?? fsPath),
  }
}

function generateWorkspace(fileCount) {
  const dir = mkdtempSync(join(tmpdir(), 'pe-bench-'))
  mkdirSync(join(dir, 'src'))
  for (let i = 0; i < fileCount; i++) {
    writeFileSync(join(dir, 'src', `file${i}.ts`), `export const value${i}: number = ${i};\n`)
  }
  return dir
}

async function oneRun(fileCount) {
  const dir = generateWorkspace(fileCount)
  const heapBefore = process.memoryUsage().heapUsed

  const indexT0 = performance.now()
  const api = new DiagnosticsAPI({
    workspaceRoot: fileUri(dir),
    providers: [makeProvider()],
    config: { scanTimeoutMs: 120_000, debounceMs: 1, batchMs: 5 },
  })
  const indexMs = performance.now() - indexT0

  const scanT0 = performance.now()
  await api.scan(ScanType.Manual)
  const scanSubmittedMs = performance.now() - scanT0
  while (api.runningCount === 0 && api.queuedCount === 0) {
    await sleep(1)
  }
  const scanFirstJobMs = performance.now() - scanT0
  await waitUntilIdle(api)
  const scanMs = performance.now() - scanT0

  const totals = api.getTotals()
  const folderUri = fileUri(join(dir, 'src'))
  const fileUriSample = fileUri(join(dir, 'src', `file${Math.floor(fileCount * 0.37)}.ts`))

  let t0 = performance.now()
  for (let i = 0; i < 2000; i++) {
    api.getTotals()
  }
  const totalsMs = (performance.now() - t0) / 2000

  t0 = performance.now()
  for (let i = 0; i < 20; i++) {
    api.getProblems(folderUri)
  }
  const folderMs = (performance.now() - t0) / 20

  t0 = performance.now()
  for (let i = 0; i < 2000; i++) {
    api.getProblems(fileUriSample)
  }
  const fileMs = (performance.now() - t0) / 2000

  const heapDeltaMb = (process.memoryUsage().heapUsed - heapBefore) / 1048576
  api.dispose()
  rmSync(dir, { recursive: true, force: true })

  return {
    fileCount,
    indexMs,
    scanMs,
    scanSubmittedMs,
    scanFirstJobMs,
    totalsMs,
    folderMs,
    fileMs,
    heapDeltaMb,
    errors: totals.errors,
  }
}

function assertPhaseBudgets(r, budgets) {
  const rows = [
    ['index', r.indexMs, budgets.indexMs],
    ['scan', r.scanMs, budgets.scanMs],
    ['folder query', r.folderMs, budgets.folderMs],
    ['file query', r.fileMs, budgets.fileMs],
    ['memory', r.heapDeltaMb, budgets.heapDeltaMb],
  ]
  for (const [label, measured, budget] of rows) {
    const ok = measured <= budget
    console.log(`  ${ok ? 'pass' : 'FAIL'} ${label} budget: ${measured.toFixed(1)} <= ${budget}`)
    if (!ok) {
      process.exitCode = 1
    }
  }
}

async function main() {
  const custom = process.argv.find((arg) => arg.startsWith('--files='))
  const sizes = custom !== undefined ? [Number(custom.split('=')[1])] : DEFAULT_SIZES

  console.log(`\nM7 engine benchmark — files: ${sizes.join(', ')}`)
  console.log('DiagnosticsAPI with a synthetic provider; times exclude fixture generation\n')

  const results = []
  for (const size of sizes) {
    console.log(`-- ${size.toLocaleString('en-US')} files --`)
    const r = await oneRun(size)
    results.push(r)
    console.log(`  index            ${r.indexMs.toFixed(1)} ms`)
    console.log(`  full scan        ${r.scanMs.toFixed(1)} ms`)
    console.log(`    plan/submit    ${r.scanSubmittedMs.toFixed(1)} ms`)
    console.log(`    first job      ${r.scanFirstJobMs.toFixed(1)} ms`)
    console.log(`  getTotals        ${r.totalsMs.toFixed(3)} ms (per call)`)
    console.log(`  getProblems(src) ${r.folderMs.toFixed(3)} ms (per call)`)
    console.log(`  getProblems(file) ${r.fileMs.toFixed(3)} ms (per call)`)
    console.log(`  heap growth      ${r.heapDeltaMb.toFixed(0)} MB`)
    console.log(`  errors surfaced  ${r.errors}`)
    assertPhaseBudgets(r, BUDGETS)
  }

  if (results.length === 2) {
    const [small, large] = results
    console.log('\n-- linear-scaling check (50k vs 10k: ~5x linear, >15x is O(n^2)) --')
    for (const key of ['indexMs', 'scanMs', 'totalsMs', 'folderMs', 'fileMs']) {
      const ratio = small[key] !== 0 ? large[key] / small[key] : 0
      const ok = ratio < SCALE_RATIO_LIMIT
      console.log(`  ${ok ? 'pass' : 'FAIL'} ${key}: ${ratio.toFixed(1)}x`)
      if (!ok) {
        process.exitCode = 1
      }
    }
  }
  console.log('')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})