import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  dependencyClosure,
  discoverTargets,
  findWorkspaceRoot,
  isWriteAllowed,
  parseEditPaths,
  resolveTarget,
} from "../src/index.mjs";

const root = "/home/heaton/Workspace/BioArc/modules-monorepo";

test("finds the Turborepo root", () => {
  assert.equal(findWorkspaceRoot(`${root}/apps/employee-health-client/src`), root);
});

test("discovers apps and packages from manifests", () => {
  const targets = discoverTargets(root);
  assert.ok(targets.some((target) => target.name === "repo-client"));
  assert.ok(targets.some((target) => target.name === "@bioarc/table"));
  assert.equal(resolveTarget(targets, "packages/table")?.name, "@bioarc/table");
});

test("calculates internal dependency closure", () => {
  const targets = discoverTargets(root);
  const table = resolveTarget(targets, "@bioarc/table");
  const closure = dependencyClosure(table, targets);
  assert.ok(closure.has("@bioarc/table"));
  assert.ok(closure.size >= 1);
});

test("parses edit paths and protects unrelated targets", () => {
  assert.deepEqual(parseEditPaths("[packages/table/src/index.ts#AB12]\nPUT 1.=1:\n+ok"), ["packages/table/src/index.ts"]);
  const targets = discoverTargets(root);
  const table = resolveTarget(targets, "@bioarc/table");
  assert.equal(isWriteAllowed(root, table, `${root}/packages/table/src/index.ts`), true);
  assert.equal(isWriteAllowed(root, table, `${root}/apps/repo-client/src/index.ts`), false);
});

test("ships default metadata for every discovered target", () => {
  const targets = discoverTargets(root);
  const defaultsRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "defaults");
  for (const target of targets) {
    const file = path.join(defaultsRoot, `${target.kind}s`, `${path.basename(target.folder)}.yaml`);
    assert.equal(fs.existsSync(file), true, `missing default metadata: ${file}`);
  }
});
