import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TARGET_ROOTS = ["apps", "packages"];
const ROOT_SAFE_FILES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
]);
const MUTATING_BASH = /(?:^|[;&|]\s*)(?:rm|mv|cp|mkdir|touch|install|chmod|chown|ln|sed\s+-i|perl\s+-i|git\s+(?:checkout|reset|clean|restore)|(?:pnpm|npm|yarn|bun)\s+install)\b/i;
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULTS_ROOT = path.join(PLUGIN_ROOT, "defaults");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readText(file, max = 12000) {
  try {
    return fs.readFileSync(file, "utf8").slice(0, max);
  } catch {
    return "";
  }
}

function walkUp(start, predicate) {
  let current = path.resolve(start);
  while (true) {
    if (predicate(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function findWorkspaceRoot(start) {
  return walkUp(start, (dir) =>
    fs.existsSync(path.join(dir, "turbo.json")) &&
    fs.existsSync(path.join(dir, "pnpm-workspace.yaml")),
  );
}

function targetKind(root, folder) {
  return folder === "apps" ? "app" : "package";
}

export function discoverTargets(root) {
  const targets = [];
  for (const folder of TARGET_ROOTS) {
    const base = path.join(root, folder);
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const folderPath = path.join(base, entry.name);
      const manifestPath = path.join(folderPath, "package.json");
      const manifest = readJson(manifestPath);
      if (!manifest?.name) continue;
      targets.push({
        name: manifest.name,
        folder: `${folder}/${entry.name}`,
        kind: targetKind(root, folder),
        path: folderPath,
        manifest,
      });
    }
  }
  return targets;
}

export function resolveTarget(targets, query) {
  const value = query.trim();
  return targets.find((target) => target.name === value || target.folder === value || path.basename(target.folder) === value) ?? null;
}

function dependencyNames(manifest) {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
}

export function dependencyClosure(target, targets) {
  const byName = new Map(targets.map((item) => [item.name, item]));
  const result = new Set();
  const visit = (name) => {
    if (result.has(name)) return;
    const item = byName.get(name);
    if (!item) return;
    result.add(name);
    for (const dependency of dependencyNames(item.manifest)) visit(dependency);
  };
  visit(target.name);
  return result;
}

export function reverseConsumers(target, targets) {
  const byName = new Map(targets.map((item) => [item.name, item]));
  const consumers = [];
  for (const item of targets) {
    if (item.name === target.name) continue;
    if (dependencyNames(item.manifest).has(target.name)) consumers.push(item);
  }
  const result = [];
  const queue = [...consumers];
  const seen = new Set(queue.map((item) => item.name));
  while (queue.length) {
    const item = queue.shift();
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

function relativePath(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function pathIsWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function normalizeToolPath(root, cwd, value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let clean = value.trim();
  const hashline = clean.match(/^\[(.*)#[0-9A-Fa-f]{4}\]$/);
  if (hashline) clean = hashline[1];
  if (clean.startsWith("file://")) clean = clean.slice("file://".length);
  if (/^[a-z]+:\/\//i.test(clean) && !clean.startsWith("file://")) return null;
  return path.resolve(cwd || root, clean);
}

export function parseEditPaths(input) {
  if (typeof input !== "string") return [];
  const paths = [];
  for (const match of input.matchAll(/\[([^\]#]+)(?:#[0-9A-Fa-f]{4})?\]/g)) paths.push(match[1]);
  for (const match of input.matchAll(/^\s*MV\s+(.+)$/gm)) paths.push(match[1].trim().replace(/^['"]|['"]$/g, ""));
  return paths;
}

export function isWriteAllowed(root, target, absolutePath, expanded = new Set()) {
  if (!target || !absolutePath || !pathIsWithin(root, absolutePath)) return false;
  const relative = relativePath(root, absolutePath);
  if (ROOT_SAFE_FILES.has(relative)) return true;
  if (relative.startsWith(`${target.folder}/`)) return true;
  for (const folder of expanded) if (relative.startsWith(`${folder}/`)) return true;
  return false;
}

function isWorkspaceTargetPath(root, absolutePath) {
  const relative = relativePath(root, absolutePath);
  return TARGET_ROOTS.some((folder) => relative.startsWith(`${folder}/`));
}

function commandMentionsOutsideScope(root, command, target, expanded) {
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

function gitStatus(root) {
  try {
    return execFileSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" }).trim() || "clean";
  } catch {
    return "unavailable";
  }
}

function validationPlan(target) {
  const scripts = target.manifest.scripts ?? {};
  if (target.kind === "app" && scripts.validate) return [`pnpm --filter ${target.name} run validate`];
  const tasks = ["build"];
  if (scripts["check-types"] || target.kind === "package") tasks.push("check-types");
  if (scripts["test:run"] || target.kind === "package") tasks.push("test:run");
  return [`pnpm turbo run ${tasks.join(" ")} --filter=${target.name}...`];
}

function defaultMetadataPath(target) {
  return path.join(
    DEFAULTS_ROOT,
    `${target.kind}s`,
    `${path.basename(target.folder)}.yaml`,
  );
}

function targetDoc(state) {
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
    defaults ? `\n## Bioarc default metadata\n${defaults}` : "",
    extra ? `\n## Bioarc metadata\n${extra}` : "",
    readme ? `\n## Target README\n${readme}` : "",
    rootRules ? `\n## Repository rules\n${rootRules}` : "",
  ].filter(Boolean).join("\n");
}

function stateFor(states, ctx) {
  const key = `${ctx.cwd}:${ctx.sessionManager?.getSessionId?.() ?? "default"}`;
  if (!states.has(key)) states.set(key, { key, cwd: ctx.cwd, root: null, targets: [], target: null, expanded: new Set(), baseline: "not captured" });
  return states.get(key);
}

function formatTargets(targets) {
  return targets.map((item) => `${item.name}  (${item.kind}, ${item.folder})`).join("\n") || "No package manifests found.";
}

function setupState(state) {
  state.root = findWorkspaceRoot(state.cwd);
  if (!state.root) return "Bioarc could not find a Turborepo root containing turbo.json and pnpm-workspace.yaml.";
  state.targets = discoverTargets(state.root);
  return null;
}

function notify(ctx, text, level = "info") {
  ctx.ui.notify(text.length > 6000 ? `${text.slice(0, 6000)}\n…` : text, level);
}

export function createBioarcExtension() {
  const states = new Map();
  return (pi) => {
    pi.setLabel("Bioarc");

    pi.on("session_start", (_event, ctx) => {
      const state = stateFor(states, ctx);
      const error = setupState(state);
      state.baseline = error ? "unavailable" : gitStatus(state.root);
      if (error) notify(ctx, error, "warning");
      else notify(ctx, `Bioarc ready. Select a target with /bioarc select <app-or-package>.`, "info");
    });

    pi.on("session_shutdown", (_event, ctx) => {
      states.delete(`${ctx.cwd}:${ctx.sessionManager?.getSessionId?.() ?? "default"}`);
    });

    pi.on("before_agent_start", (_event, ctx) => {
      const state = stateFor(states, ctx);
      if (!state.root) setupState(state);
      const target = state.target;
      if (!target) {
        return { systemPrompt: "Bioarc is active. No target is selected. You may inspect the workspace, but do not modify files. Ask the developer to use /bioarc select <target> before editing." };
      }
      const closure = [...dependencyClosure(target, state.targets)];
      return {
        systemPrompt: [
          "Bioarc target policy:",
          `- Active target: ${target.name} (${target.kind}) at ${target.folder}`,
          `- Writable folder: ${target.folder}`,
          `- Readable internal dependency closure: ${closure.join(", ") || "none"}`,
          `- Explicitly expanded writable folders: ${[...state.expanded].join(", ") || "none"}`,
          "- Do not modify another app/package without /bioarc expand <target>.",
          "- Use the repository's existing package scripts and filtered Turborepo commands.",
          `- Required validation: ${validationPlan(target).join("; ")}`,
        ].join("\n"),
      };
    });

    pi.on("tool_call", (event, ctx) => {
      if (!["write", "edit", "bash"].includes(event.toolName)) return;
      const state = stateFor(states, ctx);
      if (!state.root) setupState(state);
      if (!state.root) return { block: true, reason: "Bioarc cannot identify the workspace root." };

      if (event.toolName === "bash") {
        const input = event.input ?? {};
        const reason = commandMentionsOutsideScope(state.root, String(input.command ?? ""), state.target, state.expanded);
        if (reason) return { block: true, reason: `Bioarc blocked this bash command: ${reason}.` };
        return;
      }

      const input = event.input ?? {};
      const rawPaths = event.toolName === "write" ? [input.path] : parseEditPaths(input.input);
      if (!state.target) return { block: true, reason: "Bioarc requires a selected target before file changes. Use /bioarc select <app-or-package>." };
      const paths = rawPaths.map((value) => normalizeToolPath(state.root, ctx.cwd, value)).filter(Boolean);
      const denied = paths.find((candidate) => !isWriteAllowed(state.root, state.target, candidate, state.expanded));
      if (denied) {
        return { block: true, reason: `Bioarc blocked ${relativePath(state.root, denied)}. Active target is ${state.target.name}; use /bioarc expand <target> for an intentional cross-target change.` };
      }
    });

    pi.registerCommand("bioarc", {
      description: "Select a Bioarc app/package and inspect its repository policy",
      handler: async (args, ctx) => {
        const state = stateFor(states, ctx);
        const error = setupState(state);
        if (error) return notify(ctx, error, "warning");
        const [command = "help", ...rest] = args.trim().split(/\s+/);
        const query = rest.join(" ");
        if (command === "targets") return notify(ctx, formatTargets(state.targets));
        if (command === "select") {
          const target = resolveTarget(state.targets, query);
          if (!target) return notify(ctx, `Unknown target '${query}'.\n\n${formatTargets(state.targets)}`, "warning");
          state.target = target;
          state.expanded = new Set();
          state.baseline = gitStatus(state.root);
          return notify(ctx, `Bioarc target selected: ${target.name}\nWritable: ${target.folder}\nUse /bioarc docs or /bioarc verify for details.`);
        }
        if (command === "clear") {
          state.target = null;
          state.expanded = new Set();
          return notify(ctx, "Bioarc target cleared. File writes are blocked until a target is selected.");
        }
        if (!state.target && ["docs", "impact", "verify", "expand", "status"].includes(command)) return notify(ctx, "Select a target first with /bioarc select <app-or-package>.", "warning");
        if (command === "docs") return notify(ctx, targetDoc(state));
        if (command === "impact") {
          const dependencies = [...dependencyClosure(state.target, state.targets)].join("\n- ");
          const consumers = reverseConsumers(state.target, state.targets).map((item) => item.name).join("\n- ") || "none discovered";
          return notify(ctx, `Target: ${state.target.name}\n\nInternal dependency closure:\n- ${dependencies || "none"}\n\nAffected consumers:\n- ${consumers}`);
        }
        if (command === "status") return notify(ctx, `Target: ${state.target?.name ?? "none"}\nRoot: ${state.root}\nBaseline: ${state.baseline}\nCurrent git status:\n${gitStatus(state.root)}\nExpanded writes: ${[...state.expanded].join(", ") || "none"}`);
        if (command === "expand") {
          const target = resolveTarget(state.targets, query);
          if (!target) return notify(ctx, `Unknown target '${query}'.`, "warning");
          state.expanded.add(target.folder);
          return notify(ctx, `Bioarc write scope expanded to ${target.name} (${target.folder}).`);
        }
        if (command === "verify") return notify(ctx, `Validation plan for ${state.target.name}:\n- ${validationPlan(state.target).join("\n- ")}`);
        return notify(ctx, "Bioarc commands: /bioarc targets, select <target>, status, docs, impact, verify, expand <target>, clear");
      },
    });

    pi.registerTool({
      name: "bioarc_context",
      label: "Bioarc Context",
      description: "Return the active Bioarc target documentation, dependency impact, and validation plan.",
      parameters: pi.zod.object({}),
      async execute() {
        const state = [...states.values()][0];
        if (!state?.target) return { content: [{ type: "text", text: "No Bioarc target selected." }] };
        return { content: [{ type: "text", text: targetDoc(state) }], details: { target: state.target.name } };
      },
    });
  };
}

export default function bioarcExtension(pi) {
  return createBioarcExtension()(pi);
}
