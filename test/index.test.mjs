import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_WORKSPACE_ROOT,
  COMMAND_CATALOG,
  commandGuardReason,
  completeBioarc,
  completeTargets,
  dependencyClosure,
  discoverTargets,
  findWorkspaceRoot,
  isWriteAllowed,
  normalizeToolPath,
  parseBioarcCommand,
  parseEditPaths,
  resolveTarget,
  resolveTargetDetailed,
  reverseConsumers,
  validationPlan,
} from "../src/index.ts";

function fixtureWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bioarc-test-"));
  fs.writeFileSync(path.join(root, "turbo.json"), "{}\n");
  fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n  - packages/*\n");
  const manifests = {
    "apps/table-viewer": {
      name: "table-viewer",
      scripts: { validate: "pnpm lint && pnpm test" },
      dependencies: { "@bioarc/table": "workspace:*" },
    },
    "apps/table": { name: "table", dependencies: { "@bioarc/core": "workspace:*" } },
    "packages/core": { name: "@bioarc/core" },
    "packages/table": {
      name: "@bioarc/table",
      scripts: { "check-types": "tsc", "test:run": "node --test" },
      dependencies: { "@bioarc/core": "workspace:*" },
    },
  };
  for (const [folder, manifest] of Object.entries(manifests)) {
    const target = path.join(root, folder);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "package.json"), `${JSON.stringify(manifest)}\n`);
  }
  return root;
}

const root = fixtureWorkspace();
const targets = discoverTargets(root);

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test("finds only the canonical workspace root", () => {
  assert.equal(findWorkspaceRoot(path.join(root, "apps/table-viewer")), null);
  assert.equal(
    findWorkspaceRoot(path.join(CANONICAL_WORKSPACE_ROOT, "apps")),
    fs.existsSync(path.join(CANONICAL_WORKSPACE_ROOT, "turbo.json"))
      && fs.existsSync(path.join(CANONICAL_WORKSPACE_ROOT, "pnpm-workspace.yaml"))
      ? CANONICAL_WORKSPACE_ROOT
      : null,
  );
  assert.equal(findWorkspaceRoot(path.join(root, "apps/table-viewer"), root), root);
});

test("discovers targets from app and package manifests", () => {
  assert.deepEqual(
    targets.map((target) => target.folder),
    ["apps/table", "apps/table-viewer", "packages/core", "packages/table"],
  );
  assert.equal(resolveTarget(targets, "packages/table")?.name, "@bioarc/table");
  assert.equal(resolveTarget(targets, "@bioarc/core")?.folder, "packages/core");
});

test("reports ambiguous basename resolution instead of guessing", () => {
  const resolution = resolveTargetDetailed(targets, "table");
  assert.equal(resolution.status, "ambiguous");
  assert.deepEqual(resolution.candidates.map((target) => target.folder), ["apps/table", "packages/table"]);
  assert.equal(resolveTarget(targets, "table"), null);
});

test("calculates dependency closure and reverse consumers", () => {
  const table = resolveTarget(targets, "@bioarc/table");
  assert.ok(table);
  assert.deepEqual([...dependencyClosure(table, targets)], ["@bioarc/table", "@bioarc/core"]);
  assert.deepEqual(reverseConsumers(table, targets).map((target) => target.name), ["table-viewer"]);
});

test("parses command input and ranks command completion", () => {
  assert.deepEqual(parseBioarcCommand("  select   @bioarc/table  "), {
    command: "select",
    args: ["@bioarc/table"],
    query: "@bioarc/table",
  });
  assert.deepEqual(parseBioarcCommand(""), { command: "help", args: [], query: "" });
  assert.deepEqual(completeBioarc("st", targets), ["status", "standards"]);
  assert.deepEqual(completeBioarc("select @bioarc/t", targets), ["@bioarc/table"]);
  assert.deepEqual(completeBioarc("docs", targets), ["docs"]);
  assert.deepEqual(COMMAND_CATALOG.map((command) => command.name).slice(0, 3), ["targets", "select", "status"]);
});

test("completes target names from names, folder paths, and basenames", () => {
  assert.deepEqual(completeTargets("", targets), ["@bioarc/core", "@bioarc/table", "table", "table-viewer"]);
  assert.deepEqual(completeTargets("packages/t", targets), ["@bioarc/table"]);
  assert.deepEqual(completeTargets("table", targets), ["@bioarc/table", "table", "table-viewer"]);
  assert.deepEqual(completeBioarc("expand packages/t", targets), ["@bioarc/table"]);
});

test("preserves edit path parsing and write guards", () => {
  assert.deepEqual(
    parseEditPaths("[packages/table/src/index.ts#AB12]\nPUT 1.=1:\n+ok\nMV 'apps/table/src/a.ts'"),
    ["packages/table/src/index.ts", "apps/table/src/a.ts"],
  );
  const table = resolveTarget(targets, "@bioarc/table");
  assert.ok(table);
  assert.equal(isWriteAllowed(root, table, path.join(root, "packages/table/src/index.ts")), true);
  assert.equal(isWriteAllowed(root, table, path.join(root, "apps/table/src/index.ts")), false);
  assert.equal(isWriteAllowed(root, table, path.join(root, "apps/table/src/index.ts"), new Set(["apps/table"])), true);
  assert.equal(normalizeToolPath(root, root, "[packages/table/src/index.ts#AB12]"), path.join(root, "packages/table/src/index.ts"));
  assert.match(commandGuardReason(root, "rm -rf apps/table", table) ?? "", /outside the active target/);
});

test("retains validation plan behavior", () => {
  const app = resolveTarget(targets, "table-viewer");
  const table = resolveTarget(targets, "@bioarc/table");
  assert.ok(app);
  assert.ok(table);
  assert.deepEqual(validationPlan(app), ["pnpm --filter table-viewer run validate"]);
  assert.deepEqual(validationPlan(table), ["pnpm turbo run build check-types test:run --filter=@bioarc/table..."]);
});

test("ships default metadata for canonical targets when the workspace is available", () => {
  if (!fs.existsSync(CANONICAL_WORKSPACE_ROOT)) return;
  for (const target of discoverTargets(CANONICAL_WORKSPACE_ROOT)) {
    const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const file = path.join(pluginRoot, "defaults", `${target.kind}s`, `${path.basename(target.folder)}.yaml`);
    assert.equal(fs.existsSync(file), true, `missing default metadata: ${file}`);
  }
});
