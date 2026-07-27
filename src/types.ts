export const scoreCategories = [
  "documentation",
  "security",
  "testing",
  "maintainability",
  "deployment",
  "portfolio"
] as const;

export const scoringProfiles = [
  "portfolio",
  "production",
  "experimental",
  "library"
] as const;

export type ScoreCategory = (typeof scoreCategories)[number];
export type ScoringProfileName = (typeof scoringProfiles)[number];
export type Severity = "confirmed" | "possible" | "info";
export type ConfidenceLevel = "high" | "medium" | "low";
export type CheckStatus =
  | "not-applicable"
  | "passed"
  | "failed"
  | "unknown"
  | "warning";
export type ProductionStatus = "production" | "non-production" | "unknown";
export type ActivityStatus = "active" | "stale" | "possibly-abandoned" | "unknown";
export type ProjectType =
  | "node"
  | "nextjs"
  | "react-vite"
  | "flutter"
  | "laravel"
  | "python"
  | "static-web"
  | "unknown";

export interface Finding {
  id: string;
  category: ScoreCategory;
  severity: Severity;
  confidence: ConfidenceLevel;
  status: "failed" | "warning" | "unknown";
  title: string;
  explanation: string;
  evidence: string[];
  deduction: number;
  effort: "small" | "medium" | "large";
  likelyImpact: "high" | "medium" | "low";
  action?: string;
}

export interface CheckResult {
  id: string;
  category: ScoreCategory;
  title: string;
  status: CheckStatus;
  confidence: ConfidenceLevel;
  explanation: string;
  maxPoints: number;
  earnedPoints: number;
  findingIds: string[];
}

export interface ScoreExplanation {
  checkId: string;
  title: string;
  status: CheckStatus;
  confidence: ConfidenceLevel;
  possiblePoints: number;
  earnedPoints: number;
  pointChange: number;
  explanation: string;
}

export interface Score {
  value: number;
  applicableWeight: number;
  deductions: number;
  possiblePoints: number;
  earnedPoints: number;
  statusCounts: Record<CheckStatus, number>;
  explanations: ScoreExplanation[];
}

export interface RepositoryConfidence {
  level: ConfidenceLevel;
  value: number;
  reasons: string[];
}

export interface RepositoryIntent {
  intendedProjectType?: ProjectType;
  productionStatus: ProductionStatus;
  private: boolean | null;
  scoringProfile: ScoringProfileName;
  omittedChecks: string[];
  customExclusions: string[];
  configurationPath?: string;
}

export interface RepositoryReport {
  name: string;
  path: string;
  relativePath: string;
  projectTypes: ProjectType[];
  profile: "tiny" | "small" | "substantial";
  scoringProfile: ScoringProfileName;
  intent: RepositoryIntent;
  productionFacing: boolean | null;
  description?: string;
  trackedFileCount: number;
  sourceFileCount: number;
  trackedBytes: number;
  git: {
    branch?: string;
    clean: boolean | null;
    statusNote?: string;
    lastCommitAt?: string;
    activity: ActivityStatus;
    daysSinceLastCommit?: number;
  };
  signals: {
    readme?: string;
    licence?: string;
    gitignore: boolean;
    usesEnvironment: boolean;
    environmentTemplates: string[];
    manifests: string[];
    packageScripts: string[];
    ciWorkflows: string[];
    lockFiles: string[];
    deploymentFiles: string[];
    visualAssets: string[];
    sourceDirectories: string[];
  };
  checks: CheckResult[];
  findings: Finding[];
  scores: Record<ScoreCategory, Score>;
  scoreBeforeCaps: number;
  scoreCaps: Array<{ value: number; reason: string; findingId: string }>;
  overallScore: number;
  confidence: RepositoryConfidence;
  comparison?: {
    group: string;
    rank: number;
    outOf: number;
    percentile: number;
  };
  nextActions: ActionItem[];
  errors: string[];
}

export interface ActionItem {
  title: string;
  why: string;
  urgency: "critical" | "high" | "medium" | "low";
  effort: "small" | "medium" | "large";
  likelyImpact: "high" | "medium" | "low";
  value: number;
  repository: string;
  findingId: string;
  rationale: string;
}

export interface RankedRepository {
  repository: string;
  score: number;
  reason: string;
}

export interface DirectoryReport {
  schemaVersion: "1.0";
  generatedAt: string;
  scannedDirectory: string;
  configurationPath?: string;
  metadata: {
    toolVersion: string;
    scanDurationMs: number;
    scoringProfile: ScoringProfileName;
    comparisonMode: "peer" | "none";
    ignoredDirectories: string[];
    repositoryCount: number;
  };
  summary: {
    repositoriesDiscovered: number;
    repositoriesAnalysed: number;
    averageScore: number;
    medianScore: number;
    averageConfidence: number;
    attentionRequired: number;
    strongestRepositories: RankedRepository[];
    weakestRepositories: RankedRepository[];
    highestRiskRepositories: RankedRepository[];
    easiestImprovements: ActionItem[];
    potentiallyAbandonedRepositories: RankedRepository[];
  };
  peerGroups: Array<{
    group: string;
    repositories: string[];
    averageScore: number;
  }>;
  repositories: RepositoryReport[];
  topImprovements: ActionItem[];
  codexPrompts: CodexPrompt[];
  warnings: string[];
}

export interface CodexPrompt {
  repository: string;
  title: string;
  prompt: string;
}

export interface CustomRule {
  id: string;
  description: string;
  kind: "require-file" | "forbid-file";
  pattern: string;
  category: ScoreCategory;
  deduction: number;
  severity?: Severity;
  projectTypes?: ProjectType[];
}

export interface RepositoryConfig {
  intendedProjectType?: ProjectType;
  productionStatus?: ProductionStatus;
  private?: boolean;
  scoringProfile?: ScoringProfileName;
  intentionallyOmittedChecks?: string[];
  customExclusions?: string[];
}

export interface RepoDoctorConfig {
  ignoreRepositories: string[];
  maxDepth: number;
  largeFileBytes: number;
  customRules: CustomRule[];
  scoringProfile: ScoringProfileName;
  comparisonMode: "peer" | "none";
}

export interface CliOptions {
  directory: string;
  outputDirectory: string;
  configPath?: string;
  maxDepth?: number;
  largeFileBytes?: number;
  scoringProfile?: ScoringProfileName;
  comparisonMode?: "peer" | "none";
  quiet: boolean;
}
