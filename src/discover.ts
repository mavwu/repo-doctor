import { readdir } from "node:fs/promises";
import path from "node:path";

export const ignoredTraversalDirectories = new Set([
  ".cache",
  ".dart_tool",
  ".next",
  ".nuxt",
  ".output",
  ".terraform",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
  "venv"
]);

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*")
    .replaceAll("?", ".");
  return new RegExp(`^${escaped}$`, "i");
}

export function matchesAnyGlob(value: string, patterns: string[]): boolean {
  const normalized = value.replaceAll("\\", "/");
  return patterns.some((pattern) => {
    const matcher = globToRegExp(pattern);
    return matcher.test(normalized) || matcher.test(path.posix.basename(normalized));
  });
}

export async function discoverRepositories(
  root: string,
  maxDepth: number,
  ignores: string[]
): Promise<{ repositories: string[]; warnings: string[] }> {
  const repositories: string[] = [];
  const warnings: string[] = [];

  async function visit(directory: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      warnings.push(`Could not access ${directory}: ${String(error)}`);
      return;
    }
    if (entries.some((entry) => entry.name === ".git")) {
      const relative = path.relative(root, directory) || ".";
      if (!matchesAnyGlob(relative, ignores)) {
        repositories.push(directory);
      }
      return;
    }
    if (depth >= maxDepth) return;
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            !entry.isSymbolicLink() &&
            !ignoredTraversalDirectories.has(entry.name) &&
            !entry.name.startsWith(".")
        )
        .map((entry) => visit(path.join(directory, entry.name), depth + 1))
    );
  }

  await visit(root, 0);
  repositories.sort((a, b) => a.localeCompare(b));
  return { repositories, warnings };
}
