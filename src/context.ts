import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { BioarcState, Target } from "./types.ts";
import { dependencyClosure, reverseConsumers, validationPlan } from "./workspace.ts";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULTS_ROOT = path.join(PLUGIN_ROOT, "defaults");

export function readText(file: string, max = 12000): string {
  try {
    return fs.readFileSync(file, "utf8").slice(0, max);
  } catch {
    return "";
  }
}

export function standardsText(): string {
  return readText(path.join(DEFAULTS_ROOT, "standards.yaml"), 12000);
}

export function defaultMetadataPath(target: Target): string {
  return path.join(DEFAULTS_ROOT, `${target.kind}s`, `${path.basename(target.folder)}.yaml`);
}

export function gitStatus(root: string): string {
  try {
    return execFileSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" }).trim() || "clean";
  } catch {
    return "unavailable";
  }
}

export function formatTargets(targets: Target[]): string {
  return targets.map((item) => `${item.name}  (${item.kind}, ${item.folder})`).join("\n") || "No package manifests found.";
}

export function targetDoc(state: BioarcState): string {
  if (!state.root || !state.target) return "No Bioarc target selected.";
  const { root, target, targets, expanded } = state;
  const manifest = target.manifest;
  const closure = [...dependencyClosure(target, targets)];
  const consumers = reverseConsumers(target, targets).map((item) => item.name);
  const extra = readText(path.join(target.path, "bioarc.yaml"), 6000);
  const defaults = readText(defaultMetadataPath(target), 6000);
  const readme = readText(path.join(target.path, "README.md"), 6000);
  const rootRules = [
    readText(path.join(root, "AGENTS.md"), 8000),
    readText(path.join(root, "README.md"), 4000),
  ].filter(Boolean).join("\n\n");
  return [
    `# ${target.name}`,
    `- Type: ${target.kind}`,
    `- Folder: ${target.folder}`,
    `- Version: ${manifest.version ?? "unknown"}`,
    `- Private: ${manifest.private ? "yes" : "no"}`,
    `- Description: ${manifest.description ?? "not declared"}`,
    `- Dependencies in workspace closure: ${closure.length ? closure.join(", ") : "none"}`,
    `- Reverse consumers: ${consumers.length ? consumers.join(", ") : "none discovered"}`,
    `- Expanded write folders: ${expanded.size ? [...expanded].join(", ") : "none"}`,
    "",
    "## Scripts",
    ...Object.entries(manifest.scripts ?? {}).map(([name, command]) => `- ${name}: ${command}`),
    "",
    "## Validation",
    ...validationPlan(target).map((command) => `- ${command}`),
    standardsText() ? `\n## Bioarc development standards\n${standardsText()}` : "",
    defaults ? `\n## Bioarc default metadata\n${defaults}` : "",
    extra ? `\n## Bioarc metadata\n${extra}` : "",
    readme ? `\n## Target README\n${readme}` : "",
    rootRules ? `\n## Repository rules\n${rootRules}` : "",
  ].filter(Boolean).join("\n");
}
