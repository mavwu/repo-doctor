import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.js";
import { runRepoDoctor, scanRepository, scoreRepository } from "../src/index.js";
import type { RepositoryReport } from "../src/types.js";
import { scoringFixtures, type ScoringFixture } from "./scoring-fixtures.js";

const execFileAsync = promisify(execFile);

async function createFixtureRepository(
  root: string,
  fixture: ScoringFixture
): Promise<string> {
  const repository = path.join(root, fixture.name);
  await mkdir(repository, { recursive: true });
  await execFileAsync("git", ["init", "-q", repository], { windowsHide: true });
  for (const [relative, content] of Object.entries(fixture.files)) {
    const absolute = path.join(repository, ...relative.split("/"));
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  }
  await execFileAsync("git", ["-C", repository, "add", "."], {
    windowsHide: true
  });
  if (fixture.commitDate && Object.keys(fixture.files).length > 0) {
    await execFileAsync(
      "git",
      [
        "-C",
        repository,
        "-c",
        "user.name=repo-doctor fixtures",
        "-c",
        "user.email=fixtures@example.invalid",
        "commit",
        "-qm",
        "Create deterministic fixture"
      ],
      {
        windowsHide: true,
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: fixture.commitDate,
          GIT_COMMITTER_DATE: fixture.commitDate
        }
      }
    );
  }
  return repository;
}

async function scanFixtures(root: string): Promise<Map<string, RepositoryReport>> {
  const reports = new Map<string, RepositoryReport>();
  const repositories = await Promise.all(
    scoringFixtures.map(async (fixture) => ({
      fixture,
      repository: await createFixtureRepository(root, fixture)
    }))
  );
  const scanned = await Promise.all(
    repositories.map(async ({ fixture, repository }) => ({
      name: fixture.name,
      report: await scanRepository(
        repository,
        root,
        structuredClone(defaultConfig)
      )
    }))
  );
  for (const { name, report } of scanned) reports.set(name, report);
  return reports;
}

let fixtureRoot: string;
let fixtureReports: Map<string, RepositoryReport>;

beforeAll(async () => {
  fixtureRoot = await mkdtemp(path.join(tmpdir(), "repo-doctor-scoring-"));
  fixtureReports = await scanFixtures(fixtureRoot);
}, 90_000);

afterAll(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe("scoring quality edge cases", () => {
  it("does not reward empty or low-evidence repositories", () => {
    const empty = fixtureReports.get("empty-repository");
    const experiment = fixtureReports.get("experimental-repository");
    expect(empty?.overallScore).toBeLessThanOrEqual(30);
    expect(empty?.confidence.level).toBe("low");
    expect(experiment?.overallScore).toBeLessThan(70);
    expect(experiment?.git.activity).toBe("possibly-abandoned");
  });

  it("makes production testing and serious security materially affect scores", () => {
    const production = fixtureReports.get("production-node-api-no-tests");
    const unsafe = fixtureReports.get("committed-environment-file");
    const documentedUnsafe = fixtureReports.get("strong-docs-weak-security");
    expect(production?.productionFacing).toBe(true);
    expect(production?.overallScore).toBeLessThanOrEqual(70);
    expect(production?.scores.testing.value).toBeLessThanOrEqual(20);
    expect(unsafe?.overallScore).toBeLessThanOrEqual(45);
    expect(unsafe?.scoreCaps[0]?.findingId).toBe("security-sensitive-files");
    expect(documentedUnsafe?.scores.documentation.value).toBeGreaterThanOrEqual(90);
    expect(documentedUnsafe?.overallScore).toBeLessThanOrEqual(45);
  });

  it("rewards demonstrated quality without treating every check as universal", () => {
    const staticSite = fixtureReports.get("static-landing-page");
    const polished = fixtureReports.get("polished-portfolio-project");
    const testedUndocumented = fixtureReports.get("tests-without-readme");
    expect(staticSite?.checks.find((check) => check.id === "testing.ci")?.status).toBe(
      "warning"
    );
    expect(
      staticSite?.checks.find((check) => check.id === "testing.automated-tests")
        ?.status
    ).toBe("warning");
    expect(polished?.overallScore).toBeGreaterThanOrEqual(90);
    expect(testedUndocumented?.scores.testing.value).toBe(100);
    expect(testedUndocumented?.scores.documentation.value).toBeLessThan(60);
    expect(testedUndocumented?.overallScore).toBeLessThanOrEqual(75);
  });

  it("uses every explicit check state and emits deterministic score snapshots", () => {
    const statuses = new Set(
      [...fixtureReports.values()].flatMap((repository) =>
        repository.checks.map((check) => check.status)
      )
    );
    expect(statuses).toEqual(
      new Set(["not-applicable", "passed", "failed", "warning"])
    );
    const incompleteScan = scoreRepository([], {
      projectTypes: ["unknown"],
      sizeProfile: "tiny",
      scoringProfile: "portfolio",
      intent: {
        productionStatus: "unknown",
        private: null,
        scoringProfile: "portfolio",
        omittedChecks: [],
        customExclusions: []
      },
      productionFacing: null,
      trackedFileCount: 0,
      sourceFileCount: 0,
      hasManifest: false,
      usesEnvironment: false,
      hasScanErrors: true,
      activity: "unknown"
    });
    expect(incompleteScan.checks.some((check) => check.status === "unknown")).toBe(
      true
    );
    const projection = [...fixtureReports.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((repository) => ({
        name: repository.name,
        profile: repository.scoringProfile,
        overall: repository.overallScore,
        beforeCaps: repository.scoreBeforeCaps,
        caps: repository.scoreCaps,
        confidence: repository.confidence,
        activity: repository.git.activity,
        categoryScores: Object.fromEntries(
          Object.entries(repository.scores).map(([category, score]) => [
            category,
            {
              value: score.value,
              earned: score.earnedPoints,
              possible: score.possiblePoints,
              states: score.statusCounts
            }
          ])
        ),
        checks: repository.checks.map((check) => ({
          id: check.id,
          status: check.status,
          confidence: check.confidence,
          points:
            check.status === "not-applicable"
              ? "N/A"
              : `${check.earnedPoints}/${check.maxPoints}`
        }))
      }));
    expect(projection).toMatchSnapshot();
  });
});

describe("report snapshots and comparison mode", () => {
  it("keeps Markdown and structured JSON summaries stable", async () => {
    const output = path.join(fixtureRoot, "report-output");
    const result = await runRepoDoctor({
      directory: fixtureRoot,
      outputDirectory: output,
      quiet: true
    });
    const markdown = await readFile(result.markdownPath, "utf8");
    const stableSummary = markdown
      .slice(0, markdown.indexOf("## Highest-value improvements"))
      .replace(/^Generated: .*$/m, "Generated: <timestamp>")
      .replace(/^Scanned directory: .*$/m, "Scanned directory: <fixture-root>")
      .replace(/^- Scan time: .*$/m, "- Scan time: <duration>")
      .replace(/Last commit was \d+ days ago\./g, "Last commit was <age> days ago.");
    expect(stableSummary).toMatchSnapshot();
    expect({
      schemaVersion: result.report.schemaVersion,
      metadata: {
        toolVersion: result.report.metadata.toolVersion,
        scoringProfile: result.report.metadata.scoringProfile,
        comparisonMode: result.report.metadata.comparisonMode,
        repositoryCount: result.report.metadata.repositoryCount
      },
      summary: {
        averageScore: result.report.summary.averageScore,
        medianScore: result.report.summary.medianScore,
        averageConfidence: result.report.summary.averageConfidence,
        attentionRequired: result.report.summary.attentionRequired,
        strongest: result.report.summary.strongestRepositories.map(
          (item) => item.repository
        ),
        weakest: result.report.summary.weakestRepositories.map(
          (item) => item.repository
        ),
        highestRisk: result.report.summary.highestRiskRepositories.map(
          (item) => item.repository
        ),
        abandoned: result.report.summary.potentiallyAbandonedRepositories.map(
          (item) => item.repository
        )
      },
      peers: result.report.peerGroups,
      repositories: result.report.repositories.map((repository) => ({
        name: repository.name,
        score: repository.overallScore,
        confidence: repository.confidence.level,
        peer: repository.comparison
      }))
    }).toMatchSnapshot();
  });
});
