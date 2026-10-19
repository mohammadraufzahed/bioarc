import path from "node:path";
import type { Target } from "./types.ts";
import { TARGET_ROOTS } from "./workspace.ts";

export const ROOT_SAFE_FILES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
]);

const MUTATING_BASH = /(?:^|[;&|]\s*)(?:rm|mv|cp|mkdir|touch|install|chmod|chown|ln|sed\s+-i|perl\s+-i|git\s+(?:checkout|reset|clean|restore)|(?:pnpm|npm|yarn|bun)\s+install)\b/i;

export function relativePath(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}

export function pathIsWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function normalizeToolPath(root: string, cwd: string | undefined, value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let clean = value.trim();
  const hashline = clean.match(/^\[(.*)#[0-9A-Fa-f]{4}\]$/);
  if (hashline) clean = hashline[1];
  if (clean.startsWith("file://")) clean = clean.slice("file://".length);
  if (/^[a-z]+:\/\//i.test(clean) && !clean.startsWith("file://")) return null;
  return path.resolve(cwd || root, clean);
}

export function parseEditPaths(input: unknown): string[] {
  if (typeof input !== "string") return [];
  const paths: string[] = [];
  for (const match of input.matchAll(/\[([^\]#]+)(?:#[0-9A-Fa-f]{4})?\]/g)) paths.push(match[1]);
  for (const match of input.matchAll(/^\s*MV\s+(.+)$/gm)) paths.push(match[1].trim().replace(/^['"]|['"]$/g, ""));
  return paths;
}

export function isWriteAllowed(root: string, target: Target | null | undefined, absolutePath: string | null | undefined, expanded = new Set<string>()): boolean {
  if (!target || !absolutePath || !pathIsWithin(root, absolutePath)) return false;
  const relative = relativePath(root, absolutePath);
  if (ROOT_SAFE_FILES.has(relative)) return true;
  if (relative.startsWith(`${target.folder}/`)) return true;
  for (const folder of expanded) {
    if (relative.startsWith(`${folder}/`)) return true;
  }
  return false;
}

function isWorkspaceTargetPath(root: string, absolutePath: string): boolean {
  const relative = relativePath(root, absolutePath);
  return TARGET_ROOTS.some((folder) => relative.startsWith(`${folder}/`));
}

/** Return a user-facing reason when a shell command violates the active scope. */
export function commandGuardReason(root: string, command: string, target: Target | null | undefined, expanded = new Set<string>()): string | null {
  if (!target) return "No Bioarc target is selected.";
  const candidates = command.match(/(?:apps|packages)\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._*?-]+)*/g) ?? [];
  for (const candidate of candidates) {
    const absolute = path.resolve(root, candidate);
    if (isWorkspaceTargetPath(root, absolute) && !isWriteAllowed(root, target, absolute, expanded)) {
      return `command mentions ${candidate}, outside the active target ${target.name}`;
    }
  }
  if (MUTATING_BASH.test(command) && !/(?:git\s+(?:status|diff|log)|pnpm\s+(?:turbo|--filter)|turbo\s+run|bioarc)/i.test(command)) {
    return "command looks mutating; use Bioarc write/edit tools or explicitly expand the target first";
  }
  return null;
}
