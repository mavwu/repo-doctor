import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { parseArguments } from "../src/cli.js";
import { discoverRepositories, runRepoDoctor, scanRepository } from "../src/index.js";
import { defaultConfig } from "../src/config.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "repo-doctor-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function createRepository(
  root: string,
  name: string,
  files: Record<string, string | Buffer>
): Promise<string> {
  const repository = path.join(root, name);
  await mkdir(repository, { recursive: true });
  await execFileAsync("git", ["init", "-q", repository], { windowsHide: true });
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(repository, ...relative.split("/"));
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  }
  await execFileAsync("git", ["-C", repository, "add", "."], { windowsHide: true });
  return repository;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("repository discovery", () => {
  it("finds nested Git repositories and respects ignore patterns", async () => {
    const root = await temporaryDirectory();
    await createRepository(root, "good", { "README.md": "# Good" });
    await createRepository(root, "archived-old", { "README.md": "# Old" });
    const result = await discoverRepositories(root, 3, ["archived-*"]);
    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0]).toBe(path.join(root, "good"));
  });
});

describe("repository scanning", () => {
  it("detects project type and useful missing-health checks", async () => {
    const root = await temporaryDirectory();
    const repository = await createRepository(root, "web-app", {
      "package.json": JSON.stringify({
        description: "A focused test web application",
        scripts: { build: "vite build" },
        dependencies: { react: "1.0.0" },
        devDependencies: { vite: "1.0.0" }
      }),
      "package-lock.json": "{}",
      "README.md": "# Web App\n\nA focused test web application for local demos.",
      "src/main.tsx": "export const value = import.meta.env.VITE_API_URL;\n"
    });
    const report = await scanRepository(repository, root, structuredClone(defaultConfig));
    expect(report.projectTypes).toContain("react-vite");
    expect(report.findings.map((finding) => finding.id)).toContain(
      "security-env-template-missing"
    );
    expect(report.findings.map((finding) => finding.id)).toContain(
      "testing-tests-missing"
    );
  });

  it("redacts possible secrets in all evidence", async () => {
    const root = await temporaryDirectory();
    const fakeToken = `ghp_${"a".repeat(36)}`;
    const repository = await createRepository(root, "unsafe", {
      "README.md":
        "# Unsafe\n\nA repository used to confirm safe redaction.\n\n## Setup\n\nInstall dependencies.\n\n## Usage\n\nRun the program.",
      ".gitignore": ".env\n",
      "src/config.ts": `export const token = "${fakeToken}";\n`
    });
    const report = await scanRepository(repository, root, structuredClone(defaultConfig));
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(fakeToken);
    expect(serialized).toContain("value redacted");
  });

  it("does not treat dependency test keys as confirmed live credentials", async () => {
    const root = await temporaryDirectory();
    const repository = await createRepository(root, "vendored-fixture", {
      "README.md":
        "# Fixture\n\nA repository used to classify vendored fixtures.\n\n## Setup\n\nNo setup.\n\n## Usage\n\nRun the fixture.",
      ".gitignore": "*.log\n",
      "node_modules/example/test/fixtures/server.key": "not-a-real-key"
    });
    const report = await scanRepository(repository, root, structuredClone(defaultConfig));
    const finding = report.findings.find(
      (item) => item.id === "security-sensitive-generated-files"
    );
    expect(finding?.severity).toBe("possible");
    expect(report.findings.map((item) => item.id)).not.toContain(
      "security-sensitive-files"
    );
  });

  it("does not mistake framework boilerplate for a project description", async () => {
    const root = await temporaryDirectory();
    const repository = await createRepository(root, "boilerplate", {
      "README.md":
        "# Laravel\n\n<p><img src=\"logo.svg\"></p>\n\nLaravel is a web application framework with expressive, elegant syntax.\n\n- Simple, fast routing engine.\n- Powerful dependency injection container.",
      "composer.json": "{}",
      "artisan": "#!/usr/bin/env php\n",
      "logo.svg": "<svg></svg>"
    });
    const report = await scanRepository(repository, root, structuredClone(defaultConfig));
    expect(report.description).toBeUndefined();
    expect(report.findings.map((item) => item.id)).toContain(
      "portfolio-description-missing"
    );
  });

  it("writes valid Markdown and structured JSON reports", async () => {
    const root = await temporaryDirectory();
    await createRepository(root, "sample", {
      "README.md":
        "# Sample\n\nA tiny sample repository.\n\n## Installation\n\nNo dependencies.\n\n## Usage\n\nOpen index.html.",
      "index.html": "<h1>Sample</h1>",
      ".gitignore": "*.log\n",
      "LICENSE": "MIT"
    });
    const output = path.join(root, "out");
    const result = await runRepoDoctor({
      directory: root,
      outputDirectory: output,
      quiet: true
    });
    const markdown = await readFile(result.markdownPath, "utf8");
    const json = JSON.parse(await readFile(result.jsonPath, "utf8")) as {
      schemaVersion: string;
      repositories: unknown[];
    };
    expect(markdown).toContain("# repo-doctor health report");
    expect(json.schemaVersion).toBe("1.0");
    expect(json.repositories).toHaveLength(1);
  });
});

describe("CLI argument parsing", () => {
  it("parses scan and safety-related options", () => {
    const parsed = parseArguments([
      ".",
      "--max-depth",
      "2",
      "--large-file-kb",
      "256",
      "--quiet"
    ]);
    expect(parsed).not.toBe("help");
    expect(parsed).not.toBe("version");
    if (typeof parsed === "object") {
      expect(parsed.maxDepth).toBe(2);
      expect(parsed.largeFileBytes).toBe(256 * 1024);
      expect(parsed.quiet).toBe(true);
    }
  });

  it("rejects missing scan paths", () => {
    expect(() => parseArguments([])).toThrow(/directory path is required/i);
  });
});
