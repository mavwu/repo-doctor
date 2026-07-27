export interface ScoringFixture {
  name: string;
  files: Record<string, string>;
  commitDate?: string;
}

const polishedReadme = `# Polished Project

A polished user-facing project that demonstrates a complete workflow for prospective users and reviewers.

## Installation

Install dependencies with the package manager and copy the safe environment example when local configuration is required.

## Usage

Run the documented development command, open the application, and follow the included example workflow.

![Current application screenshot](docs/screenshot.png)

Live demo: https://demo.example.org
`;

export const scoringFixtures: ScoringFixture[] = [
  {
    name: "empty-repository",
    files: {}
  },
  {
    name: "static-landing-page",
    files: {
      "README.md": polishedReadme,
      "LICENSE": "MIT",
      ".gitignore": "*.log\n.DS_Store\n",
      "index.html": "<main><h1>Landing page</h1></main>",
      "styles.css": "body { font-family: sans-serif; }",
      "script.js": "document.documentElement.dataset.ready = 'true';",
      "docs/screenshot.png": "fixture-image",
      "netlify.toml": "[build]\npublish = \".\"\n"
    }
  },
  {
    name: "production-node-api-no-tests",
    files: {
      ".repo-doctor.json": JSON.stringify({
        intendedProjectType: "node",
        productionStatus: "production",
        scoringProfile: "production",
        private: true
      }),
      "README.md": `# Production API

A production-facing Node.js API that serves business-critical data to internal clients.

## Installation

Install dependencies, copy .env.example to .env, and provide environment-specific values through the deployment platform.

## Usage

Run the start command and request the documented health endpoint to verify the service.
`,
      ".gitignore": "node_modules/\n.env\n",
      ".env.example": "PORT=3000\nDATABASE_URL=postgres://example.invalid/database\n",
      "package.json": JSON.stringify({
        description: "A production-facing internal Node.js API",
        scripts: {
          build: "tsc",
          lint: "eslint src",
          start: "node dist/server.js"
        }
      }),
      "package-lock.json": "{}",
      "Dockerfile": "FROM node:24-alpine\n",
      "src/server.ts":
        "export const port = process.env.PORT ?? '3000';\nexport function health() { return { ok: true }; }\n"
    }
  },
  {
    name: "polished-portfolio-project",
    files: {
      ".repo-doctor.json": JSON.stringify({
        intendedProjectType: "react-vite",
        productionStatus: "production",
        scoringProfile: "portfolio",
        private: false
      }),
      "README.md": polishedReadme,
      "LICENSE": "MIT",
      ".gitignore": "node_modules/\ndist/\n.env\n",
      "package.json": JSON.stringify({
        description: "A polished portfolio application with verified workflows",
        scripts: {
          build: "vite build",
          lint: "eslint src",
          test: "vitest run"
        },
        dependencies: { react: "1.0.0" },
        devDependencies: { vite: "1.0.0" }
      }),
      "package-lock.json": "{}",
      "src/App.tsx": "export function App() { return <main>Ready</main>; }\n",
      "tests/App.test.tsx": "export const passingFixtureTest = true;\n",
      ".github/workflows/check.yml": "name: check\non: [push]\njobs: {}\n",
      "vercel.json": "{}",
      "docs/screenshot.png": "fixture-image"
    }
  },
  {
    name: "experimental-repository",
    commitDate: "2020-01-02T03:04:05Z",
    files: {
      ".repo-doctor.json": JSON.stringify({
        intendedProjectType: "python",
        productionStatus: "non-production",
        scoringProfile: "experimental",
        private: true,
        intentionallyOmittedChecks: ["deployment"]
      }),
      "README.md": "# Temporary spike\n\nA short-lived experiment.",
      "scratch.py": "print('experiment')\n"
    }
  },
  {
    name: "committed-environment-file",
    files: {
      "README.md": polishedReadme,
      "LICENSE": "MIT",
      ".gitignore": "node_modules/\n",
      ".env": "API_KEY='fixture-value-redacted-by-reporting-layer'\n",
      "package.json": JSON.stringify({
        description: "A documented application with unsafe tracked configuration",
        scripts: { test: "node --test", lint: "eslint ." }
      }),
      "package-lock.json": "{}",
      "src/index.js": "export const ready = true;\n",
      "tests/index.test.js": "export const passingFixtureTest = true;\n"
    }
  },
  {
    name: "strong-docs-weak-security",
    files: {
      "README.md": polishedReadme,
      "LICENSE": "MIT",
      ".gitignore": "*.log\n",
      "package.json": JSON.stringify({
        description: "A strongly documented project with a security hygiene failure",
        scripts: {
          build: "tsc",
          lint: "eslint src",
          test: "node --test"
        }
      }),
      "package-lock.json": "{}",
      "src/index.ts": "export const ready = true;\n",
      "tests/index.test.ts": "export const passingFixtureTest = true;\n",
      "credentials/private.key": "-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----\n"
    }
  },
  {
    name: "tests-without-readme",
    files: {
      ".repo-doctor.json": JSON.stringify({
        intendedProjectType: "node",
        productionStatus: "non-production",
        scoringProfile: "library",
        private: false
      }),
      "LICENSE": "MIT",
      ".gitignore": "node_modules/\ndist/\n",
      "package.json": JSON.stringify({
        description: "A tested package whose user documentation is missing",
        scripts: {
          build: "tsc",
          lint: "eslint src",
          test: "node --test"
        }
      }),
      "package-lock.json": "{}",
      "src/index.ts": "export function add(a: number, b: number) { return a + b; }\n",
      "tests/index.test.ts": "export const passingFixtureTest = true;\n",
      ".github/workflows/check.yml": "name: check\non: [push]\njobs: {}\n"
    }
  }
];
