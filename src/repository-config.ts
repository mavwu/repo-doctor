import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  ProductionStatus,
  ProjectType,
  RepositoryConfig,
  ScoringProfileName
} from "./types.js";
import { scoringProfiles } from "./types.js";

const projectTypes = new Set<ProjectType>([
  "node",
  "nextjs",
  "react-vite",
  "flutter",
  "laravel",
  "python",
  "static-web",
  "unknown"
]);
const productionStatuses = new Set<ProductionStatus>([
  "production",
  "non-production",
  "unknown"
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

export async function loadRepositoryConfig(repository: string): Promise<{
  config: RepositoryConfig;
  path?: string;
  warnings: string[];
}> {
  const configPath = path.join(repository, ".repo-doctor.json");
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { config: {}, warnings: [] };
    }
    return {
      config: {},
      warnings: [`Could not read .repo-doctor.json: ${String(error)}`]
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      config: {},
      path: configPath,
      warnings: [".repo-doctor.json is not valid JSON."]
    };
  }
  if (!isObject(parsed)) {
    return {
      config: {},
      path: configPath,
      warnings: [".repo-doctor.json must contain a JSON object."]
    };
  }

  const warnings: string[] = [];
  const config: RepositoryConfig = {};
  if (typeof parsed.intendedProjectType === "string") {
    if (projectTypes.has(parsed.intendedProjectType as ProjectType)) {
      config.intendedProjectType = parsed.intendedProjectType as ProjectType;
    } else {
      warnings.push(`Unknown intendedProjectType: ${parsed.intendedProjectType}.`);
    }
  }
  if (typeof parsed.productionStatus === "string") {
    if (productionStatuses.has(parsed.productionStatus as ProductionStatus)) {
      config.productionStatus = parsed.productionStatus as ProductionStatus;
    } else {
      warnings.push(`Unknown productionStatus: ${parsed.productionStatus}.`);
    }
  }
  if (typeof parsed.private === "boolean") config.private = parsed.private;
  if (
    typeof parsed.scoringProfile === "string" &&
    (scoringProfiles as readonly string[]).includes(parsed.scoringProfile)
  ) {
    config.scoringProfile = parsed.scoringProfile as ScoringProfileName;
  } else if (parsed.scoringProfile !== undefined) {
    warnings.push(`Unknown repository scoringProfile: ${String(parsed.scoringProfile)}.`);
  }
  const intentionallyOmittedChecks = stringArray(parsed.intentionallyOmittedChecks);
  if (intentionallyOmittedChecks) {
    config.intentionallyOmittedChecks = intentionallyOmittedChecks;
  }
  const customExclusions = stringArray(parsed.customExclusions);
  if (customExclusions) config.customExclusions = customExclusions;

  return { config, path: configPath, warnings };
}
