import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { matchesAnyGlob } from "./discover.js";
import { listTrackedFiles, runGit } from "./git.js";
import { loadRepositoryConfig } from "./repository-config.js";
import { prioritiseActions, scoreRepository } from "./scoring.js";
import type {
  ConfidenceLevel,
  Finding,
  ProjectType,
  RepoDoctorConfig,
  RepositoryReport
} from "./types.js";

const readLimit = 512 * 1024;
const textExtensions = new Set([
  ".astro",
  ".bash",
  ".c",
  ".cc",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".dart",
  ".env",
  ".go",
  ".graphql",
  ".h",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".md",
  ".mjs",
  ".php",
  ".properties",
  ".ps1",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml"
]);
const sourceExtensions = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".dart",
  ".go",
  ".h",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".svelte",
  ".swift",
  ".ts",
  ".tsx",
  ".vue"
]);
const ignoredContentPrefixes = [
  ".dart_tool/",
  ".next/",
  ".nuxt/",
  "build/",
  "coverage/",
  "dist/",
  "node_modules/",
  "public/build/",
  "target/",
  "vendor/"
];
const generatedPatterns = [
  /^build\//i,
  /^dist\//i,
  /^coverage\//i,
  /^node_modules\//i,
  /^vendor\//i,
  /^\.next\//i,
  /^\.dart_tool\//i,
  /\.min\.(?:js|css)$/i,
  /\.map$/i,
  /\.generated\./i,
  /\.g\.dart$/i
];
const deploymentFiles = [
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "vercel.json",
  "netlify.toml",
  "render.yaml",
  "fly.toml",
  "firebase.json",
  "app.json",
  "Procfile",
  "railway.json",
  "serverless.yml",
  "wrangler.toml"
];
const lockFiles = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "pubspec.lock",
  "composer.lock",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "Cargo.lock",
  "Gemfile.lock"
];

interface TextFile {
  path: string;
  content: string;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      const value = values[index];
      if (value !== undefined) results[index] = await operation(value);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker())
  );
  return results;
}

function addFinding(
  findings: Finding[],
  finding: Omit<
    Finding,
    "evidence" | "confidence" | "status" | "effort" | "likelyImpact"
  > & {
    evidence?: string[];
    confidence?: ConfidenceLevel;
    status?: Finding["status"];
    effort?: Finding["effort"];
    likelyImpact?: Finding["likelyImpact"];
  }
): void {
  if (findings.some((existing) => existing.id === finding.id)) return;
  const confidence: ConfidenceLevel =
    finding.confidence ??
    (finding.id === "security-secret-patterns"
      ? "low"
      : finding.severity === "confirmed" || finding.severity === "info"
        ? "high"
        : "medium");
  const effort: Finding["effort"] =
    finding.effort ??
    (finding.id === "security-sensitive-files"
      ? "large"
      : finding.id.includes("tests-missing") ||
          finding.id.includes("deployment") ||
          finding.id.includes("source")
        ? "medium"
        : "small");
  const likelyImpact: Finding["likelyImpact"] =
    finding.likelyImpact ??
    (finding.category === "security" ||
    finding.id.includes("package-json-malformed")
      ? "high"
      : finding.category === "testing" ||
          finding.category === "maintainability" ||
          finding.category === "deployment"
        ? "medium"
        : "low");
  findings.push({
    ...finding,
    evidence: finding.evidence ?? [],
    confidence,
    status:
      finding.status ??
      (finding.severity === "confirmed" ? "failed" : "warning"),
    effort,
    likelyImpact
  });
}

function hasFile(files: string[], candidate: string): boolean {
  return files.some((file) => file.toLowerCase() === candidate.toLowerCase());
}

function findFiles(files: string[], matcher: RegExp): string[] {
  return files.filter((file) => matcher.test(file));
}

async function readText(repository: string, relativePath: string): Promise<string | null> {
  try {
    const absolute = path.join(repository, ...relativePath.split("/"));
    const info = await stat(absolute);
    if (!info.isFile() || info.size > readLimit) return null;
    const buffer = await readFile(absolute);
    if (buffer.includes(0)) return null;
    return buffer.toString("utf8");
  } catch {
    return null;
  }
}

async function loadTextFiles(repository: string, files: string[]): Promise<TextFile[]> {
  const candidates = files.filter((file) => {
    if (ignoredContentPrefixes.some((prefix) => file.startsWith(prefix))) return false;
    const basename = path.posix.basename(file).toLowerCase();
    return (
      textExtensions.has(path.posix.extname(file).toLowerCase()) ||
      basename === "dockerfile" ||
      basename === "procfile" ||
      basename === "makefile"
    );
  });
  const loaded = await mapWithConcurrency(
    candidates,
    24,
    async (file) => {
      const content = await readText(repository, file);
      return content === null ? null : { path: file, content };
    }
  );
  return loaded.filter((item): item is TextFile => item !== null);
}

function detectProjectTypes(files: string[], texts: Map<string, string>): ProjectType[] {
  const types = new Set<ProjectType>();
  const packageJson = texts.get("package.json");
  if (packageJson) {
    types.add("node");
    try {
      const parsed = JSON.parse(packageJson) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const dependencies = { ...parsed.dependencies, ...parsed.devDependencies };
      if ("next" in dependencies) types.add("nextjs");
      if ("vite" in dependencies && ("react" in dependencies || "preact" in dependencies)) {
        types.add("react-vite");
      }
    } catch {
      // A malformed manifest is reported separately.
    }
  }
  if (hasFile(files, "pubspec.yaml")) types.add("flutter");
  if (hasFile(files, "artisan") && hasFile(files, "composer.json")) types.add("laravel");
  if (
    ["pyproject.toml", "requirements.txt", "Pipfile", "setup.py"].some((file) =>
      hasFile(files, file)
    )
  ) {
    types.add("python");
  }
  if (
    hasFile(files, "index.html") &&
    !types.has("nextjs") &&
    !types.has("react-vite") &&
    !types.has("laravel")
  ) {
    types.add("static-web");
  }
  return types.size ? [...types] : ["unknown"];
}

function parsePackageJson(content: string | undefined): {
  scripts: Record<string, string>;
  description?: string;
  malformed: boolean;
} {
  if (!content) return { scripts: {}, malformed: false };
  try {
    const parsed = JSON.parse(content) as {
      scripts?: unknown;
      description?: unknown;
    };
    return {
      scripts:
        parsed.scripts && typeof parsed.scripts === "object"
          ? (parsed.scripts as Record<string, string>)
          : {},
      ...(typeof parsed.description === "string"
        ? { description: parsed.description.trim() }
        : {}),
      malformed: false
    };
  } catch {
    return { scripts: {}, malformed: true };
  }
}

function inferDescription(readme: string | undefined, packageDescription?: string): string | undefined {
  if (packageDescription && packageDescription.length >= 12) return packageDescription;
  if (!readme) return undefined;
  const boilerplate =
    /\b(?:laravel is a web application framework|simple, fast routing engine|powerful dependency injection container|this is a next\.?js project bootstrapped|a new flutter project|vite \+ react)\b/i;
  const paragraph = readme
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .split(/\r?\n\r?\n/)
    .map((item) => item.replace(/^#+\s+.*$/gm, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim())
    .find(
      (item) =>
        item.length >= 30 &&
        !item.startsWith("!") &&
        !boilerplate.test(item)
    );
  return paragraph?.replace(/\s+/g, " ").slice(0, 240);
}

function inspectReadme(
  files: string[],
  texts: Map<string, string>,
  profile: RepositoryReport["profile"],
  findings: Finding[]
): string | undefined {
  const readmePath = files.find((file) => /^readme(?:\.[^/]+)?$/i.test(file));
  if (!readmePath) {
    addFinding(findings, {
      id: "docs-readme-missing",
      category: "documentation",
      severity: "confirmed",
      title: "No root README was found",
      explanation: "A repository without a root README gives new users no reliable starting point.",
      deduction: profile === "tiny" ? 14 : 24,
      action: "Add a concise README covering purpose, setup, and one working usage example."
    });
    return undefined;
  }
  const readme = texts.get(readmePath);
  if (!readme) return undefined;
  if (readme.trim().length < 240) {
    addFinding(findings, {
      id: "docs-readme-thin",
      category: "documentation",
      severity: "confirmed",
      title: "README content is very limited",
      explanation: `The root README contains only ${readme.trim().length} characters, so it is unlikely to orient a new user.`,
      evidence: [readmePath],
      deduction: profile === "tiny" ? 7 : 13,
      action: "Expand the README with the project purpose, prerequisites, setup, and usage."
    });
  }
  const hasInstall = /\b(install|installation|setup|getting started|prerequisite)\b/i.test(readme);
  const hasUsage = /\b(usage|run|example|quick start|how to use)\b/i.test(readme);
  if (!hasInstall) {
    addFinding(findings, {
      id: "docs-install-missing",
      category: "documentation",
      severity: "confirmed",
      title: "Installation or setup instructions are not evident",
      explanation: "The README does not contain a recognizable setup or installation section.",
      evidence: [readmePath],
      deduction: profile === "tiny" ? 5 : 10,
      action: "Document prerequisites and exact setup commands that can be copied safely."
    });
  }
  if (!hasUsage) {
    addFinding(findings, {
      id: "docs-usage-missing",
      category: "documentation",
      severity: "confirmed",
      title: "Usage guidance is not evident",
      explanation: "The README does not explain how to run or use the project.",
      evidence: [readmePath],
      deduction: profile === "tiny" ? 5 : 10,
      action: "Add one minimal, verified usage example and describe the expected result."
    });
  }
  if (!/!\[[^\]]*]\([^)]+\)|<img\b/i.test(readme)) {
    addFinding(findings, {
      id: "portfolio-visuals-missing",
      category: "portfolio",
      severity: "possible",
      title: "No screenshots or visual examples were detected",
      explanation: "Visuals may not be relevant for a library or backend, but they materially improve presentation for user-facing projects.",
      evidence: [readmePath],
      deduction: profile === "tiny" ? 2 : 6,
      action: "If the project has a UI, add a current screenshot or short demo animation."
    });
  }
  if (!/https?:\/\/(?!localhost|127\.0\.0\.1)[^\s)>]+/i.test(readme)) {
    addFinding(findings, {
      id: "portfolio-demo-missing",
      category: "portfolio",
      severity: "possible",
      title: "No public demo or project link was detected",
      explanation: "A live link is optional, especially for local tools and libraries, but helps reviewers verify user-facing projects.",
      evidence: [readmePath],
      deduction: profile === "tiny" ? 1 : 4,
      action: "If a safe public deployment exists, link it from the README."
    });
  }
  return readme;
}

function inspectSecurity(
  files: string[],
  textFiles: TextFile[],
  profile: RepositoryReport["profile"],
  findings: Finding[]
): boolean {
  if (!hasFile(files, ".gitignore")) {
    addFinding(findings, {
      id: "security-gitignore-missing",
      category: "security",
      severity: "confirmed",
      title: "No root .gitignore was found",
      explanation: "Without an ignore policy, local credentials, build output, and editor files are easier to commit accidentally.",
      deduction: profile === "tiny" ? 8 : 14,
      action: "Add a technology-appropriate .gitignore, including environment and local credential files."
    });
  }

  const suspiciousFiles = files.filter((file) => {
    const base = path.posix.basename(file).toLowerCase();
    return (
      /^\.env(?:\..+)?$/.test(base) && !/example|sample|template/.test(base) ||
      /\.(?:pem|p12|pfx|key|keystore)$/i.test(base) ||
      /(?:credentials|service[-_]?account|secrets?)\.json$/i.test(base) ||
      /^id_(?:rsa|dsa|ecdsa|ed25519)$/i.test(base)
    );
  });
  const fixtureOrGeneratedSuspiciousFiles = suspiciousFiles.filter((file) =>
    /^(?:node_modules|vendor|build|dist)\/|(?:^|\/)fixtures?\//i.test(file)
  );
  const directSuspiciousFiles = suspiciousFiles.filter(
    (file) => !fixtureOrGeneratedSuspiciousFiles.includes(file)
  );
  if (directSuspiciousFiles.length) {
    addFinding(findings, {
      id: "security-sensitive-files",
      category: "security",
      severity: "confirmed",
      title: "Suspicious credential or environment files are tracked",
      explanation: "The filenames strongly suggest local environment data, private keys, or credentials. Content was not included in the report.",
      evidence: directSuspiciousFiles.slice(0, 12),
      deduction: 35,
      action: "Verify exposure, rotate any real credentials, remove sensitive files from Git history, and add safe ignore rules."
    });
  }
  if (fixtureOrGeneratedSuspiciousFiles.length) {
    addFinding(findings, {
      id: "security-sensitive-generated-files",
      category: "security",
      severity: "possible",
      title: "Credential-shaped files exist in generated or fixture paths",
      explanation: "These are likely vendored test fixtures rather than live credentials, but generated dependency trees should generally not be tracked and the files still merit confirmation.",
      evidence: fixtureOrGeneratedSuspiciousFiles.slice(0, 12),
      deduction: 8,
      action: "Confirm the files are inert fixtures, then untrack the generated or vendored directory and add it to .gitignore."
    });
  }

  const secretPatterns: Array<{ label: string; regex: RegExp }> = [
    { label: "private key material", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
    { label: "AWS access key identifier", regex: /\bAKIA[0-9A-Z]{16}\b/g },
    { label: "GitHub token", regex: /\bgh[opurs]_[A-Za-z0-9_]{30,}\b/g },
    { label: "Slack token", regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
    {
      label: "credential assignment",
      regex:
        /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password)\s*[:=]\s*["'][^"' \r\n]{12,}["']/gi
    }
  ];
  const secretEvidence: string[] = [];
  for (const file of textFiles) {
    const base = path.posix.basename(file.path).toLowerCase();
    const isTemplate = /example|sample|template/.test(base);
    for (const { label, regex } of secretPatterns) {
      regex.lastIndex = 0;
      const match = regex.exec(file.content);
      if (match && !isTemplate) {
        const line = file.content.slice(0, match.index).split(/\r?\n/).length;
        secretEvidence.push(`${file.path}:${line} — ${label} (value redacted)`);
      }
    }
  }
  if (secretEvidence.length) {
    addFinding(findings, {
      id: "security-secret-patterns",
      category: "security",
      severity: "possible",
      title: "Possible hard-coded credentials were detected",
      explanation: "Pattern matching found credential-shaped text. These are possible concerns until a human confirms that the values are real.",
      evidence: secretEvidence.slice(0, 20),
      deduction: 25,
      action: "Review each redacted location, rotate confirmed secrets, and replace hard-coded values with environment variables."
    });
  }

  const usesEnvironment = textFiles.some(
    (file) =>
      !/\.md$/i.test(file.path) &&
      /\b(?:process\.env|import\.meta\.env|os\.environ|getenv\(|env\(|dotenv|String\.fromEnvironment)\b/.test(
        file.content
      )
  );
  const hasEnvTemplate = files.some((file) =>
    /^\.env\.(?:example|sample|template)$/i.test(path.posix.basename(file))
  );
  if (usesEnvironment && !hasEnvTemplate) {
    addFinding(findings, {
      id: "security-env-template-missing",
      category: "security",
      severity: "confirmed",
      title: "Environment variables are used but no .env example is tracked",
      explanation: "Required configuration is harder to reproduce safely when variable names and placeholder values are undocumented.",
      deduction: profile === "tiny" ? 5 : 9,
      action: "Add a .env.example containing variable names and clearly fake placeholder values only."
    });
  }
  return usesEnvironment;
}

function inspectAutomation(
  files: string[],
  types: ProjectType[],
  packageInfo: ReturnType<typeof parsePackageJson>,
  profile: RepositoryReport["profile"],
  productionFacing: boolean | null,
  findings: Finding[]
): void {
  const scripts = packageInfo.scripts;
  const hasTest =
    Object.keys(scripts).some((key) => /^test(?::|$)/.test(key)) ||
    hasFile(files, "pytest.ini") ||
    hasFile(files, "phpunit.xml") ||
    hasFile(files, "phpunit.xml.dist") ||
    findFiles(files, /(?:^|\/)(?:test|tests|__tests__)\/.+/i).length > 0 ||
    findFiles(files, /(?:_test\.dart|_test\.py|\.test\.[jt]sx?|\.spec\.[jt]sx?)$/i).length > 0;
  if (!hasTest) {
    addFinding(findings, {
      id: "testing-tests-missing",
      category: "testing",
      severity: "confirmed",
      title: "No automated tests or test script were detected",
      explanation:
        profile === "tiny"
          ? "Tests may be intentionally omitted in a small experiment, but important behavior has no regression protection."
          : "No conventional test suite or test command was found for this codebase.",
      deduction: profile === "tiny" ? 12 : 25,
      action: "Add a small test suite around the most important behavior and document the test command."
    });
  }
  const hasLint =
    Object.keys(scripts).some((key) => /^lint(?::|$)/.test(key)) ||
    files.some((file) =>
      /(?:^|\/)(?:eslint\.config\.|\.eslintrc|analysis_options\.yaml|ruff\.toml|phpstan\.neon)/i.test(file)
    );
  if (!hasLint && types.some((type) => type !== "unknown" && type !== "static-web")) {
    addFinding(findings, {
      id: "maintainability-lint-missing",
      category: "maintainability",
      severity: "confirmed",
      title: "No lint command or conventional lint configuration was detected",
      explanation: "Automated static checks reduce style drift and catch common defects before review.",
      deduction: profile === "tiny" ? 4 : 9,
      action: "Configure a lightweight linter and expose one documented command."
    });
  }
  const hasBuild =
    Object.keys(scripts).some((key) => /^build(?::|$)/.test(key)) ||
    types.includes("flutter") ||
    types.includes("laravel") ||
    types.includes("python");
  if (!hasBuild && types.some((type) => ["nextjs", "react-vite", "node"].includes(type))) {
    addFinding(findings, {
      id: "maintainability-build-missing",
      category: "maintainability",
      severity: "possible",
      title: "No build script was detected",
      explanation: "This may be valid for a script-only package, but application projects normally need a reproducible build command.",
      deduction: profile === "tiny" ? 3 : 7,
      action: "If the project produces build output, add and document a deterministic build script."
    });
  }
  const workflows = findFiles(files, /^\.github\/workflows\/[^/]+\.(?:yml|yaml)$/i);
  if (
    !workflows.length &&
    (profile !== "tiny" || productionFacing === true)
  ) {
    addFinding(findings, {
      id: "testing-ci-missing",
      category: "testing",
      severity: "possible",
      title: "No GitHub Actions workflow was detected",
      explanation: "CI is not mandatory for every repository, but substantial projects benefit from running checks on every change.",
      deduction: 9,
      action: "Add a minimal CI workflow that installs dependencies and runs the existing lint, build, and test commands."
    });
  }
}

function inspectRepositoryShape(
  files: string[],
  fileSizes: Map<string, number>,
  sourceFileCount: number,
  config: RepoDoctorConfig,
  profile: RepositoryReport["profile"],
  findings: Finding[]
): void {
  const manifests = files.filter((file) =>
    /(?:^|\/)(?:package\.json|pubspec\.yaml|composer\.json|pyproject\.toml|requirements\.txt|Pipfile|setup\.py)$/i.test(
      file
    )
  );
  if (!manifests.length && sourceFileCount > 3) {
    addFinding(findings, {
      id: "maintainability-manifest-missing",
      category: "maintainability",
      severity: "possible",
      title: "No conventional package or dependency manifest was detected",
      explanation: "The project may be dependency-free, but its runtime and dependency expectations are not machine-readable.",
      deduction: profile === "tiny" ? 3 : 8,
      action: "If dependencies or runtime constraints exist, capture them in the ecosystem's standard manifest."
    });
  }
  if (
    manifests.some((file) => /(?:package\.json|pubspec\.yaml|composer\.json|pyproject\.toml|Pipfile)$/i.test(file)) &&
    !files.some((file) => lockFiles.some((lock) => file.toLowerCase() === lock.toLowerCase()))
  ) {
    addFinding(findings, {
      id: "maintainability-lock-missing",
      category: "maintainability",
      severity: "confirmed",
      title: "A dependency manifest exists without a recognized lock file",
      explanation: "Application installs may resolve different dependency versions over time.",
      evidence: manifests.slice(0, 8),
      deduction: profile === "tiny" ? 4 : 9,
      action: "Generate and commit the ecosystem's lock file if this is an application rather than a reusable library."
    });
  }
  const rootSourceFiles = files.filter(
    (file) => !file.includes("/") && sourceExtensions.has(path.posix.extname(file).toLowerCase())
  );
  if (sourceFileCount >= 12 && rootSourceFiles.length / sourceFileCount > 0.6) {
    addFinding(findings, {
      id: "maintainability-flat-source",
      category: "maintainability",
      severity: "possible",
      title: "Most source files are stored at the repository root",
      explanation: "A flat root becomes harder to navigate as the project grows.",
      evidence: rootSourceFiles.slice(0, 10),
      deduction: 6,
      action: "Group implementation files under a conventional source directory while preserving clear entry points."
    });
  }
  const generated = files.filter((file) => generatedPatterns.some((pattern) => pattern.test(file)));
  if (generated.length) {
    addFinding(findings, {
      id: "maintainability-generated-tracked",
      category: "maintainability",
      severity: "possible",
      title: "Generated or build-like files are tracked",
      explanation: "Some generated artifacts are intentional, but build output often creates noisy diffs and repository bloat.",
      evidence: generated.slice(0, 15),
      deduction: Math.min(14, 4 + Math.floor(generated.length / 20)),
      action: "Confirm which artifacts are required; ignore and untrack reproducible build output."
    });
  }
  const largeFiles = [...fileSizes.entries()]
    .filter(([, size]) => size >= config.largeFileBytes)
    .sort((a, b) => b[1] - a[1]);
  if (largeFiles.length) {
    addFinding(findings, {
      id: "maintainability-large-files",
      category: "maintainability",
      severity: "possible",
      title: "Large tracked files were found",
      explanation: `Files at or above ${(config.largeFileBytes / 1024 / 1024).toFixed(1)} MiB can make clones and history expensive. Media assets may be intentional.`,
      evidence: largeFiles
        .slice(0, 12)
        .map(([file, size]) => `${file} (${(size / 1024 / 1024).toFixed(2)} MiB)`),
      deduction: Math.min(15, 4 + largeFiles.length),
      action: "Verify that each large file belongs in Git; use optimized assets or Git LFS where appropriate."
    });
  }
}

function inspectContent(
  textFiles: TextFile[],
  profile: RepositoryReport["profile"],
  findings: Finding[]
): void {
  let todoCount = 0;
  let placeholderCount = 0;
  const todoEvidence: string[] = [];
  const placeholderEvidence: string[] = [];
  for (const file of textFiles) {
    const lines = file.content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/\b(?:TODO|FIXME|HACK|XXX)\b/.test(line)) {
        todoCount += 1;
        if (todoEvidence.length < 12) todoEvidence.push(`${file.path}:${index + 1}`);
      }
      if (
        /\b(?:lorem ipsum|coming soon|under construction|replace me|your[-_ ]?(?:api[-_ ]?key|domain|name)|example\.com)\b/i.test(
          line
        )
      ) {
        placeholderCount += 1;
        if (placeholderEvidence.length < 12) {
          placeholderEvidence.push(`${file.path}:${index + 1}`);
        }
      }
    });
  }
  if (todoCount >= (profile === "tiny" ? 5 : 12)) {
    addFinding(findings, {
      id: "maintainability-todos",
      category: "maintainability",
      severity: "possible",
      title: `${todoCount} TODO, FIXME, or similar markers were detected`,
      explanation: "Markers are useful when deliberate, but a high count can signal deferred cleanup or incomplete behavior.",
      evidence: todoEvidence,
      deduction: Math.min(10, 3 + Math.floor(todoCount / 10)),
      action: "Triage markers: resolve urgent ones, convert real work into issues, and remove stale notes."
    });
  }
  if (placeholderCount > 0) {
    addFinding(findings, {
      id: "portfolio-placeholders",
      category: "portfolio",
      severity: "possible",
      title: `${placeholderCount} placeholder-like content occurrence${placeholderCount === 1 ? "" : "s"} detected`,
      explanation: "Placeholder strings can make a project look unfinished, although examples and templates may intentionally contain them.",
      evidence: placeholderEvidence,
      deduction: Math.min(12, 3 + placeholderCount),
      action: "Review each location and replace user-facing placeholders while retaining intentional examples."
    });
  }
}

function inspectDeployment(
  files: string[],
  types: ProjectType[],
  profile: RepositoryReport["profile"],
  productionFacing: boolean | null,
  findings: Finding[]
): void {
  const deploymentEvidence = files.filter(
    (file) =>
      deploymentFiles.some((candidate) => file.toLowerCase() === candidate.toLowerCase()) ||
      /^\.github\/workflows\/.*deploy.*\.(?:yml|yaml)$/i.test(file) ||
      /^(?:android|ios|web)\//i.test(file) && types.includes("flutter")
  );
  const likelyDeployable =
    productionFacing === true ||
    types.some((type) =>
      ["nextjs", "react-vite", "flutter", "laravel", "static-web"].includes(type)
    );
  if (likelyDeployable && deploymentEvidence.length === 0) {
    addFinding(findings, {
      id: "deployment-config-missing",
      category: "deployment",
      severity: "possible",
      title: "No recognizable deployment configuration was detected",
      explanation: "The project looks deployable, but the repository does not make the deployment path reproducible.",
      deduction: profile === "tiny" ? 7 : 16,
      action: "Document the intended deployment target and commit only the minimal reproducible configuration it needs."
    });
  }
}

function applyCustomRules(
  files: string[],
  types: ProjectType[],
  config: RepoDoctorConfig,
  findings: Finding[]
): void {
  for (const rule of config.customRules) {
    if (rule.projectTypes?.length && !rule.projectTypes.some((type) => types.includes(type))) {
      continue;
    }
    const matches = files.filter((file) => matchesAnyGlob(file, [rule.pattern]));
    const violated = rule.kind === "require-file" ? matches.length === 0 : matches.length > 0;
    if (!violated) continue;
    addFinding(findings, {
      id: `custom-${rule.id}`,
      category: rule.category,
      severity: rule.severity ?? "possible",
      title: rule.description,
      explanation: `Custom rule "${rule.id}" was not satisfied (${rule.kind}: ${rule.pattern}).`,
      evidence: matches.slice(0, 12),
      deduction: rule.deduction,
      action: `Address custom rule "${rule.id}" according to the team's repository policy.`
    });
  }
}

export async function scanRepository(
  repository: string,
  scanRoot: string,
  config: RepoDoctorConfig
): Promise<RepositoryReport> {
  const name = path.basename(repository);
  const relativePath = path.relative(scanRoot, repository) || ".";
  const errors: string[] = [];
  const repositoryConfigResult = await loadRepositoryConfig(repository);
  errors.push(...repositoryConfigResult.warnings);
  let files: string[] = [];
  try {
    files = await listTrackedFiles(repository);
  } catch (error) {
    errors.push(`Could not list tracked files: ${String(error)}`);
  }
  if (repositoryConfigResult.config.customExclusions?.length) {
    files = files.filter(
      (file) =>
        !matchesAnyGlob(
          file,
          repositoryConfigResult.config.customExclusions ?? []
        )
    );
  }

  const fileSizes = new Map<string, number>();
  await mapWithConcurrency(
    files,
    32,
    async (file) => {
      try {
        const info = await stat(path.join(repository, ...file.split("/")));
        if (info.isFile()) fileSizes.set(file, info.size);
      } catch {
        // A tracked-but-missing file is represented by Git status instead.
      }
    }
  );
  const trackedBytes = [...fileSizes.values()].reduce((sum, size) => sum + size, 0);
  const sourceFileCount = files.filter((file) =>
    sourceExtensions.has(path.posix.extname(file).toLowerCase())
  ).length;
  const profile: RepositoryReport["profile"] =
    sourceFileCount <= 8 && files.length <= 30
      ? "tiny"
      : sourceFileCount <= 60 && files.length <= 250
        ? "small"
        : "substantial";
  const textFiles = await loadTextFiles(repository, files);
  const texts = new Map(textFiles.map((file) => [file.path, file.content]));
  const detectedTypes = detectProjectTypes(files, texts);
  const types = repositoryConfigResult.config.intendedProjectType
    ? [repositoryConfigResult.config.intendedProjectType]
    : detectedTypes;
  const scoringProfile =
    repositoryConfigResult.config.scoringProfile ?? config.scoringProfile;
  const productionStatus =
    repositoryConfigResult.config.productionStatus ?? "unknown";
  const productionFacing =
    productionStatus === "production"
      ? true
      : productionStatus === "non-production"
        ? false
        : scoringProfile === "production" ||
            files.some(
              (file) =>
                deploymentFiles.some(
                  (candidate) =>
                    file.toLowerCase() === candidate.toLowerCase()
                ) ||
                /^\.github\/workflows\/.*deploy.*\.(?:yml|yaml)$/i.test(file)
            )
          ? true
          : null;
  const intent = {
    ...(repositoryConfigResult.config.intendedProjectType
      ? {
          intendedProjectType:
            repositoryConfigResult.config.intendedProjectType
        }
      : {}),
    productionStatus,
    private: repositoryConfigResult.config.private ?? null,
    scoringProfile,
    omittedChecks:
      repositoryConfigResult.config.intentionallyOmittedChecks ?? [],
    customExclusions: repositoryConfigResult.config.customExclusions ?? [],
    ...(repositoryConfigResult.path
      ? { configurationPath: repositoryConfigResult.path }
      : {})
  } satisfies RepositoryReport["intent"];
  const packageInfo = parsePackageJson(texts.get("package.json"));
  const findings: Finding[] = [];

  if (packageInfo.malformed) {
    addFinding(findings, {
      id: "maintainability-package-json-malformed",
      category: "maintainability",
      severity: "confirmed",
      title: "package.json is malformed",
      explanation: "The Node.js manifest could not be parsed as JSON, so package tooling will fail.",
      evidence: ["package.json"],
      deduction: 25,
      action: "Repair package.json and verify it with the package manager."
    });
  }
  const readme = inspectReadme(files, texts, profile, findings);
  const description = inferDescription(readme, packageInfo.description);
  if (!description) {
    addFinding(findings, {
      id: "portfolio-description-missing",
      category: "portfolio",
      severity: "confirmed",
      title: "A clear project description was not detected",
      explanation: "Neither the package manifest nor README provides a sufficiently descriptive summary.",
      deduction: profile === "tiny" ? 5 : 10,
      action: "Lead the README with one plain-language sentence explaining the project, audience, and value."
    });
  }
  if (!files.some((file) => /^(?:licen[cs]e|copying)(?:\..+)?$/i.test(file))) {
    addFinding(findings, {
      id: "docs-license-missing",
      category: "documentation",
      severity: "confirmed",
      title: "No root licence file was found",
      explanation: "Without a licence, reuse and contribution rights are unclear. Private repositories may intentionally omit one.",
      deduction: profile === "tiny" ? 4 : 7,
      action: "Add the intended licence or state clearly that the project is private/proprietary."
    });
  }
  const usesEnvironment = inspectSecurity(
    files,
    textFiles,
    profile,
    findings
  );
  inspectAutomation(
    files,
    types,
    packageInfo,
    profile,
    productionFacing,
    findings
  );
  inspectRepositoryShape(files, fileSizes, sourceFileCount, config, profile, findings);
  inspectContent(textFiles, profile, findings);
  inspectDeployment(files, types, profile, productionFacing, findings);
  applyCustomRules(files, types, config, findings);

  let branch: string | undefined;
  let clean: boolean | null = null;
  let statusNote: string | undefined;
  let lastCommitAt: string | undefined;
  let daysSinceLastCommit: number | undefined;
  let activity: RepositoryReport["git"]["activity"] = "unknown";
  try {
    const [statusResult, lastCommitResult] = await Promise.allSettled([
      runGit(repository, [
        "status",
        "--porcelain=v1",
        "--branch",
        "--untracked-files=normal"
      ]),
      runGit(repository, ["log", "-1", "--format=%aI"])
    ]);
    if (statusResult.status === "rejected") {
      throw statusResult.reason;
    }
    const statusLines = statusResult.value.stdout.split(/\r?\n/).filter(Boolean);
    const branchLine = statusLines.shift();
    branch = branchLine?.match(/^## (?:No commits yet on )?([^. ]+)/)?.[1];
    clean = statusLines.length === 0;
    if (!clean) {
      const trackedChanges = statusLines.filter((line) => !line.startsWith("??")).length;
      const untracked = statusLines.length - trackedChanges;
      statusNote = `${trackedChanges} tracked change(s), ${untracked} untracked path(s)`;
      addFinding(findings, {
        id: "maintainability-dirty-worktree",
        category: "maintainability",
        severity: "info",
        title: "The working tree is not clean",
        explanation: "This is a point-in-time observation, not necessarily a defect; uncommitted work can make the scan differ from the published repository.",
        evidence: [statusNote],
        deduction: 0
      });
    }
    if (lastCommitResult.status === "fulfilled") {
      lastCommitAt = lastCommitResult.value.stdout.trim() || undefined;
      if (lastCommitAt) {
        const ageMs = Date.now() - Date.parse(lastCommitAt);
        daysSinceLastCommit = Math.max(
          0,
          Math.floor(ageMs / (24 * 60 * 60 * 1000))
        );
        activity =
          daysSinceLastCommit <= 180
            ? "active"
            : daysSinceLastCommit <= 730
              ? "stale"
              : "possibly-abandoned";
      }
    }
  } catch (error) {
    errors.push(`Could not inspect Git status: ${String(error)}`);
  }

  findings.sort((a, b) => b.deduction - a.deduction || a.title.localeCompare(b.title));
  const readmePath = files.find((file) => /^readme(?:\.[^/]+)?$/i.test(file));
  const licencePath = files.find((file) => /^(?:licen[cs]e|copying)(?:\..+)?$/i.test(file));
  const environmentTemplates = files.filter((file) =>
    /^\.env\.(?:example|sample|template)$/i.test(path.posix.basename(file))
  );
  const manifests = files.filter((file) =>
    /(?:^|\/)(?:package\.json|pubspec\.yaml|composer\.json|pyproject\.toml|requirements\.txt|Pipfile|setup\.py)$/i.test(
      file
    )
  );
  const ciWorkflows = findFiles(files, /^\.github\/workflows\/[^/]+\.(?:yml|yaml)$/i);
  const detectedLocks = files.filter((file) =>
    lockFiles.some((lock) => file.toLowerCase() === lock.toLowerCase())
  );
  const detectedDeployment = files.filter(
    (file) =>
      deploymentFiles.some((candidate) => file.toLowerCase() === candidate.toLowerCase()) ||
      /^\.github\/workflows\/.*deploy.*\.(?:yml|yaml)$/i.test(file)
  );
  const visualAssets = files.filter((file) =>
    /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(file)
  );
  const sourceDirectories = [
    ...new Set(
      files
        .filter((file) => sourceExtensions.has(path.posix.extname(file).toLowerCase()))
        .map((file) => (file.includes("/") ? file.split("/")[0] : "."))
        .filter((directory): directory is string => Boolean(directory))
    )
  ].sort();
  const scoring = scoreRepository(findings, {
    projectTypes: types,
    sizeProfile: profile,
    scoringProfile,
    intent,
    productionFacing,
    trackedFileCount: files.length,
    sourceFileCount,
    hasManifest: manifests.length > 0,
    usesEnvironment,
    hasScanErrors: errors.length > 0,
    activity
  });
  const nextActions = prioritiseActions(
    findings,
    name,
    activity,
    productionFacing
  );
  return {
    name,
    path: repository,
    relativePath,
    projectTypes: types,
    profile,
    scoringProfile,
    intent,
    productionFacing,
    ...(description ? { description } : {}),
    trackedFileCount: files.length,
    sourceFileCount,
    trackedBytes,
    git: {
      clean,
      ...(branch ? { branch } : {}),
      ...(statusNote ? { statusNote } : {}),
      ...(lastCommitAt ? { lastCommitAt } : {}),
      ...(daysSinceLastCommit !== undefined ? { daysSinceLastCommit } : {}),
      activity
    },
    signals: {
      ...(readmePath ? { readme: readmePath } : {}),
      ...(licencePath ? { licence: licencePath } : {}),
      gitignore: hasFile(files, ".gitignore"),
      usesEnvironment,
      environmentTemplates,
      manifests,
      packageScripts: Object.keys(packageInfo.scripts).sort(),
      ciWorkflows,
      lockFiles: detectedLocks,
      deploymentFiles: detectedDeployment,
      visualAssets: visualAssets.slice(0, 20),
      sourceDirectories
    },
    checks: scoring.checks,
    findings,
    scores: scoring.scores,
    scoreBeforeCaps: scoring.scoreBeforeCaps,
    scoreCaps: scoring.caps,
    overallScore: scoring.overallScore,
    confidence: scoring.confidence,
    nextActions,
    errors
  };
}
