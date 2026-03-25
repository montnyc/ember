import { extractJsonFromOutput, parseJsonObject } from "./parse-json";
import type { GateVerdict, ProposedSlice, SliceKind, Priority } from "./types";

export function parseGateVerdict(output: string): GateVerdict {
  const jsonStr = extractJsonFromOutput(output);
  const parsed = parseJsonObject(jsonStr, "gate verdict");
  return validateVerdict(parsed);
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
