import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import {
  discoverRepositories,
  ignoredTraversalDirectories
} from "./discover.js";
import { createCodexPrompts, renderMarkdown } from "./report.js";
import { scanRepository } from "./scanner.js";
import type {
  CheckStatus,
  CliOptions,
  DirectoryReport,
  ProjectType,
  RankedRepository,
  RepositoryReport,
  Score,
  ScoreCategory
} from "./types.js";
import { scoreCategories } from "./types.js";

const toolVersion = "0.1.0";

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

function emptyStatusCounts(): Record<CheckStatus, number> {
  return {
    "not-applicable": 0,
    passed: 0,
    failed: 0,
    unknown: 1,
    warning: 0
  };
}

function emptyScore(): Score {
  return {
    value: 0,
    applicableWeight: 0,
    deductions: 100,
    possiblePoints: 0,
    earnedPoints: 0,
    statusCounts: emptyStatusCounts(),
    explanations: []
  };
}

function failedRepository(
  repository: string,
  directory: string,
  error: unknown,
  scoringProfile: RepositoryReport["scoringProfile"]
): RepositoryReport {
  return {
    name: path.basename(repository),
    path: repository,
    relativePath: path.relative(directory, repository),
    projectTypes: ["unknown"],
    profile: "tiny",
    scoringProfile,
    intent: {
      productionStatus: "unknown",
      private: null,
      scoringProfile,
      omittedChecks: [],
      customExclusions: []
    },
    productionFacing: null,
    trackedFileCount: 0,
    sourceFileCount: 0,
    trackedBytes: 0,
    git: { clean: null, activity: "unknown" },
    signals: {
      gitignore: false,
      usesEnvironment: false,
      environmentTemplates: [],
      manifests: [],
      packageScripts: [],
      ciWorkflows: [],
      lockFiles: [],
      deploymentFiles: [],
      visualAssets: [],
      sourceDirectories: []
    },
    checks: [],
    findings: [],
    scores: Object.fromEntries(
      scoreCategories.map((category) => [category, emptyScore()])
    ) as Record<ScoreCategory, Score>,
    scoreBeforeCaps: 0,
    scoreCaps: [],
    overallScore: 0,
    confidence: {
      level: "low",
      value: 0.2,
      reasons: ["Repository analysis failed."]
    },
    nextActions: [],
    errors: [String(error)]
  };
}

function primaryProjectType(types: ProjectType[]): ProjectType {
  const priority: ProjectType[] = [
    "nextjs",
    "react-vite",
    "flutter",
    "laravel",
    "python",
    "static-web",
    "node",
    "unknown"
  ];
  return priority.find((type) => types.includes(type)) ?? "unknown";
}

function applyPeerComparison(
  repositories: RepositoryReport[],
  enabled: boolean
): DirectoryReport["peerGroups"] {
  if (!enabled) return [];
  const grouped = new Map<string, RepositoryReport[]>();
  for (const repository of repositories) {
    const productionGroup =
      repository.intent.productionStatus === "unknown"
        ? "unspecified"
        : repository.intent.productionStatus;
    const group = `${primaryProjectType(repository.projectTypes)}/${productionGroup}`;
    const values = grouped.get(group) ?? [];
    values.push(repository);
    grouped.set(group, values);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, values]) => {
      values.sort(
        (a, b) =>
          b.overallScore - a.overallScore ||
          b.confidence.value - a.confidence.value ||
          a.name.localeCompare(b.name)
      );
      values.forEach((repository, index) => {
        const rank = index + 1;
        repository.comparison = {
          group,
          rank,
          outOf: values.length,
          percentile:
            values.length === 1
              ? 100
              : Math.round(
                  ((values.length - rank) / (values.length - 1)) * 100
                )
        };
      });
      return {
        group,
        repositories: values.map((repository) => repository.name),
        averageScore: Math.round(
          values.reduce(
            (sum, repository) => sum + repository.overallScore,
            0
          ) / values.length
        )
      };
    });
}

function ranked(
  repositories: RepositoryReport[],
  selector: (repository: RepositoryReport) => string,
  direction: "strongest" | "weakest",
  limit = 5
): RankedRepository[] {
  return repositories
    .slice()
    .sort((a, b) =>
      direction === "strongest"
        ? b.overallScore - a.overallScore ||
          b.confidence.value - a.confidence.value
        : a.overallScore - b.overallScore ||
          b.confidence.value - a.confidence.value
    )
    .slice(0, limit)
    .map((repository) => ({
      repository: repository.name,
      score: repository.overallScore,
      reason: selector(repository)
    }));
}

function highestRisk(repositories: RepositoryReport[]): RankedRepository[] {
  return repositories
    .map((repository) => {
      const critical = repository.nextActions.filter(
        (action) => action.urgency === "critical"
      ).length;
      const failedSecurity = repository.checks.filter(
        (check) => check.category === "security" && check.status === "failed"
      ).length;
      const securityCap = repository.scoreCaps.find((cap) =>
        cap.findingId.startsWith("security-")
      );
      const confirmedHighImpact = repository.findings.filter(
        (finding) =>
          finding.category === "security" &&
          finding.status === "failed" &&
          finding.confidence === "high" &&
          finding.likelyImpact === "high"
      ).length;
      return {
        repository,
        risk:
          (securityCap ? 500 + (100 - securityCap.value) : 0) +
          confirmedHighImpact * 200 +
          critical * 60 +
          failedSecurity * 30 +
          (100 - repository.scores.security.value)
      };
    })
    .filter(({ risk }) => risk > 0)
    .sort(
      (a, b) =>
        b.risk - a.risk ||
        a.repository.overallScore - b.repository.overallScore
    )
    .slice(0, 5)
    .map(({ repository }) => ({
      repository: repository.name,
      score: repository.overallScore,
      reason:
        repository.scoreCaps.find((cap) =>
          cap.findingId.startsWith("security-")
        )?.reason ??
        repository.findings.find(
          (finding) =>
            finding.category === "security" && finding.status === "failed"
        )?.title ??
        repository.findings.find(
          (finding) => finding.category === "security"
        )?.title ??
        "Security evidence requires review."
    }));
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle] ?? 0;
  return Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

export async function runRepoDoctor(options: CliOptions): Promise<{
  report: DirectoryReport;
  markdownPath: string;
  jsonPath: string;
}> {
  const startedAt = Date.now();
  const directory = path.resolve(options.directory);
  let directoryStat;
  try {
    directoryStat = await stat(directory);
  } catch {
    throw new Error(`Scan directory does not exist or is inaccessible: ${directory}`);
  }
  if (!directoryStat.isDirectory()) {
    throw new Error(`Scan path is not a directory: ${directory}`);
  }

  const loaded = await loadConfig(directory, options.configPath);
  if (options.maxDepth !== undefined) loaded.config.maxDepth = options.maxDepth;
  if (options.largeFileBytes !== undefined) {
    loaded.config.largeFileBytes = options.largeFileBytes;
  }
  if (options.scoringProfile) {
    loaded.config.scoringProfile = options.scoringProfile;
  }
  if (options.comparisonMode) {
    loaded.config.comparisonMode = options.comparisonMode;
  }
  const discovery = await discoverRepositories(
    directory,
    loaded.config.maxDepth,
    loaded.config.ignoreRepositories
  );
  const scanWarnings = [...loaded.warnings, ...discovery.warnings];
  const repositories = await mapWithConcurrency(
    discovery.repositories,
    4,
    async (repository): Promise<RepositoryReport> => {
      try {
        return await scanRepository(repository, directory, loaded.config);
      } catch (error) {
        scanWarnings.push(`Could not analyse ${repository}: ${String(error)}`);
        return failedRepository(
          repository,
          directory,
          error,
          loaded.config.scoringProfile
        );
      }
    }
  );
  const peerGroups = applyPeerComparison(
    repositories,
    loaded.config.comparisonMode === "peer"
  );
  const allActions = repositories
    .flatMap((repository) => repository.nextActions)
    .sort(
      (a, b) =>
        b.value - a.value ||
        a.effort.localeCompare(b.effort) ||
        a.repository.localeCompare(b.repository)
    );
  const topImprovements = allActions.slice(0, 15);
  const scores = repositories.map((repository) => repository.overallScore);
  const averageScore =
    scores.length > 0
      ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
      : 0;
  const averageConfidence =
    repositories.length > 0
      ? Number(
          (
            repositories.reduce(
              (sum, repository) => sum + repository.confidence.value,
              0
            ) / repositories.length
          ).toFixed(2)
        )
      : 0;
  const easiestImprovements = allActions
    .filter((action) => action.effort === "small")
    .slice(0, 8);
  const potentiallyAbandonedRepositories = repositories
    .filter((repository) => repository.git.activity === "possibly-abandoned")
    .sort(
      (a, b) =>
        (b.git.daysSinceLastCommit ?? 0) - (a.git.daysSinceLastCommit ?? 0)
    )
    .slice(0, 8)
    .map((repository) => ({
      repository: repository.name,
      score: repository.overallScore,
      reason: `Last commit was ${repository.git.daysSinceLastCommit ?? "an unknown number of"} days ago.`
    }));

  const report: DirectoryReport = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    scannedDirectory: directory,
    ...(loaded.path ? { configurationPath: loaded.path } : {}),
    metadata: {
      toolVersion,
      scanDurationMs: Date.now() - startedAt,
      scoringProfile: loaded.config.scoringProfile,
      comparisonMode: loaded.config.comparisonMode,
      ignoredDirectories: [
        ...ignoredTraversalDirectories,
        ...loaded.config.ignoreRepositories.map(
          (pattern) => `repository:${pattern}`
        )
      ].sort(),
      repositoryCount: repositories.length
    },
    summary: {
      repositoriesDiscovered: discovery.repositories.length,
      repositoriesAnalysed: repositories.length,
      averageScore,
      medianScore: median(scores),
      averageConfidence,
      attentionRequired: repositories.filter(
        (repository) =>
          repository.overallScore < 70 ||
          repository.nextActions.some(
            (action) => action.urgency === "critical"
          )
      ).length,
      strongestRepositories: ranked(
        repositories,
        (repository) =>
          `${repository.confidence.level} confidence; ${repository.checks.filter((check) => check.status === "passed").length} passed checks.`,
        "strongest"
      ),
      weakestRepositories: ranked(
        repositories,
        (repository) =>
          repository.nextActions[0]?.why ?? "Limited evidence of repository readiness.",
        "weakest"
      ),
      highestRiskRepositories: highestRisk(repositories),
      easiestImprovements,
      potentiallyAbandonedRepositories
    },
    peerGroups,
    repositories,
    topImprovements,
    codexPrompts: createCodexPrompts(topImprovements),
    warnings: scanWarnings
  };

  const outputDirectory = path.resolve(options.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const markdownPath = path.join(outputDirectory, "repo-doctor-report.md");
  const jsonPath = path.join(outputDirectory, "repo-doctor-report.json");
  await Promise.all([
    writeFile(markdownPath, renderMarkdown(report), "utf8"),
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  ]);
  return { report, markdownPath, jsonPath };
}

export { discoverRepositories } from "./discover.js";
export { renderMarkdown } from "./report.js";
export { scanRepository } from "./scanner.js";
export { scoreRepository } from "./scoring.js";
export type * from "./types.js";
