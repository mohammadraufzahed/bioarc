import { registerBioarcExtension, type OmpPluginApi } from "./adapter.ts";

export type { BioarcState, CommandDefinition, PackageManifest, ParsedCommand, SessionContextLike, Target, TargetKind, TargetResolution, Workspace } from "./types.ts";
export {
  CANONICAL_WORKSPACE_ROOT,
  TARGET_ROOTS,
  dependencyClosure,
  discoverTargets,
  findWorkspaceRoot,
  formatResolution,
  isCanonicalWorkspacePath,
  loadWorkspace,
  resolveTarget,
  resolveTargetDetailed,
  reverseConsumers,
  validationPlan,
} from "./workspace.ts";
export {
  commandGuardReason,
  isWriteAllowed,
  normalizeToolPath,
  parseEditPaths,
  pathIsWithin,
  relativePath,
  ROOT_SAFE_FILES,
} from "./policy.ts";
export {
  COMMAND_CATALOG,
  completeBioarc,
  completeCommands,
  completeTargets,
  formatCommandHelp,
  parseBioarcCommand,
  parseCommand,
} from "./commands.ts";
export { StateStore, sessionKey } from "./state.ts";
export { formatTargets, gitStatus, readText, standardsText, targetDoc } from "./context.ts";
export { registerBioarcExtension } from "./adapter.ts";

export function createBioarcExtension(): (pi: OmpPluginApi) => void {
  return (pi) => registerBioarcExtension(pi);
}

export default function bioarcExtension(pi: OmpPluginApi): void {
  registerBioarcExtension(pi);
}
