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
  let n = 1;
  const prefix = `${prdId}:${proposal.kind}-`;
  for (const id of Object.keys(existingSlices)) {
    if (id.startsWith(prefix)) {
      const num = parseInt(id.slice(prefix.length), 10);
      if (num >= n) n = num + 1;
    }
  }

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
