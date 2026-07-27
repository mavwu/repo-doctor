import type {
  ActivityStatus,
  ActionItem,
  CheckResult,
  CheckStatus,
  ConfidenceLevel,
  Finding,
  ProjectType,
  RepositoryConfidence,
  RepositoryIntent,
  Score,
  ScoreCategory,
  ScoringProfileName
} from "./types.js";
import { scoreCategories } from "./types.js";

interface ScoringContext {
  projectTypes: ProjectType[];
  sizeProfile: "tiny" | "small" | "substantial";
  scoringProfile: ScoringProfileName;
  intent: RepositoryIntent;
  productionFacing: boolean | null;
  trackedFileCount: number;
  sourceFileCount: number;
  hasManifest: boolean;
  usesEnvironment: boolean;
  hasScanErrors: boolean;
  activity: ActivityStatus;
}

interface CheckDefinition {
  id: string;
  category: ScoreCategory;
  title: string;
  basePoints: number;
  findingIds: string[];
  applicable: (context: ScoringContext) => boolean;
}

const always = (): boolean => true;
const hasSource = (context: ScoringContext): boolean => context.sourceFileCount > 0;
const isUserFacing = (context: ScoringContext): boolean =>
  context.projectTypes.some((type) =>
    ["nextjs", "react-vite", "flutter", "static-web"].includes(type)
  );
const isDeployable = (context: ScoringContext): boolean =>
  context.projectTypes.some((type) =>
    ["nextjs", "react-vite", "flutter", "laravel", "static-web"].includes(type)
  );

const checkDefinitions: CheckDefinition[] = [
  {
    id: "documentation.readme",
    category: "documentation",
    title: "Root README",
    basePoints: 30,
    findingIds: ["docs-readme-missing", "docs-readme-thin"],
    applicable: always
  },
  {
    id: "documentation.installation",
    category: "documentation",
    title: "Installation or setup guidance",
    basePoints: 22,
    findingIds: ["docs-install-missing", "docs-readme-missing"],
    applicable: always
  },
  {
    id: "documentation.usage",
    category: "documentation",
    title: "Usage guidance",
    basePoints: 22,
    findingIds: ["docs-usage-missing", "docs-readme-missing"],
    applicable: always
  },
  {
    id: "documentation.licence",
    category: "documentation",
    title: "Licence or ownership statement",
    basePoints: 12,
    findingIds: ["docs-license-missing"],
    applicable: (context) => context.intent.private !== true
  },
  {
    id: "security.gitignore",
    category: "security",
    title: "Ignore policy",
    basePoints: 15,
    findingIds: ["security-gitignore-missing"],
    applicable: always
  },
  {
    id: "security.sensitive-files",
    category: "security",
    title: "No tracked credential-shaped files",
    basePoints: 40,
    findingIds: [
      "security-sensitive-files",
      "security-sensitive-generated-files"
    ],
    applicable: always
  },
  {
    id: "security.secret-patterns",
    category: "security",
    title: "No hard-coded secret patterns",
    basePoints: 30,
    findingIds: ["security-secret-patterns"],
    applicable: always
  },
  {
    id: "security.environment-template",
    category: "security",
    title: "Safe environment template",
    basePoints: 15,
    findingIds: ["security-env-template-missing"],
    applicable: (context) => context.usesEnvironment
  },
  {
    id: "testing.automated-tests",
    category: "testing",
    title: "Automated tests",
    basePoints: 65,
    findingIds: ["testing-tests-missing"],
    applicable: hasSource
  },
  {
    id: "testing.ci",
    category: "testing",
    title: "Continuous integration",
    basePoints: 35,
    findingIds: ["testing-ci-missing"],
    applicable: (context) =>
      context.productionFacing === true ||
      context.scoringProfile === "library" ||
      context.sizeProfile === "substantial"
  },
  {
    id: "maintainability.manifest",
    category: "maintainability",
    title: "Valid project manifest",
    basePoints: 16,
    findingIds: [
      "maintainability-manifest-missing",
      "maintainability-package-json-malformed"
    ],
    applicable: (context) => context.sourceFileCount > 3 || context.hasManifest
  },
  {
    id: "maintainability.lockfile",
    category: "maintainability",
    title: "Deterministic dependency lock",
    basePoints: 12,
    findingIds: ["maintainability-lock-missing"],
    applicable: (context) => context.hasManifest
  },
  {
    id: "maintainability.lint",
    category: "maintainability",
    title: "Static analysis or linting",
    basePoints: 16,
    findingIds: ["maintainability-lint-missing"],
    applicable: (context) =>
      context.sourceFileCount > 3 &&
      !(
        context.projectTypes.includes("static-web") &&
        context.sizeProfile === "tiny"
      )
  },
  {
    id: "maintainability.build",
    category: "maintainability",
    title: "Reproducible build",
    basePoints: 10,
    findingIds: ["maintainability-build-missing"],
    applicable: (context) =>
      context.projectTypes.some((type) =>
        ["nextjs", "react-vite", "flutter", "laravel"].includes(type)
      ) ||
      (context.projectTypes.includes("node") &&
        context.productionFacing === true)
  },
  {
    id: "maintainability.source-structure",
    category: "maintainability",
    title: "Navigable source structure",
    basePoints: 12,
    findingIds: ["maintainability-flat-source"],
    applicable: (context) => context.sourceFileCount >= 12
  },
  {
    id: "maintainability.generated-files",
    category: "maintainability",
    title: "Generated files are controlled",
    basePoints: 12,
    findingIds: ["maintainability-generated-tracked"],
    applicable: always
  },
  {
    id: "maintainability.large-files",
    category: "maintainability",
    title: "Large tracked files are intentional",
    basePoints: 10,
    findingIds: ["maintainability-large-files"],
    applicable: always
  },
  {
    id: "maintainability.todo-debt",
    category: "maintainability",
    title: "TODO and FIXME debt is controlled",
    basePoints: 8,
    findingIds: ["maintainability-todos"],
    applicable: hasSource
  },
  {
    id: "maintainability.clean-worktree",
    category: "maintainability",
    title: "Working-tree observation",
    basePoints: 0,
    findingIds: ["maintainability-dirty-worktree"],
    applicable: always
  },
  {
    id: "deployment.configuration",
    category: "deployment",
    title: "Reproducible deployment path",
    basePoints: 100,
    findingIds: ["deployment-config-missing"],
    applicable: (context) =>
      context.scoringProfile !== "experimental" &&
      (context.productionFacing === true || isDeployable(context))
  },
  {
    id: "portfolio.description",
    category: "portfolio",
    title: "Clear project description",
    basePoints: 35,
    findingIds: ["portfolio-description-missing"],
    applicable: always
  },
  {
    id: "portfolio.visuals",
    category: "portfolio",
    title: "Screenshots or visual examples",
    basePoints: 22,
    findingIds: ["portfolio-visuals-missing"],
    applicable: (context) =>
      context.scoringProfile === "portfolio" && isUserFacing(context)
  },
  {
    id: "portfolio.demo",
    category: "portfolio",
    title: "Demo or project link",
    basePoints: 18,
    findingIds: ["portfolio-demo-missing"],
    applicable: (context) =>
      context.scoringProfile === "portfolio" && isUserFacing(context)
  },
  {
    id: "portfolio.placeholders",
    category: "portfolio",
    title: "No unfinished placeholder content",
    basePoints: 25,
    findingIds: ["portfolio-placeholders"],
    applicable: hasSource
  }
];

const profileWeights: Record<
  ScoringProfileName,
  Record<ScoreCategory, number>
> = {
  portfolio: {
    documentation: 1.4,
    security: 1.35,
    testing: 0.85,
    maintainability: 1,
    deployment: 0.75,
    portfolio: 1.25
  },
  production: {
    documentation: 1,
    security: 1.8,
    testing: 1.5,
    maintainability: 1.3,
    deployment: 1.5,
    portfolio: 0.25
  },
  experimental: {
    documentation: 0.75,
    security: 1.5,
    testing: 0.45,
    maintainability: 0.75,
    deployment: 0.15,
    portfolio: 0.4
  },
  library: {
    documentation: 1.45,
    security: 1.4,
    testing: 1.45,
    maintainability: 1.35,
    deployment: 0.15,
    portfolio: 0.45
  }
};

function findingStatus(
  finding: Finding,
  definition: CheckDefinition,
  context: ScoringContext
): CheckStatus {
  if (
    definition.id === "testing.automated-tests" &&
    finding.id === "testing-tests-missing" &&
    (context.scoringProfile === "experimental" ||
      (context.projectTypes.includes("static-web") &&
        context.sizeProfile === "tiny"))
  ) {
    return "warning";
  }
  return finding.status;
}

function confidenceForFindings(findings: Finding[]): ConfidenceLevel {
  if (findings.some((finding) => finding.confidence === "low")) return "low";
  if (findings.some((finding) => finding.confidence === "medium")) return "medium";
  return "high";
}

function statusEarnedFraction(status: CheckStatus): number {
  return {
    "not-applicable": 0,
    passed: 1,
    failed: 0,
    unknown: 0.25,
    warning: 0.5
  }[status];
}

function createCheck(
  definition: CheckDefinition,
  findings: Finding[],
  context: ScoringContext
): CheckResult {
  const omitted =
    context.intent.omittedChecks.includes(definition.id) ||
    context.intent.omittedChecks.includes(definition.category);
  if (omitted) {
    return {
      id: definition.id,
      category: definition.category,
      title: definition.title,
      status: "not-applicable",
      confidence: "high",
      explanation: "Intentionally omitted by repository-level configuration.",
      maxPoints: definition.basePoints,
      earnedPoints: 0,
      findingIds: []
    };
  }
  if (!definition.applicable(context)) {
    return {
      id: definition.id,
      category: definition.category,
      title: definition.title,
      status: "not-applicable",
      confidence: "high",
      explanation: "Not applicable to the detected technology, intent, or size.",
      maxPoints: definition.basePoints,
      earnedPoints: 0,
      findingIds: []
    };
  }
  if (context.hasScanErrors && context.trackedFileCount === 0) {
    return {
      id: definition.id,
      category: definition.category,
      title: definition.title,
      status: "unknown",
      confidence: "low",
      explanation: "The repository could not be inspected reliably.",
      maxPoints: definition.basePoints,
      earnedPoints: Math.round(definition.basePoints * 0.25),
      findingIds: []
    };
  }
  const relevant = findings.filter((finding) =>
    definition.findingIds.includes(finding.id)
  );
  if (!relevant.length) {
    return {
      id: definition.id,
      category: definition.category,
      title: definition.title,
      status: "passed",
      confidence: "high",
      explanation: "No contrary evidence was detected by this check.",
      maxPoints: definition.basePoints,
      earnedPoints: definition.basePoints,
      findingIds: []
    };
  }
  const statuses = relevant.map((finding) =>
    findingStatus(finding, definition, context)
  );
  const status: CheckStatus = statuses.includes("failed")
    ? "failed"
    : statuses.includes("unknown")
      ? "unknown"
      : "warning";
  return {
    id: definition.id,
    category: definition.category,
    title: definition.title,
    status,
    confidence: confidenceForFindings(relevant),
    explanation: relevant.map((finding) => finding.explanation).join(" "),
    maxPoints: definition.basePoints,
    earnedPoints: Math.round(
      definition.basePoints * statusEarnedFraction(status)
    ),
    findingIds: relevant.map((finding) => finding.id)
  };
}

function addCustomChecks(
  checks: CheckResult[],
  findings: Finding[],
  context: ScoringContext
): void {
  const mappedFindingIds = new Set(
    checkDefinitions.flatMap((definition) => definition.findingIds)
  );
  for (const finding of findings.filter(
    (candidate) => !mappedFindingIds.has(candidate.id) && candidate.deduction > 0
  )) {
    const maxPoints = Math.max(4, Math.min(20, finding.deduction));
    const omitted =
      context.intent.omittedChecks.includes(finding.id) ||
      context.intent.omittedChecks.includes(finding.category);
    const status: CheckStatus = omitted ? "not-applicable" : finding.status;
    checks.push({
      id: finding.id.startsWith("custom-")
        ? finding.id
        : `finding.${finding.id}`,
      category: finding.category,
      title: finding.title,
      status,
      confidence: finding.confidence,
      explanation: omitted
        ? "Intentionally omitted by repository-level configuration."
        : finding.explanation,
      maxPoints,
      earnedPoints: omitted
        ? 0
        : Math.round(maxPoints * statusEarnedFraction(status)),
      findingIds: [finding.id]
    });
  }
}

function statusCounts(checks: CheckResult[]): Record<CheckStatus, number> {
  return {
    "not-applicable": checks.filter(
      (check) => check.status === "not-applicable"
    ).length,
    passed: checks.filter((check) => check.status === "passed").length,
    failed: checks.filter((check) => check.status === "failed").length,
    unknown: checks.filter((check) => check.status === "unknown").length,
    warning: checks.filter((check) => check.status === "warning").length
  };
}

function repositoryConfidence(
  context: ScoringContext,
  checks: CheckResult[]
): RepositoryConfidence {
  let value = 0.95;
  const reasons: string[] = [];
  if (context.projectTypes.includes("unknown")) {
    value -= 0.18;
    reasons.push("Project technology could not be identified confidently.");
  }
  if (context.trackedFileCount === 0) {
    value -= 0.25;
    reasons.push("No tracked files were available as evidence.");
  }
  if (context.sizeProfile === "tiny") {
    value -= 0.08;
    reasons.push("The repository provides a small evidence set.");
  }
  if (context.hasScanErrors) {
    value -= 0.3;
    reasons.push("One or more scan operations were incomplete.");
  }
  const unknownChecks = checks.filter((check) => check.status === "unknown").length;
  if (unknownChecks) {
    value -= Math.min(0.25, unknownChecks * 0.04);
    reasons.push(`${unknownChecks} applicable check(s) are unknown.`);
  }
  const omittedChecks = checks.filter(
    (check) =>
      check.status === "not-applicable" &&
      context.intent.omittedChecks.includes(check.id)
  ).length;
  if (omittedChecks) {
    value -= Math.min(0.15, omittedChecks * 0.03);
    reasons.push(`${omittedChecks} check(s) were intentionally omitted.`);
  }
  if (context.intent.customExclusions.length) {
    value -= Math.min(0.15, context.intent.customExclusions.length * 0.03);
    reasons.push(
      `${context.intent.customExclusions.length} custom path exclusion(s) reduced evidence coverage.`
    );
  }
  if (context.intent.intendedProjectType) {
    value += 0.04;
    reasons.push("Repository intent explicitly declares the project type.");
  }
  value = Math.max(0.2, Math.min(1, value));
  return {
    value: Number(value.toFixed(2)),
    level: value >= 0.8 ? "high" : value >= 0.55 ? "medium" : "low",
    reasons: reasons.length ? reasons : ["Evidence coverage is broad and consistent."]
  };
}

function scoreCaps(
  findings: Finding[],
  context: ScoringContext
): Array<{ value: number; reason: string; findingId: string }> {
  const caps: Array<{ value: number; reason: string; findingId: string }> = [];
  if (
    findings.some(
      (finding) =>
        finding.id === "security-sensitive-files" &&
        finding.status === "failed" &&
        finding.confidence === "high"
    )
  ) {
    caps.push({
      value: 45,
      reason: "Confirmed tracked credential-shaped files prevent a healthy score.",
      findingId: "security-sensitive-files"
    });
  }
  const seriousSecurity = findings.find(
    (finding) =>
      finding.category === "security" &&
      finding.status === "failed" &&
      finding.confidence === "high" &&
      finding.deduction >= 25
  );
  if (seriousSecurity && seriousSecurity.id !== "security-sensitive-files") {
    caps.push({
      value: 60,
      reason: "A confirmed high-impact security failure limits readiness.",
      findingId: seriousSecurity.id
    });
  }
  if (context.trackedFileCount === 0) {
    caps.push({
      value: 30,
      reason: "An empty repository cannot demonstrate health or readiness.",
      findingId: "repository-empty"
    });
  }
  if (
    context.productionFacing === true &&
    findings.some((finding) => finding.id === "testing-tests-missing")
  ) {
    caps.push({
      value: 70,
      reason: "A production-facing repository without tests has limited readiness.",
      findingId: "testing-tests-missing"
    });
  }
  if (
    findings.some((finding) => finding.id === "docs-readme-missing") &&
    !context.intent.omittedChecks.includes("documentation") &&
    !context.intent.omittedChecks.includes("documentation.readme")
  ) {
    const value =
      context.scoringProfile === "production"
        ? 85
        : context.scoringProfile === "experimental"
          ? 90
          : context.scoringProfile === "library"
            ? 75
            : 78;
    caps.push({
      value,
      reason: "A repository without a README cannot demonstrate strong documentation readiness.",
      findingId: "docs-readme-missing"
    });
  }
  return caps.sort((a, b) => a.value - b.value);
}

export function scoreRepository(
  findings: Finding[],
  context: ScoringContext
): {
  checks: CheckResult[];
  scores: Record<ScoreCategory, Score>;
  scoreBeforeCaps: number;
  caps: Array<{ value: number; reason: string; findingId: string }>;
  overallScore: number;
  confidence: RepositoryConfidence;
} {
  const checks = checkDefinitions.map((definition) =>
    createCheck(definition, findings, context)
  );
  addCustomChecks(checks, findings, context);
  checks.sort(
    (a, b) =>
      scoreCategories.indexOf(a.category) - scoreCategories.indexOf(b.category) ||
      a.id.localeCompare(b.id)
  );

  const weights = profileWeights[context.scoringProfile];
  const scores = Object.fromEntries(
    scoreCategories.map((category) => {
      const categoryChecks = checks.filter(
        (check) =>
          check.category === category && check.status !== "not-applicable"
      );
      const possiblePoints = categoryChecks.reduce(
        (sum, check) => sum + check.maxPoints,
        0
      );
      const earnedPoints = categoryChecks.reduce(
        (sum, check) => sum + check.earnedPoints,
        0
      );
      const value =
        possiblePoints > 0
          ? Math.round((earnedPoints / possiblePoints) * 100)
          : 0;
      return [
        category,
        {
          value,
          applicableWeight: possiblePoints > 0 ? weights[category] : 0,
          deductions: Math.max(0, 100 - value),
          possiblePoints,
          earnedPoints,
          statusCounts: statusCounts(
            checks.filter((check) => check.category === category)
          ),
          explanations: checks
            .filter((check) => check.category === category)
            .map((check) => ({
              checkId: check.id,
              title: check.title,
              status: check.status,
              confidence: check.confidence,
              possiblePoints: check.maxPoints,
              earnedPoints: check.earnedPoints,
              pointChange:
                check.status === "not-applicable"
                  ? 0
                  : check.earnedPoints - check.maxPoints,
              explanation: check.explanation
            }))
        }
      ];
    })
  ) as Record<ScoreCategory, Score>;

  const applicableCategories = scoreCategories.filter(
    (category) => scores[category].applicableWeight > 0
  );
  const totalWeight = applicableCategories.reduce(
    (sum, category) => sum + scores[category].applicableWeight,
    0
  );
  const scoreBeforeCaps =
    totalWeight > 0
      ? Math.round(
          applicableCategories.reduce(
            (sum, category) =>
              sum +
              scores[category].value * scores[category].applicableWeight,
            0
          ) / totalWeight
        )
      : 0;
  const caps = scoreCaps(findings, context);
  const overallScore = caps.length
    ? Math.min(scoreBeforeCaps, caps[0]?.value ?? scoreBeforeCaps)
    : scoreBeforeCaps;
  return {
    checks,
    scores,
    scoreBeforeCaps,
    caps,
    overallScore,
    confidence: repositoryConfidence(context, checks)
  };
}

export function prioritiseActions(
  findings: Finding[],
  repository: string,
  activity: ActivityStatus,
  productionFacing: boolean | null
): ActionItem[] {
  const impactValue = { high: 16, medium: 9, low: 4 };
  const effortCost = { small: 0, medium: 5, large: 10 };
  const severityValue = { confirmed: 16, possible: 8, info: 1 };
  return findings
    .filter((finding) => finding.action && finding.deduction > 0)
    .map((finding) => {
      const productionBoost = productionFacing === true ? 10 : 0;
      const activityAdjustment =
        activity === "active"
          ? 4
          : activity === "possibly-abandoned"
            ? -5
            : 0;
      const value = Math.max(
        1,
        finding.deduction +
          impactValue[finding.likelyImpact] +
          severityValue[finding.severity] +
          productionBoost +
          activityAdjustment -
          effortCost[finding.effort]
      );
      const urgency =
        finding.category === "security" &&
        finding.status === "failed" &&
        finding.confidence === "high" &&
        finding.likelyImpact === "high"
          ? "critical"
          : value >= 48
            ? "high"
            : value >= 28
              ? "medium"
              : "low";
      return {
        title: finding.action as string,
        why: finding.explanation,
        urgency,
        effort: finding.effort,
        likelyImpact: finding.likelyImpact,
        value,
        repository,
        findingId: finding.id,
        rationale: `${finding.severity} finding; ${finding.likelyImpact} likely impact; ${finding.effort} effort; activity=${activity}; production-facing=${productionFacing ?? "unknown"}.`
      } satisfies ActionItem;
    })
    .sort(
      (a, b) =>
        b.value - a.value ||
        a.effort.localeCompare(b.effort) ||
        a.title.localeCompare(b.title)
    )
    .slice(0, 6);
}
