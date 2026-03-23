// --- TUI Event System ---
// The runner emits these events. The TUI or terminal printer consumes them.

export interface ToolEvent {
  type: "tool_use" | "tool_result" | "text" | "done" | "commit" | "slice_start" | "slice_end" | "error";
  name?: string;
  detail?: string;
  isError?: boolean;
  cost?: number;
  durationSec?: number;
  timestamp: number;
}

export type EventListener = (event: ToolEvent) => void;

export interface SliceInfo {
  id: string;
  kind: string;
  title: string;
  criterionId: string;
  status: "pending" | "running" | "done" | "failed" | "no_changes";
}

export interface PrdInfo {
  id: string;
  title: string;
  filename: string;
  priority: string;
  totalCriteria: number;
  doneCriteria: number;
  totalSlices: number;
  doneSlices: number;
}

export interface RunHistoryEntry {
  runId: string;
  date: string;
  slicesCompleted: number;
  slicesFailed: number;
  totalCost: number;
  durationMin: number;
}

export type Screen = "home" | "run";

export interface AppState {
  screen: Screen;
  // Home screen
  prds: PrdInfo[];
  history: RunHistoryEntry[];
  // Run screen
  mode: "idle" | "running" | "paused" | "finished";
  currentSliceIndex: number;
  slices: SliceInfo[];
  events: ToolEvent[];
  diff: string;
  completed: number;
  failed: number;
  totalCost: number;
  startTimeMs: number;
  elapsedMs: number;
}
