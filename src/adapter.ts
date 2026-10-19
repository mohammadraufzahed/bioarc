import path from "node:path";
import type { BioarcState, SessionContextLike } from "./types.ts";
import { COMMAND_CATALOG, completeBioarc, formatCommandHelp, parseBioarcCommand } from "./commands.ts";
import { commandGuardReason, isWriteAllowed, normalizeToolPath, parseEditPaths, relativePath } from "./policy.ts";
import { formatTargets, gitStatus, standardsText, targetDoc } from "./context.ts";
import { StateStore } from "./state.ts";
import {
  CANONICAL_WORKSPACE_ROOT,
  dependencyClosure,
  discoverTargets,
  findWorkspaceRoot,
  formatResolution,
  resolveTargetDetailed,
  reverseConsumers,
  validationPlan,
} from "./workspace.ts";

interface ToolCallEvent {
  toolName: string;
  input?: Record<string, unknown>;
}

interface AutocompleteItem {
  value: string;
  label?: string;
  description?: string;
}

interface CommandConfig {
  description: string;
  handler: (args: string, ctx: SessionContextLike) => Promise<void> | void;
  getArgumentCompletions?: (argumentPrefix: string) => AutocompleteItem[];
}

interface ToolConfig {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (
    toolCallId: string,
    parameters: unknown,
    signal: AbortSignal,
    onUpdate: (update: unknown) => void,
    ctx: SessionContextLike,
  ) => Promise<unknown>;
}

export interface OmpPluginApi {
  setLabel(label: string): void;
  on(event: string, handler: (event: unknown, ctx: SessionContextLike) => unknown): void;
  registerCommand(name: string, config: CommandConfig): void;
  registerTool(config: ToolConfig): void;
  zod: { object(shape: Record<string, unknown>): unknown };
}

function isActiveContext(ctx: SessionContextLike): boolean {
  const root = findWorkspaceRoot(ctx.cwd);
  return root === path.resolve(CANONICAL_WORKSPACE_ROOT);
}

function notify(ctx: SessionContextLike, text: string, level = "info"): void {
  if (!ctx.ui) return;
  const output = text.length > 6000 ? `${text.slice(0, 6000)}\n…` : text;
  ctx.ui.notify(output, level);
}

function setupState(state: BioarcState): string | null {
  state.root = findWorkspaceRoot(state.cwd);
  if (!state.root) return "Bioarc is only active from the canonical modules monorepo workspace.";
  state.targets = discoverTargets(state.root);
  return null;
}

function targetRequired(command: string): boolean {
  return ["docs", "impact", "verify", "expand", "status"].includes(command);
}

async function handleCommand(rawArgs: string, ctx: SessionContextLike, states: StateStore): Promise<void> {
  if (!isActiveContext(ctx)) return;
  const state = states.get(ctx);
  const error = setupState(state);
  if (error) {
    notify(ctx, error, "warning");
    return;
  }
  const parsed = parseBioarcCommand(rawArgs);
  const { command, query } = parsed;
  if (command === "targets") {
    notify(ctx, formatTargets(state.targets));
    return;
  }
  if (command === "select") {
    const resolution = resolveTargetDetailed(state.targets, query);
    if (!resolution.target) {
      notify(ctx, `${formatResolution(query, resolution)}\n\n${formatTargets(state.targets)}`, "warning");
      return;
    }
    state.target = resolution.target;
    state.expanded = new Set<string>();
    state.baseline = gitStatus(state.root!);
    notify(ctx, `Bioarc target selected: ${state.target.name}\nWritable: ${state.target.folder}\nUse /bioarc docs or /bioarc verify for details.`);
    return;
  }
  if (command === "clear") {
    state.target = null;
    state.expanded = new Set<string>();
    notify(ctx, "Bioarc target cleared. File writes are blocked until a target is selected.");
    return;
  }
  if (!state.target && targetRequired(command)) {
    notify(ctx, "Select a target first with /bioarc select <app-or-package>.", "warning");
    return;
  }
  if (command === "standards") {
    notify(ctx, standardsText());
    return;
  }
  if (command === "docs") {
    notify(ctx, targetDoc(state));
    return;
  }
  if (command === "impact") {
    const dependencies = [...dependencyClosure(state.target, state.targets)].join("\n- ");
    const consumers = reverseConsumers(state.target, state.targets).map((item) => item.name).join("\n- ") || "none discovered";
    notify(ctx, `Target: ${state.target!.name}\n\nInternal dependency closure:\n- ${dependencies || "none"}\n\nAffected consumers:\n- ${consumers}`);
    return;
  }
  if (command === "status") {
    notify(ctx, `Target: ${state.target?.name ?? "none"}\nRoot: ${state.root}\nBaseline: ${state.baseline}\nCurrent git status:\n${gitStatus(state.root!)}\nExpanded writes: ${[...state.expanded].join(", ") || "none"}`);
    return;
  }
  if (command === "expand") {
    const resolution = resolveTargetDetailed(state.targets, query);
    if (!resolution.target) {
      notify(ctx, formatResolution(query, resolution), "warning");
      return;
    }
    state.expanded.add(resolution.target.folder);
    notify(ctx, `Bioarc write scope expanded to ${resolution.target.name} (${resolution.target.folder}).`);
    return;
  }
  if (command === "verify") {
    notify(ctx, `Validation plan for ${state.target!.name}:\n- ${validationPlan(state.target!).join("\n- ")}`);
    return;
  }
  notify(ctx, formatCommandHelp());
}

function handleToolCall(event: ToolCallEvent, ctx: SessionContextLike, states: StateStore): { block: true; reason: string } | undefined {
  if (!isActiveContext(ctx)) return undefined;
  if (!["write", "edit", "bash"].includes(event.toolName)) return undefined;
  const state = states.get(ctx);
  if (!state.root) setupState(state);
  if (!state.root) return { block: true, reason: "Bioarc cannot identify the canonical workspace root." };
  const input = event.input ?? {};
  if (event.toolName === "bash") {
    const reason = commandGuardReason(state.root, String(input.command ?? ""), state.target, state.expanded);
    if (reason) return { block: true, reason: `Bioarc blocked this bash command: ${reason}.` };
    return undefined;
  }
  const rawPaths = event.toolName === "write" ? [input.path] : parseEditPaths(input.input);
  const activeTarget = state.target;
  if (!activeTarget) return { block: true, reason: "Bioarc requires a selected target before file changes. Use /bioarc select <app-or-package>." };
  const paths = rawPaths.map((value) => normalizeToolPath(state.root!, ctx.cwd, value)).filter((value): value is string => value !== null);
  const denied = paths.find((candidate) => !isWriteAllowed(state.root!, activeTarget, candidate, state.expanded));
  if (denied) {
    return { block: true, reason: `Bioarc blocked ${relativePath(state.root!, denied)}. Active target is ${activeTarget.name}; use /bioarc expand <target> for an intentional cross-target change.` };
  }
  return undefined;
}

function registerRuntimeHandlers(pi: OmpPluginApi, states: StateStore, sessionKey: string, onShutdown: () => void): void {
  pi.on("session_shutdown", (_event, ctx) => {
    const key = `${ctx.cwd}:${ctx.sessionManager?.getSessionId?.() ?? "default"}`;
    if (key !== sessionKey) return;
    states.delete(ctx);
    onShutdown();
  });
  pi.on("before_agent_start", (_event, ctx) => {
    const key = `${ctx.cwd}:${ctx.sessionManager?.getSessionId?.() ?? "default"}`;
    if (!isActiveContext(ctx) || key !== sessionKey) return undefined;
    const state = states.get(ctx);
    if (!state.root) setupState(state);
    if (!state.target) {
      return { systemPrompt: "Bioarc is active. No target is selected. You may inspect the workspace, but do not modify files. Ask the developer to use /bioarc select <target> before editing." };
    }
    const closure = [...dependencyClosure(state.target, state.targets)];
    return {
      systemPrompt: [
        "Bioarc target policy:",
        `- Active target: ${state.target.name} (${state.target.kind}) at ${state.target.folder}`,
        `- Writable folder: ${state.target.folder}`,
        `- Readable internal dependency closure: ${closure.join(", ") || "none"}`,
        `- Explicitly expanded writable folders: ${[...state.expanded].join(", ") || "none"}`,
        "- Do not modify another app/package without /bioarc expand <target>.",
        "- Prefer existing code and APIs, then @bioarc packages, then existing workspace dependencies; add third-party dependencies only when necessary.",
        "- Before adding a dependency, inspect the Bioarc package catalog and current workspace dependencies. Explain why no existing option works.",
        state.target.kind === "package"
          ? "- Package standards: keep the public API small and explicit; do not import apps; keep runtime dependencies minimal; avoid cycles; test public behavior; preserve exports and types."
          : "- App standards: prefer Bioarc public APIs over local duplicates; keep app-specific behavior in the app; validate the selected app and affected workspace dependencies.",
        "- Use the repository's existing package scripts and filtered Turborepo commands.",
        `- Required validation: ${validationPlan(state.target).join("; ")}`,
        standardsText() ? "- Full standards file is bundled with this plugin." : "",
      ].filter(Boolean).join("\n"),
    };
  });
  pi.on("tool_call", (event, ctx) => {
    const key = `${ctx.cwd}:${ctx.sessionManager?.getSessionId?.() ?? "default"}`;
    if (!isActiveContext(ctx) || key !== sessionKey) return undefined;
    return handleToolCall(event as ToolCallEvent, ctx, states);
  });
}

function completionItems(argumentPrefix: string, state: BioarcState): AutocompleteItem[] {
  const values = completeBioarc(argumentPrefix, state.targets);
  const firstToken = argumentPrefix.trim().split(/\s+/)[0] ?? "";
  const command = COMMAND_CATALOG.find((item) => item.name === firstToken);
  if (command?.acceptsTarget && /\s/.test(argumentPrefix)) {
    return values.flatMap((value) => {
      const target = state.targets.find((item) => item.name === value);
      return target
        ? [{ value, label: value, description: `${target.kind} · ${target.folder}` }]
        : [];
    });
  }
  return values.map((value) => {
    const definition = COMMAND_CATALOG.find((item) => item.name === value);
    return { value, label: value, description: definition?.description };
  });
}

function registerRuntimeCommandAndTool(pi: OmpPluginApi, state: BioarcState, states: StateStore): void {
  pi.registerCommand("bioarc", {
    description: "Select a Bioarc app/package and inspect its repository policy",
    getArgumentCompletions: (argumentPrefix) => completionItems(argumentPrefix, state),
    handler: (args, ctx) => handleCommand(args, ctx, states),
  });
  pi.registerTool({
    name: "bioarc_context",
    label: "Bioarc Context",
    description: "Return the active Bioarc target documentation, dependency impact, and validation plan.",
    parameters: pi.zod.object({}),
    async execute(_toolCallId, _parameters, _signal, _onUpdate, ctx) {
      if (!isActiveContext(ctx)) return { content: [{ type: "text", text: "Bioarc is inactive outside the canonical workspace." }] };
      const currentState = states.get(ctx);
      if (!currentState.target) return { content: [{ type: "text", text: "No Bioarc target selected." }] };
      return { content: [{ type: "text", text: targetDoc(currentState) }], details: { target: currentState.target.name } };
    },
  });
}

export function registerBioarcExtension(pi: OmpPluginApi): void {
  const states = new StateStore();
  const registered = new Set<string>();
  pi.on("session_start", (_event, ctx) => {
    if (!isActiveContext(ctx)) return;
    const state = states.get(ctx);
    const error = setupState(state);
    if (error) {
      notify(ctx, error, "warning");
      return;
    }
    pi.setLabel("Bioarc");
    state.baseline = gitStatus(state.root!);
    notify(ctx, "Bioarc ready. Select a target with /bioarc select <app-or-package>.", "info");
    if (registered.has(state.key)) return;
    registered.add(state.key);
    registerRuntimeHandlers(pi, states, state.key, () => registered.delete(state.key));
    registerRuntimeCommandAndTool(pi, state, states);
  });
}


