# Scoring-quality migration note

This scoring pass does not change the package version or the JSON schema
version. Existing CLI invocations continue to work, and the existing
`overallScore`, category `scores`, `findings`, and action fields remain present.

Scores are intentionally not numerically backward-compatible. Earlier reports
started categories at 100 and subtracted detected problems. That could reward
small or weakly evidenced repositories when checks did not apply or could not
be observed. The revised model awards points only for explicit evidence and
records every check as `passed`, `failed`, `warning`, `unknown`, or
`not-applicable`.

Important behavior changes:

- the default `portfolio` profile is explicit;
- `production`, `experimental`, and `library` profiles are available through
  `--profile` or configuration;
- serious, high-confidence security hygiene failures can cap the overall score;
- empty repositories, production applications without tests, and repositories
  without a README cannot receive misleadingly high scores;
- each repository has a score confidence level and exact point explanation;
- peer comparison is enabled by default and does not alter absolute scores;
- reports add scan metadata, peer groups, risk/strength summaries, activity
  signals, and prioritized effort/impact recommendations;
- `.repo-doctor.json` can declare repository intent and intentional omissions.

For automation that consumes JSON, continue reading the existing fields and
treat new fields as additive. If an integration asserts historical score
thresholds, establish a new baseline before enforcing those thresholds. Review
score caps and low-confidence results before treating a change as a regression.
