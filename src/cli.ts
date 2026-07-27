#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runRepoDoctor } from "./index.js";
import { terminalSummary } from "./report.js";
import type { CliOptions, ScoringProfileName } from "./types.js";
import { scoringProfiles } from "./types.js";

const help = `repo-doctor — read-only health reports for local Git repositories

Usage:
  repo-doctor <directory> [options]
  repo-doctor --help

Arguments:
  directory                  Directory containing one or more Git repositories

Options:
  -o, --output <directory>   Report output directory (default: ./repo-doctor-reports)
  -c, --config <file>        JSON configuration file
      --max-depth <number>   Maximum discovery depth (default: 4)
      --large-file-kb <n>    Large tracked-file threshold in KiB (default: 1024)
      --profile <name>       portfolio, production, experimental, or library
      --comparison <mode>    peer or none (default: peer)
      --compare              Alias for --comparison peer
  -q, --quiet                Suppress the terminal summary
  -h, --help                 Show this help
  -v, --version              Show the version

Configuration:
  repo-doctor automatically reads repo-doctor.config.json from the scanned
  directory. Use --config to select another file. Supported settings:
  ignoreRepositories, maxDepth, largeFileBytes, scoringProfile,
  comparisonMode, and customRules.

  A repository may include .repo-doctor.json to declare intent, omitted checks,
  privacy, a profile override, or excluded paths.

Safety:
  The scanner reads local files and invokes read-only Git inspection commands.
  It never runs package scripts or prints detected secret values.
`;

function requireValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${option} requires a value.`);
  return value;
}

export function parseArguments(args: string[]): CliOptions | "help" | "version" {
  if (args.includes("--help") || args.includes("-h")) return "help";
  if (args.includes("--version") || args.includes("-v")) return "version";
  let directory: string | undefined;
  let outputDirectory = path.resolve("repo-doctor-reports");
  let configPath: string | undefined;
  let maxDepth: number | undefined;
  let largeFileBytes: number | undefined;
  let scoringProfile: ScoringProfileName | undefined;
  let comparisonMode: "peer" | "none" | undefined;
  let quiet = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "-o" || argument === "--output") {
      outputDirectory = path.resolve(requireValue(args, index, argument));
      index += 1;
    } else if (argument === "-c" || argument === "--config") {
      configPath = path.resolve(requireValue(args, index, argument));
      index += 1;
    } else if (argument === "--max-depth") {
      const value = Number(requireValue(args, index, argument));
      if (!Number.isInteger(value) || value < 0 || value > 20) {
        throw new Error("--max-depth must be an integer between 0 and 20.");
      }
      maxDepth = value;
      index += 1;
    } else if (argument === "--large-file-kb") {
      const value = Number(requireValue(args, index, argument));
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("--large-file-kb must be a positive number.");
      }
      largeFileBytes = Math.round(value * 1024);
      index += 1;
    } else if (argument === "--profile") {
      const value = requireValue(args, index, argument);
      if (!(scoringProfiles as readonly string[]).includes(value)) {
        throw new Error(
          `--profile must be one of: ${scoringProfiles.join(", ")}.`
        );
      }
      scoringProfile = value as ScoringProfileName;
      index += 1;
    } else if (argument === "--comparison") {
      const value = requireValue(args, index, argument);
      if (value !== "peer" && value !== "none") {
        throw new Error("--comparison must be peer or none.");
      }
      comparisonMode = value;
      index += 1;
    } else if (argument === "--compare") {
      comparisonMode = "peer";
    } else if (argument === "-q" || argument === "--quiet") {
      quiet = true;
    } else if (argument?.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (!directory) {
      directory = argument;
    } else {
      throw new Error(`Unexpected argument: ${argument}`);
    }
  }
  if (!directory) throw new Error("A directory path is required. Run repo-doctor --help.");
  return {
    directory: path.resolve(directory),
    outputDirectory,
    ...(configPath ? { configPath } : {}),
    ...(maxDepth !== undefined ? { maxDepth } : {}),
    ...(largeFileBytes !== undefined ? { largeFileBytes } : {}),
    ...(scoringProfile ? { scoringProfile } : {}),
    ...(comparisonMode ? { comparisonMode } : {}),
    quiet
  };
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const parsed = parseArguments(args);
    if (parsed === "help") {
      process.stdout.write(help);
      return 0;
    }
    if (parsed === "version") {
      process.stdout.write("repo-doctor 0.1.0\n");
      return 0;
    }
    const result = await runRepoDoctor(parsed);
    if (!parsed.quiet) {
      process.stdout.write(
        `${terminalSummary(result.report, result.markdownPath, result.jsonPath)}\n`
      );
    }
    return result.report.repositories.some((repository) => repository.errors.length > 0)
      ? 2
      : 0;
  } catch (error) {
    process.stderr.write(`repo-doctor: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
) {
  process.exitCode = await main();
}
