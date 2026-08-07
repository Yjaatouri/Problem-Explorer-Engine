// Enforces the allowed dependency graph of §3.1 in agentRead.md / README.md.
// Usage: node scripts/check-dependency-graph.mjs
// Exits 1 on any violation. Wired as `pnpm check:deps` (runs first in CI's lint stage).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const pkgDir = join(root, 'packages');

// package name -> allowed internal @pe/* dependencies
const ALLOWED_EDGES = {
  '@pe/core': [],
  '@pe/store': ['@pe/core'],
  '@pe/workspace-index': ['@pe/core'],
  '@pe/impact-analyzer': ['@pe/core', '@pe/workspace-index'],
  '@pe/scheduler': ['@pe/core', '@pe/store'],
  '@pe/api': [
    '@pe/core',
    '@pe/store',
    '@pe/scheduler',
    '@pe/impact-analyzer',
    '@pe/workspace-index',
  ],
  '@pe/provider-sdk': ['@pe/core'],
  '@pe/provider-base': ['@pe/core', '@pe/provider-sdk'],
  '@pe/provider-tsc': ['@pe/core', '@pe/provider-base', '@pe/provider-sdk'],
  '@pe/provider-eslint': ['@pe/core', '@pe/provider-base', '@pe/provider-sdk'],
  '@pe/provider-ruff': ['@pe/core', '@pe/provider-base', '@pe/provider-sdk'],
  '@pe/provider-vscode-realtime': ['@pe/core', '@pe/provider-base', '@pe/provider-sdk'],
};

// packages that may use the vscode module at runtime (devDependency only)
const VSCODE_RUNTIME_ALLOWED = new Set(['@pe/provider-vscode-realtime']);

const violations = [];
const packages = new Map();

function readManifest(dir) {
  const manifestPath = join(dir, 'package.json');
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

function collectPackages(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = readManifest(join(dir, entry.name));
    if (manifest && manifest.name) {
      packages.set(manifest.name, { dir: join(dir, entry.name), manifest });
    }
    if (entry.name === 'providers') collectPackages(join(dir, entry.name));
  }
}

collectPackages(pkgDir);

for (const [name, { manifest }] of packages) {
  if (!(name in ALLOWED_EDGES)) {
    violations.push(
      `Unknown package "${name}" — add it to ALLOWED_EDGES in check-dependency-graph.mjs`,
    );
    continue;
  }

  const deps = { ...manifest.dependencies, ...manifest.optionalDependencies };

  if (deps[name]) {
    violations.push(`${name}: cannot depend on itself`);
  }

  if (deps['vscode']) {
    violations.push(
      `${name}: runtime dependency on "vscode" is forbidden (editor-agnostic rule). ` +
        `Only ${[...VSCODE_RUNTIME_ALLOWED].join(', ') || 'the realtime adapter'} may use it as a devDependency.`,
    );
  }

  const peDeps = Object.keys(deps).filter((d) => d.startsWith('@pe/'));
  const allowed = ALLOWED_EDGES[name];

  for (const dep of peDeps) {
    if (!packages.has(dep)) {
      violations.push(`${name}: depends on unknown @pe package "${dep}"`);
      continue;
    }
    if (!allowed.includes(dep)) {
      violations.push(
        `${name}: forbidden edge → ${dep} (allowed: ${allowed.length ? allowed.join(', ') : 'none'})`,
      );
    }
  }

  const devDeps = { ...manifest.devDependencies };
  if (devDeps['vscode'] && !VSCODE_RUNTIME_ALLOWED.has(name)) {
    violations.push(
      `${name}: "vscode" devDependency is only allowed in ${[...VSCODE_RUNTIME_ALLOWED].join(', ')}`,
    );
  }
}

// cycle detection over the @pe edge graph
function findCycles() {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map([...packages.keys()].map((n) => [n, WHITE]));
  const cycles = [];

  function visit(node, stack) {
    color.set(node, GRAY);
    stack.push(node);
    for (const dep of Object.keys(packages.get(node).manifest.dependencies ?? {}).filter((d) =>
      packages.has(d),
    )) {
      if (color.get(dep) === GRAY) {
        const idx = stack.indexOf(dep);
        cycles.push([...stack.slice(idx), dep].join(' → '));
      } else if (color.get(dep) === WHITE) {
        visit(dep, stack);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  }

  for (const name of packages.keys()) {
    if (color.get(name) === WHITE) visit(name, []);
  }
  return cycles;
}

const cycles = findCycles();
if (cycles.length) {
  violations.push(`Dependency cycles detected:\n  ${cycles.join('\n  ')}`);
}

if (violations.length) {
  console.error('Dependency graph violations:');
  for (const v of violations) console.error(`  ✗ ${v}`);
  console.error(
    `\n${violations.length} violation(s) — see agentRead.md §3.1 for the allowed graph.`,
  );
  process.exit(1);
}

console.log(`check:deps OK — ${packages.size} packages, dependency graph matches §3.1, no cycles.`);
