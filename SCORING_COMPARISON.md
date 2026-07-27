# Scoring comparison: original model vs evidence-based model

Scan date: 2026-07-27

Directory: `C:\Users\viwap\Documents\GitHub`

Profile: `portfolio` (default)
Repositories: 49

## Outcome

| Measure | Original | Revised |
|---|---:|---:|
| Average score | 88 | 65 |
| Median score | Not recorded | 67 |
| Repositories requiring attention | 7 | 36 |
| Average score confidence | Not recorded | 0.86 |

The previous 88/100 average was overly generous. The original model started
categories at 100 and subtracted findings, so a check that was absent,
inapplicable, or unsupported by evidence could leave full credit behind. The
revised model awards points for demonstrated evidence, excludes
`not-applicable` checks from the denominator, gives limited credit to warnings
and unknowns, and exposes every calculation.

This is a baseline change, not evidence that the repositories deteriorated.
Forty-eight scores decreased, one was unchanged, and none increased. Forty-one
changed by at least 10 points; 31 changed by at least 20 points. `NearbyLynk`
remained at 98 because it demonstrates nearly all applicable evidence under
both models.

## Significant changes

This table uses 20 points as the significance threshold.

| Repository | Old | New | Change | Main explanation |
|---|---:|---:|---:|---|
| campuslink | 92 | 30 | -62 | Empty repository; no evidence can justify readiness. |
| ZedWork-App | 92 | 42 | -50 | One tracked file, unidentified project type, and no README evidence. |
| Project101 | 91 | 42 | -49 | Two tracked files, unidentified project type, and no documentation evidence. |
| apartment-demo | 77 | 38 | -39 | No README, licence, manifest, or tests; large-file and placeholder warnings. |
| bakery-demo | 91 | 53 | -38 | Static site with no README/licence and only partial test, deployment, and portfolio evidence. |
| zedmavv | 90 | 52 | -38 | No README/licence; manifest, testing, deployment, and placeholder evidence is incomplete. |
| Report-Card-Generator | 93 | 56 | -37 | No README/licence; static-site testing, deployment, demo, and visual evidence is partial. |
| csa-website | 92 | 56 | -36 | No README/licence; only partial test and deployment readiness evidence. |
| public-profile-analyzer | 90 | 55 | -35 | No README/licence/tests; environment usage lacks a safe template and ignore policy. |
| alfred-apartments-demo | 91 | 57 | -34 | No README/licence; partial manifest, test, deployment, demo, and visual evidence. |
| ez-statements-zm-website | 90 | 57 | -33 | No README/licence; partial static-site testing/deployment evidence and a large-file warning. |
| stockflow-web | 76 | 43 | -33 | No documentation or tests; partial manifest/deployment evidence and large-file warning. |
| Linktree-Project | 91 | 59 | -32 | No README/licence; partial test, deployment, and demo evidence. |
| blog | 88 | 57 | -31 | No README/licence and therefore no demonstrated installation or usage guidance. |
| retail-management-system | 81 | 50 | -31 | No README/licence; generated and sensitive-shaped file warnings plus incomplete CI evidence. |
| frontend-mavwublog | 81 | 52 | -29 | No README/licence; production-facing no-test cap plus incomplete CI/manifest/demo evidence. |
| csa_app_mlm | 79 | 52 | -27 | No README/licence or ignore policy; redacted secret-pattern concern and large-file/placeholder warnings. |
| billing-system-demo | 93 | 67 | -26 | Setup/usage/licence/ignore gaps and only partial static-site test/deployment/demo evidence. |
| Bright-Minds-Support-Centre | 93 | 67 | -26 | Setup/usage/licence/ignore gaps and only partial static-site test/deployment/demo evidence. |
| dashboard-api | 71 | 45 | -26 | Confirmed tracked credential-shaped files trigger the 45 security cap; this does not prove credentials are active. |
| ZedStudy | 93 | 67 | -26 | Setup/licence/ignore gaps and partial static-site test, manifest, and deployment evidence. |
| mavwu.github.io | 95 | 70 | -25 | Missing setup/licence plus a production-facing no-test cap and partial CI evidence. |
| salon-demo | 93 | 68 | -25 | Setup/usage/licence gaps and partial test/deployment evidence with a large-file warning. |
| StayRooted | 92 | 67 | -25 | No README/licence and unidentified project type reduce evidence and confidence. |
| backend-operations-system | 81 | 58 | -23 | No README/licence and therefore no demonstrated setup or usage guidance. |
| money_tracker | 93 | 71 | -22 | README/setup/usage and ignore-policy gaps; project type remains uncertain. |
| RideYanga-site | 79 | 58 | -21 | Missing setup/licence/ignore policy and environment template, plus placeholder content. |
| kasuda-apartments-site | 79 | 59 | -20 | Setup/usage/licence/ignore gaps with partial CI, manifest, and file-hygiene evidence. |
| kasuda-apartments-website | 79 | 59 | -20 | Setup/usage/licence/ignore gaps with partial CI, manifest, and file-hygiene evidence. |
| stockflow | 81 | 61 | -20 | No README/licence, redacted secret-pattern concern, and production-facing no-test cap. |
| ProjectPath | 90 | 70 | -20 | No tests triggers the production-facing cap; licence and lint evidence are also missing. |

## Strongest and highest-risk repositories

The strongest revised scores are:

1. `NearbyLynk` — 98, high confidence.
2. `LodgeDesk` — 91, medium confidence.
3. `Alfy-Work-Intelligence` — 90, medium confidence.
4. `csa_appML` — 88, high confidence.
5. `csa_app` — 84, high confidence.

`dashboard-api` should be reviewed first because it is the only repository in
this scan with a confirmed, high-confidence tracked credential-shaped file
finding and an overall security cap. Verification and any credential rotation
still require the relevant system owner; repo-doctor does not establish whether
the material is active. Other high-risk entries are driven mainly by absent
ignore policies and lower-confidence redacted content matches.

## Interpretation

The 23-point average reduction is realistic for the evidence available in the
local repositories. It does not mean that every low-scoring static site needs
CI or extensive automated tests. Static and experimental contexts convert some
of those gaps to warnings or `not-applicable`; they still cannot receive high
scores solely because enterprise checks were excluded. Repository-level intent
files can improve classification and confidence without silently awarding
points.

The original report remains under
`reports/github-projects/baseline-v0.1.0/`; the revised Markdown and JSON reports
are under `reports/github-projects/`.
