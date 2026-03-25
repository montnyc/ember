import { describe, expect, test } from "bun:test";
import { buildWorkPrompt } from "../prompts";
import { DEFAULT_CONFIG } from "../config";
import type { PrdState, SliceState } from "../types";

const prd: PrdState = {
  id: "001",
  title: "Authentication",
  filename: "001-auth.md",
  status: "pending",
  priority: "high",
  dependsOn: [],
  criteria: {
    "AC-001": {
      id: "AC-001",
      text: "User can sign in",
      status: "pending",
      completedAt: null,
      completedBySlice: null,
    },
  },
  tracerValidated: false,
};

const slice: SliceState = {
  id: "001:tracer-1",
  prdId: "001",
  kind: "tracer",
  title: "Prove sign-in path",
  status: "running",
  criterionIds: ["AC-001"],
  dependsOn: [],
  createdBy: "system",
  createdAt: "",
  completedAt: null,
  reviewIterations: 0,
  blockReason: null,
};

describe("buildWorkPrompt", () => {
  test("includes PRD file reference", () => {
    const prompt = buildWorkPrompt(slice, prd, "", DEFAULT_CONFIG);
    expect(prompt).toContain("@docs/prd/001-auth.md");
  });

  test("includes criteria text", () => {
    const prompt = buildWorkPrompt(slice, prd, "", DEFAULT_CONFIG);
    expect(prompt).toContain("AC-001");
    expect(prompt).toContain("User can sign in");
  });

  test("marks current criterion with YOUR TASK", () => {
    const prompt = buildWorkPrompt(slice, prd, "", DEFAULT_CONFIG);
    expect(prompt).toContain("[YOU]");
    expect(prompt).toContain("YOUR TASK");
  });

  test("tells Claude to commit", () => {
    const prompt = buildWorkPrompt(slice, prd, "", DEFAULT_CONFIG);
    expect(prompt).toContain("Create a git commit");
    expect(prompt).toContain("[ember:001:tracer-1]");
  });

  test("includes progress count", () => {
    const prompt = buildWorkPrompt(slice, prd, "", DEFAULT_CONFIG);
    expect(prompt).toContain("0/1 acceptance criteria complete");
  });

  test("includes memory", () => {
    const prompt = buildWorkPrompt(slice, prd, "some memory", DEFAULT_CONFIG);
    expect(prompt).toContain("some memory");
  });

  test("includes pre-flight failures when provided", () => {
    const prompt = buildWorkPrompt(slice, prd, "", DEFAULT_CONFIG, {
      preflightFailures: "bun test: FAIL\nExpected true, got false",
    });
    expect(prompt).toContain("Existing Failures");
    expect(prompt).toContain("fix first");
    expect(prompt).toContain("Expected true, got false");
  });

  test("includes check failure context for fix slices", () => {
    const prompt = buildWorkPrompt(slice, prd, "", DEFAULT_CONFIG, {
      checkFailureContext: "tsc: error TS2345",
    });
    expect(prompt).toContain("Previous Check/Eval Failures");
    expect(prompt).toContain("TS2345");
  });

  test("includes cleanup instruction", () => {
    const prompt = buildWorkPrompt(slice, prd, "", DEFAULT_CONFIG);
    expect(prompt).toContain("remove any debug logs");
  });
});
