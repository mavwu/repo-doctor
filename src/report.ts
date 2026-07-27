import type {
  ActionItem,
  CheckStatus,
  CodexPrompt,
  DirectoryReport,
  RankedRepository,
  RepositoryReport,
  ScoreCategory
} from "./types.js";

const categoryLabels: Record<ScoreCategory, string> = {
  documentation: "Documentation",
  security: "Security hygiene",
  testing: "Testing",
  maintainability: "Maintainability",
  deployment: "Deployment readiness",
  portfolio: "Portfolio readiness"
};

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}

function statusSummary(counts: Record<CheckStatus, number>): string {
  return [
    `${counts.passed} passed`,
    `${counts.failed} failed`,
    `${counts.warning} warning`,
    `${counts.unknown} unknown`,
    `${counts["not-applicable"]} N/A`
  ].join(", ");
}

function rankedList(items: RankedRepository[]): string {
  return items.length
    ? items
        .map(
          (item, index) =>
            `${index + 1}. **${item.repository}** (${item.score}/100) - ${item.reason}`
        )
        .join("\n")
    : "None identified.";
}

function actionList(actions: ActionItem[]): string {
  return actions.length
    ? actions
        .map(
          (action, index) =>
            `${index + 1}. **[${action.urgency.toUpperCase()}] ${action.title}**\n   - Effort: ${action.effort}; likely impact: ${action.likelyImpact}; priority: ${action.value}\n   - ${action.why}`
        )
        .join("\n")
    : "No immediate action generated.";
}

function repositoryMarkdown(repository: RepositoryReport): string {
  const scoreRows = Object.entries(repository.scores)
    .map(
      ([category, score]) =>
        `| ${categoryLabels[category as ScoreCategory]} | ${score.value}/100 | ${score.earnedPoints}/${score.possiblePoints} | ${score.applicableWeight.toFixed(2)} | ${statusSummary(score.statusCounts)} |`
    )
    .join("\n");
  const checkRows = repository.checks
    .map(
      (check) =>
        `| \`${check.id}\` | ${check.status} | ${check.confidence} | ${check.status === "not-applicable" ? "N/A" : `${check.earnedPoints}/${check.maxPoints}`} | ${escapeCell(check.explanation)} |`
    )
    .join("\n");
  const findings =
    repository.findings.length === 0
      ? "No material findings were identified."
      : repository.findings
          .map((finding) => {
            const evidence = finding.evidence.length
              ? `\n  - Evidence: ${finding.evidence.map((item) => `\`${item}\``).join(", ")}`
              : "";
            const action = finding.action
              ? `\n  - Suggested action: ${finding.action}`
              : "";
            return `- **${finding.status.toUpperCase()} - ${finding.title}** (${finding.category}; ${finding.confidence} confidence; legacy severity=${finding.severity}; nominal deduction=${finding.deduction})\n  - ${finding.explanation}${evidence}${action}`;
          })
          .join("\n");
  const caps =
    repository.scoreCaps.length > 0
      ? repository.scoreCaps
          .map(
            (cap) =>
              `- Overall score capped at ${cap.value}: ${cap.reason} (\`${cap.findingId}\`)`
          )
          .join("\n")
      : "No score caps applied.";
  const errors =
    repository.errors.length > 0
      ? `\n\n### Scan limitations\n\n${repository.errors.map((error) => `- ${error}`).join("\n")}`
      : "";
  const peer = repository.comparison
    ? `${repository.comparison.rank}/${repository.comparison.outOf} in ${repository.comparison.group} (${repository.comparison.percentile}% percentile)`
    : "Comparison disabled";
  return `## ${repository.name} - ${repository.overallScore}/100

${repository.description ?? "_No reliable project description detected._"}

- Path: \`${repository.path}\`
- Detected/intended type: ${repository.projectTypes.join(", ")}
- Size: ${repository.profile}; scoring profile: ${repository.scoringProfile}
- Production-facing: ${repository.productionFacing ?? "unknown"}
- Repository intent: production=${repository.intent.productionStatus}; private=${repository.intent.private ?? "unknown"}
- Confidence: ${repository.confidence.level} (${repository.confidence.value})
- Activity: ${repository.git.activity}${repository.git.daysSinceLastCommit !== undefined ? `; ${repository.git.daysSinceLastCommit} days since last commit` : ""}
- Peer comparison: ${peer}
- Tracked files: ${repository.trackedFileCount} (${repository.sourceFileCount} source files, ${(repository.trackedBytes / 1024 / 1024).toFixed(2)} MiB)
- Git state: ${repository.git.clean === null ? "unknown" : repository.git.clean ? "clean" : `not clean (${repository.git.statusNote ?? "details unavailable"})`}

### Scores

| Area | Score | Earned points | Weight | Check states |
|---|---:|---:|---:|---|
${scoreRows}

Score before caps: ${repository.scoreBeforeCaps}/100.

${caps}

### Check-by-check explanation

| Check | State | Confidence | Points | Explanation |
|---|---|---|---:|---|
${checkRows}

### Findings

${findings}

### Prioritised actions

${actionList(repository.nextActions)}${errors}`;
}

export function createCodexPrompts(actions: ActionItem[]): CodexPrompt[] {
  const seen = new Set<string>();
  const prompts: CodexPrompt[] = [];
  for (const action of actions) {
    const key = `${action.repository}:${action.findingId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    prompts.push({
      repository: action.repository,
      title: action.title,
      prompt: `Work only in the "${action.repository}" repository. First inspect its local instructions and current Git status. Address this repo-doctor finding: "${action.title}". Reason: ${action.why} Expected effort: ${action.effort}; likely impact: ${action.likelyImpact}. Preserve unrelated user changes, do not expose secret values, and do not run untrusted project scripts without inspecting them. Implement the smallest maintainable fix, add or update focused tests or documentation where appropriate, run the relevant verification commands, and summarize changed files plus remaining risk. Do not commit or push unless I explicitly ask.`
    });
    if (prompts.length >= 8) break;
  }
  return prompts;
}

export function renderMarkdown(report: DirectoryReport): string {
  const summaryRows = report.repositories
    .slice()
    .sort((a, b) => a.overallScore - b.overallScore || a.name.localeCompare(b.name))
    .map(
      (repository) =>
        `| ${escapeCell(repository.name)} | ${repository.overallScore} | ${repository.confidence.level} (${repository.confidence.value}) | ${repository.projectTypes.join(", ")} | ${repository.scoringProfile} | ${repository.git.activity} | ${repository.comparison ? `${repository.comparison.rank}/${repository.comparison.outOf}` : "-"} |`
    )
    .join("\n");
  const warnings =
    report.warnings.length > 0
      ? `\n## Scan warnings\n\n${report.warnings.map((warning) => `- ${warning}`).join("\n")}\n`
      : "";
  const peerGroups =
    report.peerGroups.length > 0
      ? report.peerGroups
          .map(
            (group) =>
              `- **${group.group}**: ${group.repositories.length} repositories, average ${group.averageScore}/100 - ${group.repositories.join(", ")}`
          )
          .join("\n")
      : "Peer comparison disabled.";
  const prompts =
    report.codexPrompts.length === 0
      ? "No prompts generated."
      : report.codexPrompts
          .map(
            (prompt) =>
              `### ${prompt.repository}: ${prompt.title}\n\n\`\`\`text\n${prompt.prompt}\n\`\`\``
          )
          .join("\n\n");

  return `# repo-doctor health report

Generated: ${report.generatedAt}

Scanned directory: \`${report.scannedDirectory}\`

This is a heuristic, read-only review. Check states distinguish **passed**, **failed**, **warning**, **unknown**, and **not applicable**. Scores measure demonstrated evidence; they are not proof of correctness or security.

## Report metadata

- Tool version: ${report.metadata.toolVersion}
- Scan time: ${report.metadata.scanDurationMs} ms
- Scoring profile: ${report.metadata.scoringProfile}
- Comparison mode: ${report.metadata.comparisonMode}
- Repository count: ${report.metadata.repositoryCount}
- Ignored directories/patterns: ${report.metadata.ignoredDirectories.join(", ") || "none"}

## Directory summary

- Repositories discovered: ${report.summary.repositoriesDiscovered}
- Repositories analysed: ${report.summary.repositoriesAnalysed}
- Average score: ${report.summary.averageScore}/100
- Median score: ${report.summary.medianScore}/100
- Average confidence: ${report.summary.averageConfidence}
- Repositories requiring attention (below 70 or critical action): ${report.summary.attentionRequired}

### Strongest repositories

${rankedList(report.summary.strongestRepositories)}

### Weakest repositories

${rankedList(report.summary.weakestRepositories)}

### Highest-risk repositories

${rankedList(report.summary.highestRiskRepositories)}

### Easiest improvements

${actionList(report.summary.easiestImprovements)}

### Potentially abandoned repositories

${rankedList(report.summary.potentiallyAbandonedRepositories)}

## Repository overview

| Repository | Overall | Confidence | Type | Scoring profile | Activity | Peer rank |
|---|---:|---|---|---|---|---:|
${summaryRows || "| _None_ | - | - | - | - | - | - |"}

## Peer groups

${peerGroups}

## Highest-value improvements

${actionList(report.topImprovements)}
${warnings}
${report.repositories.map(repositoryMarkdown).join("\n\n---\n\n")}

## Reusable Codex prompts

These prompts are scoped to one repository and do not authorize commits or pushes.

${prompts}
`;
}

export function terminalSummary(
  report: DirectoryReport,
  markdownPath: string,
  jsonPath: string
): string {
  const ranked = report.repositories
    .slice()
    .sort((a, b) => a.overallScore - b.overallScore)
    .slice(0, 8)
    .map((repository) => {
      const top = repository.nextActions[0];
      return `  ${String(repository.overallScore).padStart(3)}  ${repository.name} [${repository.confidence.level}]${top ? ` - ${top.title}` : ""}`;
    })
    .join("\n");
  return [
    `repo-doctor analysed ${report.summary.repositoriesAnalysed} of ${report.summary.repositoriesDiscovered} repositories using the ${report.metadata.scoringProfile} profile.`,
    `Average ${report.summary.averageScore}/100; median ${report.summary.medianScore}/100; confidence ${report.summary.averageConfidence}; ${report.summary.attentionRequired} require attention.`,
    ranked ? `Lowest scores:\n${ranked}` : "No repositories were discovered.",
    `Markdown: ${markdownPath}`,
    `JSON:     ${jsonPath}`
  ].join("\n");
}
