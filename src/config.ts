import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  RepoDoctorConfig,
  ScoreCategory,
  ScoringProfileName
} from "./types.js";
import { scoreCategories, scoringProfiles } from "./types.js";

export const defaultConfig: RepoDoctorConfig = {
  ignoreRepositories: [],
  maxDepth: 4,
  largeFileBytes: 1024 * 1024,
  customRules: [],
  scoringProfile: "portfolio",
  comparisonMode: "peer"
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asScoreCategory(value: unknown): ScoreCategory | undefined {
  return typeof value === "string" &&
    (scoreCategories as readonly string[]).includes(value)
    ? (value as ScoreCategory)
    : undefined;
}

function asScoringProfile(value: unknown): ScoringProfileName | undefined {
  return typeof value === "string" &&
    (scoringProfiles as readonly string[]).includes(value)
    ? (value as ScoringProfileName)
    : undefined;
}

export async function loadConfig(
  directory: string,
  explicitPath?: string
): Promise<{ config: RepoDoctorConfig; path?: string; warnings: string[] }> {
  const configPath = explicitPath
    ? path.resolve(explicitPath)
    : path.join(directory, "repo-doctor.config.json");
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!explicitPath && code === "ENOENT") {
      return { config: structuredClone(defaultConfig), warnings: [] };
    }
    throw new Error(`Unable to read configuration at ${configPath}: ${String(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Configuration is not valid JSON: ${configPath}`);
  }
  if (!isObject(parsed)) {
    throw new Error(`Configuration must contain a JSON object: ${configPath}`);
  }

  const warnings: string[] = [];
  const config = structuredClone(defaultConfig);
  if (Array.isArray(parsed.ignoreRepositories)) {
    config.ignoreRepositories = parsed.ignoreRepositories.filter(
      (item): item is string => typeof item === "string"
    );
  }
  if (typeof parsed.maxDepth === "number" && parsed.maxDepth >= 0) {
    config.maxDepth = Math.floor(parsed.maxDepth);
  }
  if (typeof parsed.largeFileBytes === "number" && parsed.largeFileBytes > 0) {
    config.largeFileBytes = Math.floor(parsed.largeFileBytes);
  }
  const scoringProfile = asScoringProfile(parsed.scoringProfile);
  if (scoringProfile) {
    config.scoringProfile = scoringProfile;
  } else if (parsed.scoringProfile !== undefined) {
    warnings.push(`Ignored unknown scoring profile: ${String(parsed.scoringProfile)}.`);
  }
  if (parsed.comparisonMode === "peer" || parsed.comparisonMode === "none") {
    config.comparisonMode = parsed.comparisonMode;
  } else if (parsed.comparisonMode !== undefined) {
    warnings.push(`Ignored unknown comparison mode: ${String(parsed.comparisonMode)}.`);
  }
  if (Array.isArray(parsed.customRules)) {
    for (const [index, rawRule] of parsed.customRules.entries()) {
      if (!isObject(rawRule)) {
        warnings.push(`Ignored custom rule ${index + 1}: expected an object.`);
        continue;
      }
      const category = asScoreCategory(rawRule.category);
      const kind =
        rawRule.kind === "require-file" || rawRule.kind === "forbid-file"
          ? rawRule.kind
          : undefined;
      if (
        typeof rawRule.id !== "string" ||
        typeof rawRule.description !== "string" ||
        typeof rawRule.pattern !== "string" ||
        typeof rawRule.deduction !== "number" ||
        !category ||
        !kind
      ) {
        warnings.push(`Ignored custom rule ${index + 1}: missing or invalid fields.`);
        continue;
      }
      const severity =
        rawRule.severity === "confirmed" ||
        rawRule.severity === "possible" ||
        rawRule.severity === "info"
          ? rawRule.severity
          : undefined;
      const projectTypes = Array.isArray(rawRule.projectTypes)
        ? rawRule.projectTypes.filter((item): item is never => typeof item === "string")
        : undefined;
      config.customRules.push({
        id: rawRule.id,
        description: rawRule.description,
        kind,
        pattern: rawRule.pattern.replaceAll("\\", "/"),
        category,
        deduction: Math.max(0, Math.min(30, rawRule.deduction)),
        ...(severity ? { severity } : {}),
        ...(projectTypes ? { projectTypes } : {})
      });
    }
  }

  return { config, path: configPath, warnings };
}
