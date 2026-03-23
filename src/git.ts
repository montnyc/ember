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

export async function hasNewCommits(since: string): Promise<boolean> {
  const current = await getHead();
  return current !== since;
}

export async function getDiff(since: string): Promise<string> {
  const result = await Bun.$`git -C ${_projectRoot} diff ${since}..HEAD`.quiet();
  return result.text();
}

/**
 * Get all changes relative to HEAD — both committed (by the model) and
 * uncommitted (staged + unstaged + untracked). This is the correct diff
 * surface for review when Ember owns commits.
 */
export async function getFullDiff(): Promise<string> {
  // Mark untracked files as "intent to add" so they appear in the diff.
  // Without this, new files created by the model would be invisible.
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
 * Soft-reset any commits the model created back to the given ref, keeping the
 * file changes as uncommitted edits. This enforces the "ember" commit policy:
 * the model may have ignored the "do not commit" instruction, so we undo the
 * commits while preserving the actual code changes for review.
 */
export async function softResetTo(ref: string): Promise<void> {
  const current = await getHead();
  if (current !== ref) {
    console.log(`[git] Resetting model-created commits back to ${ref.slice(0, 8)}`);
    await Bun.$`git -C ${_projectRoot} reset --soft ${ref}`.quiet();
  }
}

/**
 * Discard all uncommitted changes (staged, unstaged, and untracked files).
 * Used after a failed slice to restore a clean tree before the next iteration,
 * so partial edits from a failed slice don't leak into subsequent slices.
 */
export async function resetWorkingTree(): Promise<void> {
  await Bun.$`git -C ${_projectRoot} checkout HEAD -- .`.quiet();
  await Bun.$`git -C ${_projectRoot} clean -fd`.quiet();
}
