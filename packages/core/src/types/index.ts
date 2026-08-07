// Core types for the Workspace Diagnostics Engine.
//
// NOTE: this package is editor-agnostic. The `Uri` interface below is the
// engine's own structural match to `vscode.Uri` — consumers pass real
// vscode.Uri objects (structurally compatible) or construct their own.

/** Engine URI — structural match to `vscode.Uri`. Never import `vscode` here. */
export interface Uri {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly fsPath: string;
  toString(): string;
  with(change: Partial<Pick<Uri, 'scheme' | 'authority' | 'path'>>): Uri;
}

/** Ordering matches worst-severity-wins: None < Info < Warning < Error */
export enum ProblemSeverity {
  None = 0,
  Info = 1,
  Warning = 2,
  Error = 3,
}

/** Immutable value object for the diagnostics summary of one file or folder */
export interface ProblemState {
  readonly severity: ProblemSeverity;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  /** Files contributing to this state (1 for a single file, aggregated for folders) */
  readonly fileCount: number;
}

/** Zero state constant */
export const ZERO_PROBLEM_STATE: ProblemState = {
  severity: ProblemSeverity.None,
  errorCount: 0,
  warningCount: 0,
  infoCount: 0,
  fileCount: 0,
};

/** Authoritativeness of a provider's results. Higher wins ownership. */
export enum ConfidenceTier {
  WorkspaceScanner = 3, // tsc, eslint, ruff — full workspace scans, authoritative
  Realtime = 2, // vscode-diagnostics — live but limited to open files
  Fallback = 1, // future: heuristic providers, AI suggestions
}

/** Cost classification used for scheduling. */
export type Cost = 'cheap' | 'medium' | 'expensive';

/** The only four scan triggers. Adding a fifth is a milestone decision. */
export enum ScanType {
  Startup = 'startup',
  Save = 'save',
  Manual = 'manual',
  Periodic = 'periodic',
}

/** Queue ordering for scan jobs. Manual > Save > Periodic > Startup. */
export type ScanPriority = 'manual' | 'save' | 'periodic' | 'startup';

/** Provider health states */
export enum ProviderHealth {
  Ready = 'ready',
  Unavailable = 'unavailable',
  MissingDependency = 'missing_dependency',
  Misconfigured = 'misconfigured',
  Scanning = 'scanning',
  Failed = 'failed',
}

/** Provider status with transition metadata */
export interface ProviderStatus {
  readonly health: ProviderHealth;
  readonly message?: string;
  readonly lastCheckMs: number;
  readonly lastScanMs?: number;
  readonly lastError?: Error;
}

/** Provider capability declaration */
export interface ProviderCapabilities {
  readonly confidenceTier: ConfidenceTier;
  readonly supportedConfigTypes: readonly ConfigType[];
  readonly workspaceScan: boolean;
  readonly incrementalScan: boolean;
  readonly realtime: boolean;
  readonly extensions: readonly string[];
  readonly cost: Cost;
}

/** Scan request context handed to a provider */
export interface ScanContext {
  readonly type: ScanType;
  readonly trigger: 'startup' | 'save' | 'manual' | 'timer' | 'config-change';
  readonly uris?: readonly Uri[];
  readonly providerId?: string;
}

/**
 * The minimal unit of requested work. Produced by the ImpactAnalyzer,
 * consumed by the scheduler. The scheduler NEVER infers scope itself.
 */
export interface ScanPlan {
  readonly capability: ConfigType;
  readonly scope: 'file' | 'workspace';
  readonly uris: readonly Uri[];
  readonly priority: ScanPriority;
}

/** Scan job in the scheduler queue */
export interface ScanJob {
  readonly id: string;
  readonly capability: ConfigType;
  readonly type: ScanType;
  readonly uris: readonly Uri[];
  readonly priority: ScanPriority;
  readonly cost: Cost;
  readonly enqueuedMs: number;
}

/** Scan result from a provider */
export interface ScanResult {
  readonly changedUris: readonly Uri[];
  readonly errors?: readonly ScanErrorInfo[];
}

/** Scan error info (the ScanError class lives in ../errors) */
export interface ScanErrorInfo {
  readonly uri: Uri;
  readonly message: string;
  readonly code?: string;
}

/** Project configuration discovered by WorkspaceIndex */
export interface ProjectConfig {
  readonly root: Uri;
  readonly type: ConfigType;
  readonly configFiles: readonly Uri[];
  readonly includes: readonly string[];
  readonly excludes: readonly string[];
}

/** Configuration types the engine understands. Open set — providers extend it. */
export type ConfigType =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'rust'
  | 'go'
  | 'php'
  | 'csharp'
  | 'java'
  | 'cpp'
  | 'typescript-react';

/** File entry in the workspace index */
export interface FileEntry {
  readonly uri: Uri;
  readonly extension: string;
  readonly size: number;
  readonly modifiedMs: number;
  readonly projectRoot: Uri;
  readonly owningProviderId?: string;
  readonly lastScannedMs?: number;
  readonly lastDiagnosticsMs?: number;
}

/** Provider status change event */
export interface ProviderStatusChangeEvent {
  readonly providerId: string;
  readonly status: ProviderStatus;
}

/** Scan job completion event */
export interface ScanJobCompleteEvent {
  readonly job: ScanJob;
  readonly result: ScanResult;
}

/** Scan job failure event */
export interface ScanJobFailedEvent {
  readonly job: ScanJob;
  readonly error: Error;
}

/** A single problem report produced by a provider for one file (line/column 0-based) */
export interface Diagnostic {
  readonly line: number;
  readonly column: number;
  readonly severity: ProblemSeverity;
  readonly message: string;
  /** e.g. 'tsc', 'ESLint:no-unused-vars', 'ruff:E501' */
  readonly source: string;
  readonly code?: string;
}

/** Read model returned by ProblemStore queries (alias of ProblemState) */
export type ProblemSummary = ProblemState;

/** Running totals across the whole store */
export interface ProblemTotals {
  readonly errors: number;
  readonly warnings: number;
  readonly info: number;
}

/** A file change detected by the WorkspaceIndex */
export interface FileChange {
  readonly kind: 'add' | 'change' | 'remove';
  readonly uri: Uri;
  readonly size?: number;
  readonly modifiedMs?: number;
}

/** File change batch emitted by the WorkspaceIndex */
export interface FileChangeEvent {
  readonly changes: readonly FileChange[];
}

/** Fired when a provider's diagnostics for a file were applied to the store */
export interface DiagnosticsChangedEvent {
  readonly uri: Uri;
  readonly providerId: string;
  readonly diagnostics: readonly Diagnostic[];
}

/** Fired when running totals changed */
export interface TotalsChangedEvent {
  readonly totals: ProblemTotals;
}

/** Fired when the current owner of a path changed */
export interface OwnershipChangedEvent {
  readonly uri: Uri;
  readonly providerId: string | undefined;
  readonly previousProviderId: string | undefined;
}
