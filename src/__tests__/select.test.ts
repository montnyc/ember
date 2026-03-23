import { describe, expect, test } from "bun:test";
import { selectNextSlice, isSliceUnblocked } from "../select";
import { defaultState } from "../state";
import type { EmberState, PrdState, SliceState } from "../types";

function makeState(): EmberState {
  return defaultState("/tmp");
}

function addPrd(
  state: EmberState,
  id: string,
  opts: Partial<PrdState> = {}
): void {
  state.prds[id] = {
    id,
    title: `PRD ${id}`,
    filename: `${id}-test.md`,
    status: "pending",
    priority: "normal",
    dependsOn: [],
    criteria: {
      "AC-001": {
        id: "AC-001",
        text: "Test",
        status: "pending",
        completedAt: null,
        completedBySlice: null,
      },
    },
    tracerValidated: false,
    ...opts,
  };
}

function addSlice(
  state: EmberState,
  id: string,
  opts: Partial<SliceState> = {}
): void {
  state.slices[id] = {
    id,
    prdId: id.split(":")[0],
    kind: "tracer",
    title: `Slice ${id}`,
    status: "pending",
    criterionIds: ["AC-001"],
    dependsOn: [],
    createdBy: "system",
    createdAt: new Date().toISOString(),
    completedAt: null,
    reviewIterations: 0,
    blockReason: null,
    ...opts,
  };
}

describe("selectNextSlice", () => {
  test("returns null when no slices", () => {
    expect(selectNextSlice(makeState())).toBeNull();
  });

  test("returns null when all slices are done", () => {
    const state = makeState();
    addPrd(state, "001");
    addSlice(state, "001:tracer-1", { status: "done" });
    expect(selectNextSlice(state)).toBeNull();
  });

  test("picks tracer over expand", () => {
    const state = makeState();
    addPrd(state, "001");
    addSlice(state, "001:expand-1", { kind: "expand" });
    addSlice(state, "001:tracer-1", { kind: "tracer" });
    const next = selectNextSlice(state);
    expect(next?.id).toBe("001:tracer-1");
  });

  test("picks higher priority PRD first", () => {
    const state = makeState();
    addPrd(state, "001", { priority: "normal" });
    addPrd(state, "002", { priority: "high" });
    addSlice(state, "001:tracer-1", { prdId: "001" });
    addSlice(state, "002:tracer-1", { prdId: "002" });
    const next = selectNextSlice(state);
    expect(next?.id).toBe("002:tracer-1");
  });

  test("respects PRD dependency blocking", () => {
    const state = makeState();
    addPrd(state, "001");
    addPrd(state, "002", { dependsOn: ["001"] });
    addSlice(state, "001:tracer-1", { prdId: "001" });
    addSlice(state, "002:tracer-1", { prdId: "002" });
    const next = selectNextSlice(state);
    expect(next?.id).toBe("001:tracer-1");
  });

  test("unblocks when dependency PRD is completed", () => {
    const state = makeState();
    addPrd(state, "001", { status: "completed" });
    addPrd(state, "002", { dependsOn: ["001"] });
    addSlice(state, "001:tracer-1", { prdId: "001", status: "done" });
    addSlice(state, "002:tracer-1", { prdId: "002" });
    const next = selectNextSlice(state);
    expect(next?.id).toBe("002:tracer-1");
  });

  test("skips blocked slices", () => {
    const state = makeState();
    addPrd(state, "001");
    addSlice(state, "001:tracer-1", { status: "blocked" });
    addSlice(state, "001:expand-1", { kind: "expand" });
    const next = selectNextSlice(state);
    expect(next?.id).toBe("001:expand-1");
  });
});

describe("isSliceUnblocked", () => {
  test("blocked by slice dependency", () => {
    const state = makeState();
    addPrd(state, "001");
    addSlice(state, "001:tracer-1");
    addSlice(state, "001:expand-1", {
      kind: "expand",
      dependsOn: ["001:tracer-1"],
    });
    expect(isSliceUnblocked(state.slices["001:expand-1"], state)).toBe(false);
  });

  test("unblocked when slice dependency is done", () => {
    const state = makeState();
    addPrd(state, "001");
    addSlice(state, "001:tracer-1", { status: "done" });
    addSlice(state, "001:expand-1", {
      kind: "expand",
      dependsOn: ["001:tracer-1"],
    });
    expect(isSliceUnblocked(state.slices["001:expand-1"], state)).toBe(true);
  });
});
