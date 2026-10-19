# Bioarc OMP plugin

Bioarc is a repository-aware OMP extension for Turborepo workspaces. It helps the developer select one app or package, gives the agent focused context, and blocks writes outside the active target.

## Install locally

```sh
git clone https://github.com/mohammadraufzahed/bioarc.git
cd bioarc
omp plugin link .
```

Restart OMP after linking. To load it for one session instead:

```sh
omp --extension ./src/index.mjs
```

## Use

```text
/bioarc targets
/bioarc select @bioarc/table
/bioarc status
/bioarc docs
/bioarc impact
/bioarc verify
/bioarc expand apps/repo-client
/bioarc clear
```

A target must be selected before the extension permits `write` or `edit` tool calls. The selected target is writable; internal dependencies and consumers are readable context. Root manifests and lockfiles are allowed for dependency work. Other apps and packages are blocked.

Bioarc also checks bash commands for explicit writes to another app/package and injects target-specific rules before each agent turn.

## What it discovers

- `apps/*` and `packages/*` manifests
- package names, versions, descriptions, scripts, exports, and dependencies
- internal dependency closure and reverse consumers
- `README.md`, `AGENTS.md`, and optional `bioarc.yaml` guidance
- target-specific validation commands

## Default metadata

Bioarc ships baseline YAML metadata for every app and package in the Bioarc modules monorepo under `defaults/apps/` and `defaults/packages/`. The plugin reads these files without editing the consuming repository. A consuming target may add its own `bioarc.yaml` beside `package.json` to add local guidance.

## Design boundary

Bioarc is an in-process OMP extension. Its write/edit guard is deterministic, but shell parsing remains intentionally conservative and is not a replacement for OS sandboxing, branch protection, or CI. Use explicit `/bioarc expand ...` when a change must cross a target boundary.
