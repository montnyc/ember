import type {
  EmberState,
  PrdState,
  ProposedSlice,
  SliceState,
  SliceStatus,
} from "./types";

/**
 * Create one slice per pending criterion in the PRD.
 * This matches the proven afk pattern: one Claude call per criterion.
 */
export function createSlicesForPrd(
  prd: PrdState,
  existingSlices: Record<string, SliceState>
): SliceState[] {
  const newSlices: SliceState[] = [];

  for (const [criterionId, criterion] of Object.entries(prd.criteria)) {
    if (criterion.status === "done") continue;

    // Check if a slice already exists for this criterion
    const existing = Object.values(existingSlices).find(
      (s) => s.prdId === prd.id && s.criterionIds.includes(criterionId)
    );
    if (existing) continue;

    newSlices.push({
      id: `${prd.id}:${criterionId.toLowerCase()}`,
      prdId: prd.id,
      kind: "direct",
      title: criterion.text,
      status: "pending",
      criterionIds: [criterionId],
      dependsOn: [],
      createdBy: "system",
      createdAt: new Date().toISOString(),
      completedAt: null,
      reviewIterations: 0,
      blockReason: null,
    });
  }

  return newSlices;
}

export function createSliceFromProposal(
  prdId: string,
  proposal: ProposedSlice,
  existingSlices: Record<string, SliceState>
): SliceState {
  const prefix = `${prdId}:${proposal.kind}-`;
  const n = nextIdForPrefix(prefix, existingSlices);

  return {
    id: `${prefix}${n}`,
    prdId,
    kind: proposal.kind,
    title: proposal.title,
    status: "pending",
    criterionIds: proposal.criterionIds,
    dependsOn: [],
    createdBy: "gate",
    createdAt: new Date().toISOString(),
    completedAt: null,
    reviewIterations: 0,
    blockReason: null,
  };
}

/**
 * Create a fix slice to address check failures from a completed slice.
 */
export function createFixSlice(
  originalSlice: SliceState,
  checkOutput: string,
  existingSlices: Record<string, SliceState>
): SliceState {
  const prefix = `${originalSlice.prdId}:fix-`;
  const n = nextIdForPrefix(prefix, existingSlices);

  const firstLine = checkOutput.split("\n").find((l) => l.trim())?.slice(0, 80) ?? "check failure";

  return {
    id: `${prefix}${n}`,
    prdId: originalSlice.prdId,
    kind: "direct",
    title: `Fix: ${firstLine}`,
    status: "pending",
    criterionIds: originalSlice.criterionIds,
    dependsOn: [],
    createdBy: "system",
    createdAt: new Date().toISOString(),
    completedAt: null,
    reviewIterations: 0,
    blockReason: null,
  };
}

const VALID_TRANSITIONS: Record<SliceStatus, SliceStatus[]> = {
  pending: ["running", "blocked"],
  running: ["done", "blocked", "failed"],
  done: [],
  blocked: ["pending"],
  failed: ["pending"],
};

export function transitionSlice(
  state: EmberState,
  sliceId: string,
  newStatus: SliceStatus,
  opts?: { blockReason?: string }
): void {
  const slice = state.slices[sliceId];
  if (!slice) throw new Error(`Slice ${sliceId} not found`);

  const allowed = VALID_TRANSITIONS[slice.status];
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Invalid transition: ${slice.status} -> ${newStatus} for slice ${sliceId}`
    );
  }

  slice.status = newStatus;

  if (newStatus === "done") {
    slice.completedAt = new Date().toISOString();
  }

  if (newStatus === "blocked" && opts?.blockReason) {
    slice.blockReason = opts.blockReason;
  }
}

// --- Helpers ---

/** Find the next available number for a given ID prefix (e.g. "001:fix-" → 3 if fix-1 and fix-2 exist). */
function nextIdForPrefix(prefix: string, existingSlices: Record<string, SliceState>): number {
  let n = 1;
  for (const id of Object.keys(existingSlices)) {
    if (id.startsWith(prefix)) {
      const num = parseInt(id.slice(prefix.length), 10);
      if (num >= n) n = num + 1;
    }
  }
  return n;
}
