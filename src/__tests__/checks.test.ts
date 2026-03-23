import { describe, expect, test } from "bun:test";
import { runChecks } from "../checks";

describe("runChecks", () => {
  test("passes when all commands succeed", async () => {
    const result = await runChecks(["true", "true"], "/tmp");
    expect(result.pass).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].exitCode).toBe(0);
  });

  test("fails when any command fails", async () => {
    const result = await runChecks(["true", "false"], "/tmp");
    expect(result.pass).toBe(false);
    expect(result.results[0].exitCode).toBe(0);
    expect(result.results[1].exitCode).toBe(1);
  });

  test("captures stdout", async () => {
    const result = await runChecks(["echo hello"], "/tmp");
    expect(result.pass).toBe(true);
    expect(result.results[0].stdout).toContain("hello");
  });
});
