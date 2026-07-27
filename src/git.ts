import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function runGit(
  repository: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(
      "git",
      ["-c", "core.quotepath=false", "-C", repository, ...args],
      {
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
        timeout: 15_000,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: "0",
          GIT_TERMINAL_PROMPT: "0"
        }
      }
    );
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const detail = error as Error & { stdout?: string; stderr?: string };
    throw new Error(detail.stderr?.trim() || detail.stdout?.trim() || detail.message);
  }
}

export async function listTrackedFiles(repository: string): Promise<string[]> {
  const { stdout } = await runGit(repository, ["ls-files", "-z"]);
  return stdout
    .split("\0")
    .filter(Boolean)
    .map((item) => item.replaceAll("\\", "/"));
}
