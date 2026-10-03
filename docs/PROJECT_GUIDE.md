# repo-doctor: implementation guide

A read-only TypeScript CLI that inspects local Git repositories and creates evidence-based maintenance reports and targeted follow-up prompts.

## Scope

**Repository role:** Developer tool.

Scores are maintenance heuristics, not proof of security, authorship, production readiness, or execution of a repository's tests.

## Local evaluation

Use Node.js and npm, with the versions required by the manifest.

```sh
npm ci
npm run build
node dist/cli.js --help
```

Use the CLI options in the root README to scan a local directory of repositories. The scanner does not execute those repositories.

## Code map

| Path | Responsibility |
| --- | --- |
| `src` | Editable implementation source |
| `tests` | Automated test sources |

## Walkthrough

Build the CLI, scan a small directory of disposable test repositories, inspect the Markdown/JSON reports, and run the complete check command.

## Verification

From `.`: `npm run check`, `npm run lint`, `npm run test`, `npm run build`.

These are evaluation commands, not a claim that all checks passed. See the pull request validation for checks actually executed in this maintenance pass.

## Evidence for a case study

Describe this repository as a **developer tool**. A useful case study explains the problem above, traces the walkthrough to its source, names a concrete implementation decision, and records a repeatable evaluation. Separate implemented behavior from roadmap work. Capture screenshots using synthetic data and identify the demonstrated commit.
