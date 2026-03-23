import type { GateVerdict, ProposedSlice, SliceKind, Priority } from "./types";

export function parseGateVerdict(output: string): GateVerdict {
  const jsonStr = extractJsonString(output);
  const parsed = parseJson(jsonStr);
  return validateVerdict(parsed);
}

// --- Extraction ---

function extractJsonString(output: string): string {
  let str = output.trim();

  // Strip markdown code fences if present
  const fenceMatch = str.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // Models sometimes wrap JSON in prose. Use a greedy match to find the
  // outermost { ... } block. This is safe because gate output should contain
  // exactly one top-level JSON object; nested braces are part of it.
  if (!str.startsWith("{")) {
    const objMatch = str.match(/\{[\s\S]*\}/);
    if (objMatch) return objMatch[0];
  }

  return str;
}

// --- Parsing ---

function parseJson(jsonStr: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Failed to parse gate verdict JSON: ${jsonStr.slice(0, 200)}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Gate verdict is not an object");
  }

  return parsed as Record<string, unknown>;
}

// --- Validation ---

const VALID_VERDICTS = ["done", "iterate", "blocked"] as const;
const VALID_SLICE_KINDS: SliceKind[] = ["tracer", "expand", "polish", "direct"];
const VALID_PRIORITIES: Priority[] = ["high", "normal", "low"];

function validateVerdict(obj: Record<string, unknown>): GateVerdict {
  if (!VALID_VERDICTS.includes(obj.verdict as typeof VALID_VERDICTS[number])) {
    throw new Error(
      `Invalid verdict: ${obj.verdict}. Must be "done", "iterate", or "blocked"`
    );
  }

  if (typeof obj.summary !== "string") {
    throw new Error("Gate verdict missing 'summary' string");
  }

  return {
    verdict: obj.verdict as GateVerdict["verdict"],
    summary: obj.summary,
    criteriaCompleted: validateStringArray(obj.criteriaCompleted, "criteriaCompleted"),
    memoryUpdates: validateStringArray(obj.memoryUpdates, "memoryUpdates"),
    nextSlices: validateNextSlices(obj.nextSlices),
    blockReason:
      typeof obj.blockReason === "string" ? obj.blockReason : undefined,
  };
}

function validateStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) return [];

  const valid: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      valid.push(item);
    } else {
      console.warn(`[gate] Filtering non-string from ${fieldName}: ${JSON.stringify(item)}`);
    }
  }
  return valid;
}

function validateNextSlices(value: unknown): ProposedSlice[] {
  if (!Array.isArray(value)) return [];

  const valid: ProposedSlice[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      console.warn(`[gate] Filtering invalid nextSlice: ${JSON.stringify(item)}`);
      continue;
    }

    const slice = item as Record<string, unknown>;
    if (typeof slice.title !== "string") {
      console.warn(`[gate] Filtering nextSlice without title: ${JSON.stringify(item)}`);
      continue;
    }

    const kind = VALID_SLICE_KINDS.includes(slice.kind as SliceKind)
      ? (slice.kind as SliceKind)
      : "expand"; // default to expand for unrecognized kinds

    const priority = VALID_PRIORITIES.includes(slice.priority as Priority)
      ? (slice.priority as Priority)
      : "normal";

    const criterionIds = Array.isArray(slice.criterionIds)
      ? (slice.criterionIds as unknown[]).filter((id): id is string => typeof id === "string")
      : [];

    valid.push({ title: slice.title, kind, criterionIds, priority });
  }
  return valid;
}
