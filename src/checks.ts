export interface CheckResult {
  pass: boolean;
  results: {
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  }[];
}

export async function runChecks(
  commands: string[],
  projectRoot: string
): Promise<CheckResult> {
  const results: CheckResult["results"] = [];

  for (const command of commands) {
    // Delegate to sh for proper handling of quoting, pipes, env vars, etc.
    const proc = Bun.spawn(["sh", "-c", command], {
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    results.push({ command, exitCode, stdout, stderr });
  }

  return {
    pass: results.every((result) => result.exitCode === 0),
    results,
  };
}
