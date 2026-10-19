export type TargetKind = "app" | "package";

export interface PackageManifest {
  name: string;
  version?: string;
  private?: boolean;
  description?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  [key: string]: unknown;
}

export interface Target {
  name: string;
  folder: string;
  kind: TargetKind;
  path: string;
  manifest: PackageManifest;
}

export interface Workspace {
  root: string;
  targets: Target[];
}

export interface BioarcState {
  key: string;
  cwd: string;
  root: string | null;
  targets: Target[];
  target: Target | null;
  expanded: Set<string>;
  baseline: string;
}

export type BioarcCommandName =
  | "targets"
  | "select"
  | "status"
  | "docs"
  | "impact"
  | "standards"
  | "verify"
  | "expand"
  | "clear"
  | "help";

export interface ParsedCommand {
  command: BioarcCommandName | string;
  args: string[];
  query: string;
}

export interface CommandDefinition {
  name: BioarcCommandName;
  description: string;
  requiresTarget?: boolean;
  acceptsTarget?: boolean;
}

export interface TargetResolution {
  status: "match" | "missing" | "ambiguous";
  target?: Target;
  candidates: Target[];
}

export interface SessionContextLike {
  cwd: string;
  sessionManager?: { getSessionId?: () => string };
  ui?: { notify: (text: string, level?: string) => void };
  [key: string]: unknown;
}
