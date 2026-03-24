// --- Config ---

export interface EmberConfig {
  runner: {
    type: "claude";
    model: string;
    timeoutMs: number;
  };
  loop: {
    maxReviewIterations: number;
    maxAfkSlices: number;
  };
  checks: {
    default: string[];
    enabled: boolean;
  };
}

// --- PRD Parsing ---

export interface ParsedPrd {
  id: string;
  filename: string;
  title: string;
  priority: Priority;
  dependsOn: string[];
  criteria: ParsedCriterion[];
}

export interface ParsedCriterion {
  id: string;
  text: string;
  checked: boolean;
}

// --- State ---

export type Priority = "high" | "normal" | "low";

export interface EmberState {
  version: 1;
  projectRoot: string;
  lastSyncedAt: string;
  prds: Record<string, PrdState>;
  slices: Record<string, SliceState>;
  currentRun: RunState | null;
  history: HistoryEntry[];
  learnings: string[];
}

export interface PrdState {
  id: string;
  title: string;
  filename: string;
  status: "pending" | "in_progress" | "completed" | "archived";
  priority: Priority;
  dependsOn: string[];
  criteria: Record<string, CriterionState>;
  tracerValidated: boolean;
}

export interface CriterionState {
  id: string;
  text: string;
  status: "pending" | "done";
  completedAt: string | null;
  completedBySlice: string | null;
}

export type SliceKind = "tracer" | "expand" | "polish" | "direct";
export type SliceStatus = "pending" | "running" | "done" | "blocked" | "failed";

export interface SliceState {
  id: string;
  prdId: string;
  kind: SliceKind;
  title: string;
  status: SliceStatus;
  criterionIds: string[];
  dependsOn: string[];
  createdBy: "system" | "gate";
  createdAt: string;
  completedAt: string | null;
  reviewIterations: number;
  blockReason: string | null;
}

export interface RunState {
  runId: string;
  mode: "run" | "afk";
  sliceId: string;
  step: "work" | "review" | "checks" | "gate";
  reviewIteration: number;
  status: "running" | "interrupted";
  startedAt: string;
}

export interface HistoryEntry {
  runId: string;
  sliceId: string;
  verdict: "done" | "iterate" | "blocked";
  summary: string;
  completedAt: string;
  costUsd: number | null;
}

// --- Gate ---

export interface GateVerdict {
  verdict: "done" | "iterate" | "blocked";
  summary: string;
  criteriaCompleted: string[];
  memoryUpdates: string[];
  nextSlices: ProposedSlice[];
  blockReason?: string;
}

export interface ProposedSlice {
  title: string;
  kind: SliceKind;
  criterionIds: string[];
  priority: Priority;
}

// --- Runner ---

export interface RunnerResult {
  exitCode: number;
  output: string;
  costUsd: number | null;
  durationMs: number | null;
}
