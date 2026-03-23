import type {
  EmberState,
  PrdState,
  ProposedSlice,
  SliceState,
  SliceStatus,
} from "./types";

export function prdNeedsTracer(
  prd: PrdState,
  slices: Record<string, SliceState>
): boolean {
  if (prd.tracerValidated) return false;
  if (Object.keys(prd.criteria).length === 0) return false;

  // Check if there's already a tracer slice for this PRD
  for (const slice of Object.values(slices)) {
    if (slice.prdId === prd.id && slice.kind === "tracer") {
      return false;
    }
  }
  return true;
}

export function createTracerSlice(prd: PrdState): SliceState {
  const firstCriterion = Object.keys(prd.criteria)[0];

  return {
    id: `${prd.id}:tracer-1`,
    prdId: prd.id,
    kind: "tracer",
    title: `Prove critical path for ${prd.title}`,
    status: "pending",
    criterionIds: firstCriterion ? [firstCriterion] : [],
    dependsOn: [],
    createdBy: "system",
    createdAt: new Date().toISOString(),
    completedAt: null,
    reviewIterations: 0,
    blockReason: null,
  };
}

export function createSliceFromProposal(
  prdId: string,
  proposal: ProposedSlice,
  existingSlices: Record<string, SliceState>
): SliceState {
  // Find next increment for this prd + kind
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
