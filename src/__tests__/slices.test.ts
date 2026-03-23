import { describe, expect, test } from "bun:test";
import {
  createSlicesForPrd,
  createSliceFromProposal,
  transitionSlice,
} from "../slices";
import { defaultState } from "../state";
import type { PrdState, SliceState } from "../types";

function makePrd(overrides: Partial<PrdState> = {}): PrdState {
  return {
    id: "001",
    title: "Auth",
    filename: "001-auth.md",
    status: "pending",
    priority: "normal",
    dependsOn: [],
    criteria: {
      "AC-001": {
        id: "AC-001",
        text: "Sign in works",
        status: "pending",
        completedAt: null,
        completedBySlice: null,
      },
      "AC-002": {
        id: "AC-002",
        text: "Errors shown",
        status: "pending",
        completedAt: null,
        completedBySlice: null,
      },
    },
    tracerValidated: false,
    ...overrides,
  };
}

describe("createSlicesForPrd", () => {
  test("creates one slice per pending criterion", () => {
    const slices = createSlicesForPrd(makePrd(), {});
    expect(slices).toHaveLength(2);
    expect(slices[0].id).toBe("001:ac-001");
    expect(slices[0].criterionIds).toEqual(["AC-001"]);
    expect(slices[1].id).toBe("001:ac-002");
    expect(slices[1].criterionIds).toEqual(["AC-002"]);
  });

  test("skips done criteria", () => {
    const prd = makePrd();
    prd.criteria["AC-001"].status = "done";
    const slices = createSlicesForPrd(prd, {});
    expect(slices).toHaveLength(1);
    expect(slices[0].criterionIds).toEqual(["AC-002"]);
  });

  test("skips criteria that already have slices", () => {
    const existing: Record<string, SliceState> = {
      "001:ac-001": {
        id: "001:ac-001",
        prdId: "001",
        kind: "direct",
        title: "Sign in works",
        status: "pending",
        criterionIds: ["AC-001"],
        dependsOn: [],
        createdBy: "system",
        createdAt: "",
        completedAt: null,
        reviewIterations: 0,
        blockReason: null,
      },
    };
    const slices = createSlicesForPrd(makePrd(), existing);
    expect(slices).toHaveLength(1);
    expect(slices[0].criterionIds).toEqual(["AC-002"]);
  });

  test("returns empty for PRD with no pending criteria", () => {
    const prd = makePrd();
    prd.criteria["AC-001"].status = "done";
    prd.criteria["AC-002"].status = "done";
    expect(createSlicesForPrd(prd, {})).toHaveLength(0);
  });
});

describe("createSliceFromProposal", () => {
  test("auto-increments slice number", () => {
    const existing: Record<string, SliceState> = {
      "001:expand-1": {} as SliceState,
    };
    const slice = createSliceFromProposal(
      "001",
      { title: "Add reset", kind: "expand", criterionIds: ["AC-002"], priority: "normal" },
      existing
    );
    expect(slice.id).toBe("001:expand-2");
  });
});

describe("transitionSlice", () => {
  test("allows pending -> running", () => {
    const state = defaultState("/tmp");
    state.slices["001:ac-001"] = {
      id: "001:ac-001", prdId: "001", kind: "direct", title: "test",
      status: "pending", criterionIds: ["AC-001"], dependsOn: [],
      createdBy: "system", createdAt: "", completedAt: null,
      reviewIterations: 0, blockReason: null,
    };
    transitionSlice(state, "001:ac-001", "running");
    expect(state.slices["001:ac-001"].status).toBe("running");
  });

  test("rejects invalid transitions", () => {
    const state = defaultState("/tmp");
    state.slices["001:ac-001"] = {
      id: "001:ac-001", prdId: "001", kind: "direct", title: "test",
      status: "pending", criterionIds: ["AC-001"], dependsOn: [],
      createdBy: "system", createdAt: "", completedAt: null,
      reviewIterations: 0, blockReason: null,
    };
    expect(() => transitionSlice(state, "001:ac-001", "done")).toThrow("Invalid transition");
  });
});
