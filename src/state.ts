import type { BioarcState, SessionContextLike } from "./types.ts";

export function sessionKey(ctx: SessionContextLike): string {
  const sessionId = ctx.sessionManager?.getSessionId?.() ?? "default";
  return `${ctx.cwd}:${sessionId}`;
}

export class StateStore {
  private readonly states = new Map<string, BioarcState>();

  get(ctx: SessionContextLike): BioarcState {
    const key = sessionKey(ctx);
    const existing = this.states.get(key);
    if (existing) return existing;
    const state: BioarcState = {
      key,
      cwd: ctx.cwd,
      root: null,
      targets: [],
      target: null,
      expanded: new Set<string>(),
      baseline: "not captured",
    };
    this.states.set(key, state);
    return state;
  }

  delete(ctx: SessionContextLike): void {
    this.states.delete(sessionKey(ctx));
  }

  clear(): void {
    this.states.clear();
  }

  current(): BioarcState | undefined {
    return [...this.states.values()].at(-1);
  }
}
