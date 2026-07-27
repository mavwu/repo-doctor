# repo-doctor

`repo-doctor` is a lightweight, read-only CLI that scans a directory of local
Git repositories and produces evidence-based health reports. It is intended for
personal project folders, portfolio audits, and maintenance triage—not as a
compliance scanner or hosted service.

It generates:

- a readable Markdown report;
- structured JSON for follow-up tooling;
- a concise terminal summary;
- repository-scoped Codex prompts for the highest-value improvements.

## Safety model

`repo-doctor` reads local files and uses read-only Git commands such as
`git ls-files`, `git status`, and `git log`. It does not:

- edit scanned repositories;
- run package, build, test, or deployment scripts from them;
- contact a cloud service;
- print values that match credential patterns.

Secret detection is deliberately conservative. Reports show only a file, line
number, credential type, and `value redacted`. A content match remains a
possible concern unless stronger repository evidence confirms the hygiene
problem, such as a tracked `.env` or private-key-shaped file. A score is not
proof that a repository is secure or correct.

## Requirements

- Node.js 20 or newer
- Git available on `PATH`

## Install and run

```sh
npm install
npm run build
npm run dev -- /path/to/projects
```

Or run the compiled CLI:

```sh
node dist/cli.js /path/to/projects
```

To expose `repo-doctor` as a local command while developing:

```sh
npm link
repo-doctor /path/to/projects
```

## CLI

```text
repo-doctor <directory> [options]

Options:
  -o, --output <directory>   Report output directory
  -c, --config <file>        JSON configuration file
      --max-depth <number>   Maximum repository discovery depth
      --large-file-kb <n>    Large tracked-file threshold in KiB
      --profile <name>       portfolio, production, experimental, or library
      --comparison <mode>    peer or none
      --compare              Alias for --comparison peer
  -q, --quiet                Suppress the terminal summary
  -h, --help                 Show help
  -v, --version              Show the version
```

Examples:

```sh
repo-doctor ~/Documents/GitHub --output ./reports/github-health
repo-doctor ~/Documents/GitHub --profile production --comparison peer
```

The output directory receives `repo-doctor-report.md` and
`repo-doctor-report.json`. Existing report files with those names are replaced;
scanned repositories are never changed.

## How scoring works

Every applicable check has an explicit state:

- `passed`: direct evidence satisfied the check and earns full points;
- `warning`: partial evidence or a context-dependent concern and earns half;
- `failed`: sufficiently strong evidence of a problem and earns no points;
- `unknown`: inspection was incomplete and earns limited provisional credit;
- `not-applicable`: excluded from both earned and possible points.

Category scores are calculated from earned versus possible points, then
combined using profile-specific category weights. The JSON and Markdown reports
show the points, state, confidence, explanation, finding IDs, weights, and any
overall score caps. This avoids silently treating absent or inapplicable checks
as passes.

High-impact caps prevent unrelated strengths from hiding serious gaps:

- an empty repository cannot score above 30;
- a confirmed, high-confidence tracked credential-shaped file caps the score at
  45;
- another confirmed high-impact security failure caps the score at 60;
- a production-facing repository with no tests caps the score at 70;
- a missing README caps readiness according to the selected profile.

The cap identifies a hygiene risk. It does not assert that a detected
credential is active.

### Scoring profiles

- `portfolio` is the default. Documentation, presentation, security, screenshots,
  and demo readiness receive more weight.
- `production` emphasizes security, tests, maintainability, deployment, and
  production-facing expectations.
- `experimental` relaxes deployment and test expectations but still treats
  secret hygiene seriously.
- `library` emphasizes documentation, tests, package structure, and
  maintainability while making application deployment mostly inapplicable.

Technology, repository size, declared intent, production status, and profile
determine applicability. Tiny static sites and experiments are not expected to
carry enterprise infrastructure, but they must still demonstrate enough
evidence to earn a high score.

With peer comparison enabled, repositories are ranked within groups such as
`node/production` or `static-web/non-production`. The absolute health score does
not change; peer rank is additional context.

## What it checks

The scanner detects Node.js, Next.js, React/Vite, Flutter, Laravel/PHP, Python,
static web projects, and unknown or mixed repositories. It reviews:

- README presence, project description, installation and usage guidance;
- licence, `.gitignore`, `.env.example`, suspicious tracked files, and redacted
  secret-shaped content;
- manifests, lock files, build/lint/test scripts, tests, and GitHub Actions;
- source layout, TODO/FIXME volume, placeholder content, generated files, and
  large tracked files;
- deployment configuration, screenshots, demo links, worktree cleanliness,
  repository activity, and maintainability.

Reports also identify strongest, weakest, highest-risk, easiest-to-improve, and
potentially abandoned repositories. Recommendations are prioritized using
severity, effort, likely impact, recent activity, and production status.

## Directory-level configuration

Create `repo-doctor.config.json` in the directory being scanned, or pass
`--config`. See
[`repo-doctor.config.example.json`](./repo-doctor.config.example.json).

```json
{
  "ignoreRepositories": ["archived-*", "vendor/legacy-app"],
  "maxDepth": 4,
  "largeFileBytes": 1048576,
  "scoringProfile": "portfolio",
  "comparisonMode": "peer",
  "customRules": []
}
```

Ignore patterns and rule file patterns support `*`, `**`, and `?`. Custom rules
can require or forbid a tracked file and may be limited to detected project
types.

## Repository-level intent

A scanned repository can include `.repo-doctor.json`. This file is read only
and may declare information that static inspection cannot infer reliably:

```json
{
  "intendedProjectType": "node",
  "productionStatus": "production",
  "private": true,
  "scoringProfile": "production",
  "intentionallyOmittedChecks": ["portfolio.visuals"],
  "customExclusions": ["fixtures/generated/**"]
}
```

Supported project types are `node`, `nextjs`, `react-vite`, `flutter`,
`laravel`, `python`, `static-web`, and `unknown`. Omitted checks are rendered as
`not-applicable`, reduce score confidence, and remain visible in the report.
Custom exclusions prevent matching tracked paths from being inspected; use them
sparingly because exclusions also reduce available evidence. See
[`repo-doctor.repository.example.json`](./repo-doctor.repository.example.json).

## Report metadata and compatibility

Reports include scan start time, duration, tool version, scoring profile,
comparison mode, ignored directories, and repository count. The additive JSON
fields retain schema version `1.0`; existing `overallScore`, `scores`,
`findings`, and action fields remain available. Score values will change because
the model now measures demonstrated evidence instead of starting every category
at 100. See [`MIGRATION.md`](./MIGRATION.md).

## Development

```sh
npm run lint
npm run build
npm test
npm run check
```

Tests create temporary Git repositories for scoring edge cases and verify
Markdown and JSON golden output. No fixture repository outside the operating
system temporary directory is changed.

## Exit codes

- `0`: scan and report generation completed;
- `1`: invalid CLI input or a fatal scan/output error;
- `2`: reports were generated, but one or more repositories had scan
  limitations.

## Known limits

The scanner relies on conventions and bounded text inspection. It does not
parse every programming language, validate documented commands, execute test
suites, inspect dependency vulnerabilities, or prove whether a
credential-shaped string is active. Activity uses the last local Git commit,
not remote hosting data. Peer groups with only one repository are descriptive,
not statistically meaningful. Inaccessible and malformed repositories are
included where possible with explicit low-confidence or unknown results.
