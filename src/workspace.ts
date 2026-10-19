import fs from "node:fs";
import path from "node:path";
import type { PackageManifest, Target, TargetKind, TargetResolution, Workspace } from "./types.ts";

export const CANONICAL_WORKSPACE_ROOT = "/home/heaton/Workspace/BioArc/modules-monorepo";
export const TARGET_ROOTS = ["apps", "packages"] as const;

function isPackageManifest(value: unknown): value is PackageManifest {
  if (!value || typeof value !== "object" || !("name" in value)) return false;
  return typeof value.name === "string";
}

function readJson(file: string): PackageManifest | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!isPackageManifest(value)) return null;
    return value;
  } catch {
    return null;
  }
}

function walkUp(start: string, predicate: (directory: string) => boolean): string | null {
  let current = path.resolve(start);
  while (true) {
    if (predicate(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function isCanonicalWorkspacePath(start: string, workspaceRoot = CANONICAL_WORKSPACE_ROOT): boolean {
  const relative = path.relative(path.resolve(workspaceRoot), path.resolve(start));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Find the canonical workspace only; other Turborepo roots are intentionally ignored. */
export function findWorkspaceRoot(start: string, workspaceRoot = CANONICAL_WORKSPACE_ROOT): string | null {
  const expected = path.resolve(workspaceRoot);
  if (!isCanonicalWorkspacePath(start, expected)) return null;
  return walkUp(start, (directory) =>
    directory === expected &&
    fs.existsSync(path.join(directory, "turbo.json")) &&
    fs.existsSync(path.join(directory, "pnpm-workspace.yaml")),
  );
}

function targetKind(folder: string): TargetKind {
  return folder === "apps" ? "app" : "package";
}

export function discoverTargets(root: string): Target[] {
  const targets: Target[] = [];
  for (const folder of TARGET_ROOTS) {
    const base = path.join(root, folder);
    if (!fs.existsSync(base)) continue;
    const entries = fs.readdirSync(base, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folderPath = path.join(base, entry.name);
      const manifest = readJson(path.join(folderPath, "package.json"));
      if (!manifest) continue;
      targets.push({
        name: manifest.name,
        folder: `${folder}/${entry.name}`,
        kind: targetKind(folder),
        path: folderPath,
        manifest,
      });
    }
  }
  return targets;
}

export function loadWorkspace(root: string): Workspace {
  return { root, targets: discoverTargets(root) };
}

function dependencyNames(manifest: PackageManifest): Set<string> {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
}

export function dependencyClosure(target: Target | null | undefined, targets: Target[]): Set<string> {
  const byName = new Map(targets.map((item) => [item.name, item]));
  const result = new Set<string>();
  const visit = (name: string): void => {
    if (result.has(name)) return;
    const item = byName.get(name);
    if (!item) return;
    result.add(name);
    for (const dependency of dependencyNames(item.manifest)) visit(dependency);
  };
  if (target) visit(target.name);
  return result;
}

export function reverseConsumers(target: Target | null | undefined, targets: Target[]): Target[] {
  if (!target) return [];
  const consumers = targets.filter((item) => item.name !== target.name && dependencyNames(item.manifest).has(target.name));
  const result: Target[] = [];
  const queue = [...consumers];
  const seen = new Set(queue.map((item) => item.name));
  while (queue.length) {
    const item = queue.shift()!;
    result.push(item);
    for (const candidate of targets) {
      if (seen.has(candidate.name)) continue;
      if (dependencyNames(candidate.manifest).has(item.name)) {
        seen.add(candidate.name);
        queue.push(candidate);
      }
    }
  }
  return result;
}

export function resolveTargetDetailed(targets: Target[], query: string): TargetResolution {
  const value = query.trim();
  if (!value) return { status: "missing", candidates: [] };
  const matches = targets.filter((target) =>
    target.name === value ||
    target.folder === value ||
    path.basename(target.folder) === value,
  );
  if (matches.length === 1) return { status: "match", target: matches[0], candidates: matches };
  if (matches.length > 1) return { status: "ambiguous", candidates: matches };
  return { status: "missing", candidates: [] };
}

/** Resolve only unambiguous names, paths, or target directory basenames. */
export function resolveTarget(targets: Target[], query: string): Target | null {
  return resolveTargetDetailed(targets, query).target ?? null;
}

export function formatResolution(query: string, resolution: TargetResolution): string {
  if (resolution.status === "ambiguous") {
    return `Target '${query.trim()}' is ambiguous; choose one of: ${resolution.candidates.map((item) => `${item.name} (${item.folder})`).join(", ")}.`;
  }
  return `Unknown target '${query.trim()}'.`;
}

export function validationPlan(target: Target): string[] {
  const scripts = target.manifest.scripts ?? {};
  if (target.kind === "app" && scripts.validate) return [`pnpm --filter ${target.name} run validate`];
  const tasks = ["build"];
  if (scripts["check-types"] || target.kind === "package") tasks.push("check-types");
  if (scripts["test:run"] || target.kind === "package") tasks.push("test:run");
  return [`pnpm turbo run ${tasks.join(" ")} --filter=${target.name}...`];
}
