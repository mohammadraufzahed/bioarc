import path from "node:path";
import type { CommandDefinition, ParsedCommand, Target } from "./types.ts";

export const COMMAND_CATALOG: readonly CommandDefinition[] = [
  { name: "targets", description: "list apps and packages" },
  { name: "select", description: "start scoped work", acceptsTarget: true },
  { name: "status", description: "show scope and dirty baseline", requiresTarget: true },
  { name: "docs", description: "show target documentation", requiresTarget: true },
  { name: "impact", description: "show dependencies and consumers", requiresTarget: true },
  { name: "standards", description: "show dependency and package rules" },
  { name: "verify", description: "show the target validation plan", requiresTarget: true },
  { name: "expand", description: "intentionally widen write scope", acceptsTarget: true, requiresTarget: true },
  { name: "clear", description: "remove the active target" },
  { name: "help", description: "show available commands" },
] as const;

const COMMAND_NAMES = COMMAND_CATALOG.map((command) => command.name);
const TARGET_COMMANDS = new Set(["select", "expand"]);

export function parseBioarcCommand(input: string): ParsedCommand {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const [command = "help", ...args] = tokens;
  return { command, args, query: args.join(" ") };
}

export const parseCommand = parseBioarcCommand;

function targetSearchValues(target: Target): string[] {
  return [target.name, target.folder, path.basename(target.folder)];
}

/** Complete target names with exact, prefix, then substring matches in stable order. */
export function completeTargets(prefix: string, targets: Target[]): string[] {
  const query = prefix.trim().toLocaleLowerCase();
  const ranked = [...targets]
    .map((target) => {
      const values = targetSearchValues(target).map((value) => value.toLocaleLowerCase());
      const rank = !query ? 2 : values.some((value) => value === query) ? 0 : values.some((value) => value.startsWith(query)) ? 1 : values.some((value) => value.includes(query)) ? 2 : -1;
      return { target, rank };
    })
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.target.name.localeCompare(b.target.name) || a.target.folder.localeCompare(b.target.folder));
  return ranked.map((entry) => entry.target.name);
}

/** Complete command names or target arguments from a partial `/bioarc` argument string. */
export function completeBioarc(input: string, targets: Target[]): string[] {
  const trailingWhitespace = /\s$/.test(input);
  const trimmed = input.trim();
  const firstSpace = trimmed.search(/\s/);
  if (firstSpace < 0 && !trailingWhitespace) {
    const prefix = trimmed.toLocaleLowerCase();
    return COMMAND_NAMES.filter((name) => name.startsWith(prefix));
  }
  const parsed = parseBioarcCommand(trimmed);
  if (!TARGET_COMMANDS.has(parsed.command)) return [];
  const argument = trimmed.slice(parsed.command.length).trimStart();
  return completeTargets(trailingWhitespace ? "" : argument, targets);
}


export const completeCommands = completeBioarc;

export function formatCommandHelp(): string {
  return COMMAND_CATALOG.map((command) => `/bioarc ${command.name}${command.acceptsTarget ? " <target>" : ""}  # ${command.description}`).join("\n");
}
