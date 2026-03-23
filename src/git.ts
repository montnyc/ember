/**
 * All git operations run against the project root, not the cwd of the ember
 * CLI process. This matters because ember/ is a subdirectory of the repo.
 */

let _projectRoot = ".";

export function setGitRoot(projectRoot: string): void {
  _projectRoot = projectRoot;
}

export async function getHead(): Promise<string> {
  const result = await Bun.$`git -C ${_projectRoot} rev-parse HEAD`.quiet();
  return result.text().trim();
}

/**
 * Get all changes relative to HEAD — committed, uncommitted, and untracked.
 * Stages untracked files with intent-to-add first so new files show up.
 */
export async function getFullDiff(): Promise<string> {
  await Bun.$`git -C ${_projectRoot} add -N .`.quiet();
  const result = await Bun.$`git -C ${_projectRoot} diff HEAD`.quiet();
  return result.text();
}

export async function commitAll(message: string): Promise<string | null> {
  const hasChanges = await hasUncommittedChanges();
  if (!hasChanges) return null;

  await Bun.$`git -C ${_projectRoot} add -A`.quiet();
  await Bun.$`git -C ${_projectRoot} commit -m ${message}`.quiet();
  return getHead();
}

export async function hasUncommittedChanges(): Promise<boolean> {
  const result = await Bun.$`git -C ${_projectRoot} status --porcelain`.quiet();
  return result.text().trim().length > 0;
}

/**
 * Asserts the working tree is clean. Ember must not run against a dirty tree
 * because commitAll() uses `git add -A`, which would sweep in unrelated edits.
 */
export async function assertCleanWorkingTree(): Promise<void> {
  if (await hasUncommittedChanges()) {
    throw new Error(
      "Working tree is not clean. Commit or stash your changes before running Ember."
    );
  }
}

/**
 * Discard all uncommitted changes (staged, unstaged, and untracked files).
 * Used after a failed slice to restore a clean tree before the next iteration.
 */
export async function resetWorkingTree(): Promise<void> {
  await Bun.$`git -C ${_projectRoot} checkout HEAD -- .`.quiet();
  await Bun.$`git -C ${_projectRoot} clean -fd`.quiet();
}
