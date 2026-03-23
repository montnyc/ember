import { describe, expect, test } from "bun:test";
import { parseGateVerdict } from "../gate";

describe("parseGateVerdict", () => {
  test("parses valid JSON", () => {
    const input = JSON.stringify({
      verdict: "done",
      summary: "Auth works end-to-end",
      criteriaCompleted: ["AC-001"],
      memoryUpdates: ["JWT auth validated"],
      nextSlices: [
        {
          title: "Add error handling",
          kind: "expand",
          criterionIds: ["AC-002"],
          priority: "normal",
        },
      ],
    });

    const verdict = parseGateVerdict(input);
    expect(verdict.verdict).toBe("done");
    expect(verdict.summary).toBe("Auth works end-to-end");
    expect(verdict.criteriaCompleted).toEqual(["AC-001"]);
    expect(verdict.nextSlices).toHaveLength(1);
  });

  test("strips markdown code fences", () => {
    const input = `Here's the verdict:

\`\`\`json
{
  "verdict": "iterate",
  "summary": "Needs more work"
}
\`\`\``;

    const verdict = parseGateVerdict(input);
    expect(verdict.verdict).toBe("iterate");
  });

  test("extracts JSON from surrounding text", () => {
    const input = `Based on my review, here is the verdict:
{"verdict": "blocked", "summary": "Missing dependency", "blockReason": "Need DB setup first"}
That's my assessment.`;

    const verdict = parseGateVerdict(input);
    expect(verdict.verdict).toBe("blocked");
    expect(verdict.blockReason).toBe("Need DB setup first");
  });

  test("defaults missing optional arrays", () => {
    const input = JSON.stringify({
      verdict: "done",
      summary: "Complete",
    });

    const verdict = parseGateVerdict(input);
    expect(verdict.criteriaCompleted).toEqual([]);
    expect(verdict.memoryUpdates).toEqual([]);
    expect(verdict.nextSlices).toEqual([]);
  });

  test("throws on invalid verdict value", () => {
    const input = JSON.stringify({
      verdict: "pass",
      summary: "Done",
    });

    expect(() => parseGateVerdict(input)).toThrow("Invalid verdict");
  });

  test("throws on missing summary", () => {
    const input = JSON.stringify({ verdict: "done" });
    expect(() => parseGateVerdict(input)).toThrow("missing 'summary'");
  });

  test("throws on unparseable input", () => {
    expect(() => parseGateVerdict("not json at all")).toThrow(
      "Failed to parse"
    );
  });
});
