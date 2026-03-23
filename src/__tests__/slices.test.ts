import { describe, expect, test } from "bun:test";
import {
  createTracerSlice,
  createSliceFromProposal,
  transitionSlice,
  prdNeedsTracer,
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

describe("prdNeedsTracer", () => {
  test("returns true for new PRD with no slices", () => {
    expect(prdNeedsTracer(makePrd(), {})).toBe(true);
  });

  test("returns false when tracer already exists", () => {
    const slices: Record<string, SliceState> = {
      "001:tracer-1": {
        id: "001:tracer-1",
        prdId: "001",
        kind: "tracer",
        title: "test",
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
    expect(prdNeedsTracer(makePrd(), slices)).toBe(false);
  });

  test("returns false when tracer validated", () => {
    expect(prdNeedsTracer(makePrd({ tracerValidated: true }), {})).toBe(false);
  });

  test("returns false when no criteria", () => {
    expect(prdNeedsTracer(makePrd({ criteria: {} }), {})).toBe(false);
  });
});

describe("createTracerSlice", () => {
  test("creates tracer with first criterion", () => {
    const slice = createTracerSlice(makePrd());
    expect(slice.id).toBe("001:tracer-1");
    expect(slice.kind).toBe("tracer");
    expect(slice.prdId).toBe("001");
    expect(slice.criterionIds).toEqual(["AC-001"]);
    expect(slice.status).toBe("pending");
    expect(slice.createdBy).toBe("system");
  });
});

describe("createSliceFromProposal", () => {
  test("auto-increments slice number", () => {
    const existing: Record<string, SliceState> = {
      "001:expand-1": {} as SliceState,
    };
    const slice = createSliceFromProposal(
      "001",
      {
        title: "Add reset flow",
        kind: "expand",
        criterionIds: ["AC-002"],
        priority: "normal",
      },
      existing
    );
    expect(slice.id).toBe("001:expand-2");
    expect(slice.createdBy).toBe("gate");
  });

  test("starts at 1 when no existing slices", () => {
    const slice = createSliceFromProposal(
      "001",
      {
        title: "Polish auth",
        kind: "polish",
        criterionIds: [],
        priority: "low",
      },
      {}
    );
    expect(slice.id).toBe("001:polish-1");
  });
});

describe("transitionSlice", () => {
  test("allows pending -> running", () => {
    const state = defaultState("/tmp");
    state.slices["001:tracer-1"] = createTracerSlice(makePrd());
    transitionSlice(state, "001:tracer-1", "running");
    expect(state.slices["001:tracer-1"].status).toBe("running");
  });

  test("allows running -> done and sets completedAt", () => {
    const state = defaultState("/tmp");
    state.slices["001:tracer-1"] = createTracerSlice(makePrd());
    state.slices["001:tracer-1"].status = "running";
    transitionSlice(state, "001:tracer-1", "done");
    expect(state.slices["001:tracer-1"].status as string).toBe("done");
    expect(state.slices["001:tracer-1"].completedAt).not.toBeNull();
  });

  test("rejects invalid transitions", () => {
    const state = defaultState("/tmp");
    state.slices["001:tracer-1"] = createTracerSlice(makePrd());
    expect(() =>
      transitionSlice(state, "001:tracer-1", "done")
    ).toThrow("Invalid transition");
  });

  test("sets blockReason on blocked", () => {
    const state = defaultState("/tmp");
    state.slices["001:tracer-1"] = createTracerSlice(makePrd());
    state.slices["001:tracer-1"].status = "running";
    transitionSlice(state, "001:tracer-1", "blocked", {
      blockReason: "Tests fail",
    });
    expect(state.slices["001:tracer-1"].blockReason).toBe("Tests fail");
  });

  test("throws for unknown slice", () => {
    const state = defaultState("/tmp");
    expect(() => transitionSlice(state, "nope", "running")).toThrow(
      "Slice nope not found"
    );
  });
});
