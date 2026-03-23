import { describe, expect, test } from "bun:test";
import { buildWorkPrompt, buildReviewPrompt, buildGatePrompt } from "../prompts";
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
  test("includes slice id and PRD title", () => {
    const prompt = buildWorkPrompt(slice, prd, "# Memory", DEFAULT_CONFIG);
    expect(prompt).toContain("001:tracer-1");
    expect(prompt).toContain("Authentication");
  });

  test("includes criteria text", () => {
    const prompt = buildWorkPrompt(slice, prd, "", DEFAULT_CONFIG);
    expect(prompt).toContain("AC-001");
    expect(prompt).toContain("User can sign in");
  });

  test("includes tracer instructions for tracer slices", () => {
    const prompt = buildWorkPrompt(slice, prd, "", DEFAULT_CONFIG);
    expect(prompt).toContain("TRACER");
    expect(prompt).toContain("critical path");
  });

  test("excludes tracer instructions for expand slices", () => {
    const expandSlice = { ...slice, kind: "expand" as const };
    const prompt = buildWorkPrompt(expandSlice, prd, "", DEFAULT_CONFIG);
    expect(prompt).not.toContain("TRACER");
  });

  test("instructs model not to commit with ember policy", () => {
    const prompt = buildWorkPrompt(slice, prd, "", DEFAULT_CONFIG);
    expect(prompt).toContain("Do NOT create git commits");
  });

  test("instructs model to commit with model policy", () => {
    const modelConfig = { ...DEFAULT_CONFIG, commitPolicy: "model" as const };
    const prompt = buildWorkPrompt(slice, prd, "", modelConfig);
    expect(prompt).toContain("Create a git commit");
    expect(prompt).toContain("[ember:001:tracer-1]");
  });
});

describe("buildReviewPrompt", () => {
  test("includes diff", () => {
    const prompt = buildReviewPrompt(slice, prd, "+new line");
    expect(prompt).toContain("+new line");
  });

  test("truncates large diffs", () => {
    const largeDiff = "x".repeat(60000);
    const prompt = buildReviewPrompt(slice, prd, largeDiff);
    expect(prompt).toContain("truncated");
  });
});

describe("buildGatePrompt", () => {
  test("includes JSON schema", () => {
    const prompt = buildGatePrompt(slice, prd, "looks good", "all pass", true);
    expect(prompt).toContain('"verdict"');
    expect(prompt).toContain('"criteriaCompleted"');
  });

  test("warns when checks fail", () => {
    const prompt = buildGatePrompt(slice, prd, "ok", "FAIL", false);
    expect(prompt).toContain("Checks FAILED");
    expect(prompt).toContain("MUST NOT");
  });
});
