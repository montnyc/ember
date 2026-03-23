import { describe, expect, test } from "bun:test";
import { renderMemory } from "../memory";
import { defaultState } from "../state";
import type { EmberState } from "../types";

function makeState(): EmberState {
  const state = defaultState("/tmp");
  state.prds["001"] = {
    id: "001",
    title: "Authentication",
    filename: "001-auth.md",
    status: "in_progress",
    priority: "high",
    dependsOn: [],
    criteria: {
      "AC-001": {
        id: "AC-001",
        text: "Sign in",
        status: "done",
        completedAt: "2026-03-23T00:00:00.000Z",
        completedBySlice: "001:tracer-1",
      },
      "AC-002": {
        id: "AC-002",
        text: "Error handling",
        status: "pending",
        completedAt: null,
        completedBySlice: null,
      },
    },
    tracerValidated: true,
  };
  state.slices["001:tracer-1"] = {
    id: "001:tracer-1",
    prdId: "001",
    kind: "tracer",
    title: "Prove sign-in path",
    status: "done",
    criterionIds: ["AC-001"],
    dependsOn: [],
    createdBy: "system",
    createdAt: "2026-03-23T00:00:00.000Z",
    completedAt: "2026-03-23T01:00:00.000Z",
    reviewIterations: 1,
    blockReason: null,
  };
  state.slices["001:expand-1"] = {
    id: "001:expand-1",
    prdId: "001",
    kind: "expand",
    title: "Add error handling",
    status: "pending",
    criterionIds: ["AC-002"],
    dependsOn: [],
    createdBy: "gate",
    createdAt: "2026-03-23T01:00:00.000Z",
    completedAt: null,
    reviewIterations: 0,
    blockReason: null,
  };
  return state;
}

describe("renderMemory", () => {
  test("contains all required sections", () => {
    const output = renderMemory(makeState());
    expect(output).toContain("# Ember");
    expect(output).toContain("## Project Reality");
    expect(output).toContain("## Validated Paths");
    expect(output).toContain("## Open PRDs");
    expect(output).toContain("## Open Slices");
    expect(output).toContain("## Recent Learnings");
    expect(output).toContain("## Next Slice");
  });

  test("shows PRD status", () => {
    const output = renderMemory(makeState());
    expect(output).toContain("Authentication");
    expect(output).toContain("1/2 criteria done");
  });

  test("shows validated tracers", () => {
    const output = renderMemory(makeState());
    expect(output).toContain("Prove sign-in path");
  });

  test("shows open slices", () => {
    const output = renderMemory(makeState());
    expect(output).toContain("[expand] Add error handling");
  });

  test("shows next slice", () => {
    const output = renderMemory(makeState());
    expect(output).toContain("001:expand-1");
  });

  test("includes recent learnings from state", () => {
    const state = makeState();
    state.learnings = ["Auth uses JWT tokens"];
    const output = renderMemory(state);
    expect(output).toContain("Auth uses JWT tokens");
  });

  test("stays under 150 lines for reasonable state", () => {
    const lines = renderMemory(makeState()).split("\n");
    expect(lines.length).toBeLessThan(150);
  });

  test("handles empty state", () => {
    const output = renderMemory(defaultState("/tmp"));
    expect(output).toContain("# Ember");
    expect(output).toContain("None yet");
    expect(output).toContain("No actionable slices");
  });
});
