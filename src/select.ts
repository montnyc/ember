import type { EmberState, SliceState, Priority } from "./types";

const KIND_PRIORITY: Record<string, number> = {
  tracer: 0,
  expand: 1,
  polish: 2,
  direct: 3,
};

const PRD_PRIORITY: Record<Priority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

// Safety bound: prevents stack overflow from circular or deeply nested PRD
// dependencies. 50 is generous — real projects rarely exceed single digits.
const MAX_DEPENDENCY_DEPTH = 50;

export function selectNextSlice(state: EmberState): SliceState | null {
  const candidates = Object.values(state.slices).filter(
    (slice) => slice.status === "pending" && isSliceUnblocked(slice, state)
  );

  if (candidates.length === 0) return null;

  // Pre-compute dependency depths once to avoid redundant recursive calls
  // during the O(n log n) sort comparisons.
  const depthByPrd = new Map<string, number>();
  for (const slice of candidates) {
    if (!depthByPrd.has(slice.prdId)) {
      depthByPrd.set(slice.prdId, computeDependencyDepth(slice.prdId, state));
    }
  }

  candidates.sort((a, b) => compareSlicePriority(a, b, state, depthByPrd));
  return candidates[0];
}

export function isSliceUnblocked(
  slice: SliceState,
  state: EmberState
): boolean {
  return (
    areSliceDependenciesMet(slice, state) &&
    arePrdDependenciesMet(slice, state)
  );
}

export function computeDependencyDepth(
  prdId: string,
  state: EmberState,
  visited = new Set<string>(),
  currentDepth = 0
): number {
  if (currentDepth >= MAX_DEPENDENCY_DEPTH) return currentDepth;
  if (visited.has(prdId)) return 0; // cycle protection
  visited.add(prdId);

  const prd = state.prds[prdId];
  if (!prd || prd.dependsOn.length === 0) return 0;

  let maxDepth = 0;
  for (const depId of prd.dependsOn) {
    const depth = computeDependencyDepth(depId, state, visited, currentDepth + 1);
    if (depth + 1 > maxDepth) maxDepth = depth + 1;
  }
  return maxDepth;
}

// --- Helpers ---

function compareSlicePriority(
  a: SliceState,
  b: SliceState,
  state: EmberState,
  depthByPrd: Map<string, number>
): number {
  // 1. Slice kind: tracer before expand before polish
  const kindDiff =
    (KIND_PRIORITY[a.kind] ?? 99) - (KIND_PRIORITY[b.kind] ?? 99);
  if (kindDiff !== 0) return kindDiff;

  // 2. PRD priority: high before normal before low
  const aPriority = state.prds[a.prdId]?.priority ?? "normal";
  const bPriority = state.prds[b.prdId]?.priority ?? "normal";
  const prdDiff = PRD_PRIORITY[aPriority] - PRD_PRIORITY[bPriority];
  if (prdDiff !== 0) return prdDiff;

  // 3. Dependency depth: shallower first (pre-computed)
  const depthDiff = (depthByPrd.get(a.prdId) ?? 0) - (depthByPrd.get(b.prdId) ?? 0);
  if (depthDiff !== 0) return depthDiff;

  // 4. Creation date: older first
  return a.createdAt.localeCompare(b.createdAt);
}

function areSliceDependenciesMet(
  slice: SliceState,
  state: EmberState
): boolean {
  for (const depId of slice.dependsOn) {
    const dep = state.slices[depId];
    if (!dep || dep.status !== "done") return false;
  }
  return true;
}

function arePrdDependenciesMet(
  slice: SliceState,
  state: EmberState
): boolean {
  const prd = state.prds[slice.prdId];
  if (!prd) return false;

  for (const depPrdId of prd.dependsOn) {
    const depPrd = state.prds[depPrdId];
    if (!depPrd || depPrd.status !== "completed") return false;
  }
  return true;
}
