# Bioarc ⚡

### Give your AI one target. Not the whole monorepo.

AI coding agents are fast. They are also very confident when they touch the wrong app, add a library you already had, or “clean up” a package nobody asked about.

**Bioarc is the safety layer for OMP + Turborepo.** Pick the app or package you are working on, and Bioarc gives the agent the right context, rules, dependency map, and validation plan. Try to edit something unrelated? Blocked.

## Why use it?

Bioarc makes the good path the easy path:

- select one app or package before editing;
- get docs, scripts, dependencies, consumers, and repository rules automatically;
- prefer existing `@bioarc/*` packages before adding another dependency;
- keep new third-party dependencies rare and explainable;
- get package-specific standards when building shared packages;
- stop AI changes from leaking into other apps or packages;
- expand the scope only when you explicitly mean to.

Think of it as a focused workspace mode for your AI. Less “what if I rewrite the monorepo?” More “I am fixing this one thing.”

## Install

You need [OMP](https://github.com/oh-my-pi/oh-my-pi), Node.js, and the BioArc modules monorepo at:

`/home/heaton/Workspace/BioArc/modules-monorepo`

Bioarc intentionally activates **only** when OMP is started from that canonical workspace. It does not register commands, completion, prompts, or write guards in other directories.

```sh
git clone https://github.com/mohammadraufzahed/bioarc.git
cd bioarc
npm install
npm run build
omp plugin link .
```

The package manifest points OMP at the native TypeScript entrypoint in `src/index.ts`; OMP loads this file directly. `npm run build` also emits JavaScript and declarations in `dist/` for Node tooling and distribution. Restart OMP after linking. To load Bioarc for one session without linking:

```sh
omp --extension ./src/index.ts
```


## Start a session

Run OMP from the canonical workspace (the plugin is inactive elsewhere):

```sh
cd /home/heaton/Workspace/BioArc/modules-monorepo
omp
```

The command's completion is context-aware:

- `/bioarc ` suggests and ranks `targets`, `select`, `status`, `docs`, `impact`, `standards`, `verify`, `expand`, and `clear`;
- `/bioarc select ` and `/bioarc expand ` suggest discovered app and package names, folder paths, and package basenames;
- completion results are ranked by exact matches, prefixes, and then substring matches.

Then choose your target:

```text
/bioarc targets
/bioarc select @bioarc/table
```

Now inspect the target:

```text
/bioarc status
/bioarc docs
/bioarc impact
/bioarc standards
/bioarc verify
```

Example target policy:

```text
Target: @bioarc/table
Writable: packages/table
Readable: its internal dependency chain
Blocked: every unrelated app/package
Validation: build, type checks, and tests
```

Need a real cross-package change?

```text
/bioarc expand @bioarc/form
```

That expansion is explicit. Bioarc never silently decides that another package is fair game.

## Dependency rules

Bioarc nudges the agent through this order:

1. existing code and platform APIs;
2. existing `@bioarc/*` packages;
3. existing workspace dependencies;
4. a new third-party dependency, only when the first three do not work.

Before adding a dependency, the agent should check the Bioarc package catalog and explain why an existing option is not enough. Fewer dependencies means less bundle weight, fewer upgrades, and fewer “why are there three libraries doing the same thing?” moments.

## Package standards

When the selected target is a shared package, Bioarc also reminds the agent to:

- keep the public API small and intentional;
- export public types and entrypoints deliberately;
- keep runtime dependencies minimal;
- never import application code into a package;
- avoid circular workspace dependencies;
- preserve existing exports and types unless a breaking change is intended;
- add regression tests for public behavior;
- run build, lint, type checks, and tests when available;
- update package docs when the public API changes.

App work gets its own rules: use Bioarc public APIs instead of rebuilding them locally, keep app-specific behavior in the app, and validate affected workspace dependencies.

## What ships with Bioarc?

The plugin includes default YAML metadata for the Bioarc modules monorepo:

- 11 apps;
- 15 packages;
- dependency-priority rules;
- app-development standards;
- package-development standards.

The defaults live inside the plugin under `defaults/`. A consuming target can add a local `bioarc.yaml` next to its `package.json` for extra guidance. Bioarc reads that file; it does not create or modify files in your apps or packages.

## Commands

```text
/bioarc targets                    # list apps and packages
/bioarc select <target>            # start scoped work
/bioarc status                     # show scope and dirty baseline
/bioarc docs                       # show target documentation
/bioarc impact                     # show dependencies and consumers
/bioarc standards                  # show dependency/app/package rules
/bioarc verify                     # show the target validation plan
/bioarc expand <target>            # intentionally widen write scope
/bioarc clear                      # remove the active target
```

## The honest limitation

Bioarc is an in-process OMP extension, not a magical OS sandbox. Its `write` and `edit` checks are deterministic, and its shell checks are conservative, but CI, branch protection, and operating-system permissions are still the final authority.

## Contributing

```sh
git clone https://github.com/mohammadraufzahed/bioarc.git
cd bioarc
npm install
npm run build
npm test
```

`npm test` builds the TypeScript sources before running the Node test suite. The tests also import the native `src/index.ts` API used by OMP, covering both workspace helpers and completion behavior.

Ideas, fixes, and better workspace standards are welcome. Make the AI less chaotic for the next person too.
