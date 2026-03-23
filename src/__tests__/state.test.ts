import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { readState, writeState, syncState, defaultState } from "../state";
import path from "node:path";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";

let testDir: string;
let prdDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(path.join(tmpdir(), "ember-state-"));
  prdDir = path.join(testDir, "docs", "prd");
  await mkdir(prdDir, { recursive: true });
  await mkdir(path.join(testDir, ".ember"), { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

function writePrd(filename: string, content: string) {
  return Bun.write(path.join(prdDir, filename), content);
}

const SAMPLE_PRD = `# Authentication

Priority: high

## Acceptance Criteria

- [ ] AC-001 User can sign in with email and password
- [ ] AC-002 Invalid credentials show an error
`;

describe("readState / writeState", () => {
  test("returns null when no state file", async () => {
    const state = await readState(testDir);
    expect(state).toBeNull();
  });

  test("round-trips state", async () => {
    const state = defaultState(testDir);
    await writeState(testDir, state);
    const loaded = await readState(testDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
    expect(loaded!.projectRoot).toBe(testDir);
  });

  test("returns null for corrupt JSON", async () => {
    await Bun.write(
      path.join(testDir, ".ember", "state.json"),
      "not json"
    );
    const state = await readState(testDir);
    expect(state).toBeNull();
  });
});

describe("syncState", () => {
  test("creates PRDs and tracer slices from disk", async () => {
    await writePrd("001-auth.md", SAMPLE_PRD);

    const state = await syncState(testDir);

    expect(Object.keys(state.prds)).toEqual(["001"]);
    expect(state.prds["001"].title).toBe("Authentication");
    expect(state.prds["001"].priority).toBe("high");
    expect(Object.keys(state.prds["001"].criteria)).toEqual([
      "AC-001",
      "AC-002",
    ]);

    // Should have created a tracer slice
    const sliceIds = Object.keys(state.slices);
    expect(sliceIds).toHaveLength(1);
    expect(sliceIds[0]).toBe("001:tracer-1");
    expect(state.slices["001:tracer-1"].kind).toBe("tracer");
    expect(state.slices["001:tracer-1"].criterionIds).toEqual(["AC-001"]);
  });

  test("preserves completed criteria on re-sync", async () => {
    await writePrd("001-auth.md", SAMPLE_PRD);
    const state = await syncState(testDir);

    // Mark AC-001 as done
    state.prds["001"].criteria["AC-001"].status = "done";
    state.prds["001"].criteria["AC-001"].completedAt =
      "2026-03-23T00:00:00.000Z";
    await writeState(testDir, state);

    // Re-sync
    const resynced = await syncState(testDir);
    expect(resynced.prds["001"].criteria["AC-001"].status).toBe("done");
    expect(resynced.prds["001"].criteria["AC-002"].status).toBe("pending");
    expect(resynced.prds["001"].status).toBe("in_progress");
  });

  test("archives deleted PRDs", async () => {
    await writePrd("001-auth.md", SAMPLE_PRD);
    await syncState(testDir);

    // Delete the PRD file
    await Bun.$`rm ${path.join(prdDir, "001-auth.md")}`.quiet();

    const state = await syncState(testDir);
    expect(state.prds["001"].status).toBe("archived");
  });

  test("does not create duplicate tracer slices on re-sync", async () => {
    await writePrd("001-auth.md", SAMPLE_PRD);
    await syncState(testDir);
    const state = await syncState(testDir);

    const tracers = Object.values(state.slices).filter(
      (s) => s.kind === "tracer"
    );
    expect(tracers).toHaveLength(1);
  });

  test("picks up new PRDs on re-sync", async () => {
    await writePrd("001-auth.md", SAMPLE_PRD);
    await syncState(testDir);

    await writePrd(
      "002-db.md",
      `# Database

## Acceptance Criteria

- [ ] AC-001 Tables created
`
    );

    const state = await syncState(testDir);
    expect(Object.keys(state.prds)).toEqual(["001", "002"]);
    expect(Object.keys(state.slices)).toHaveLength(2);
  });
});
