#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toNativeAbsolutePath } from "../scripts/path-interop.mjs";

const scripts = fileURLToPath(new URL("../scripts/", import.meta.url));
const root = mkdtempSync(path.join(tmpdir(), "deep-review-large-test."));
const cap = 16 * 1024 * 1024;
const unchangedCap = 2 * 1024 * 1024;
let snapshot;
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", maxBuffer: 70 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
function jsonBytes(size, value) {
  const first = Buffer.from(JSON.stringify({ value }) + "\n");
  const padding = Buffer.alloc(size - first.length, 32);
  for (let i = 1023; i < padding.length; i += 1024) padding[i] = 10;
  return Buffer.concat([first, padding]);
}
function removeReadonly(target) {
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const item = path.join(target, entry.name);
    if (entry.isDirectory()) removeReadonly(item);
    else chmodSync(item, 0o600);
  }
  rmSync(target, { recursive: true, force: true });
}
try {
  run("git", ["init", "--quiet"]);
  run("git", ["config", "user.name", "Review fixture"]);
  run("git", ["config", "user.email", "fixture@example.invalid"]);
  writeFileSync(path.join(root, "changed.json"), jsonBytes(cap, "before"));
  writeFileSync(path.join(root, "unchanged.json"), jsonBytes(unchangedCap + 1, "unchanged"));
  writeFileSync(path.join(root, "credentials.json"), jsonBytes(unchangedCap + 1, "unchanged fixture only"));
  writeFileSync(path.join(root, ".gitattributes"), "*.json -diff\n");
  run("git", ["add", "."]);
  run("git", ["-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "base"]);
  const base = run("git", ["rev-parse", "HEAD"]).trim();
  const changed = jsonBytes(cap, "after");
  const added = jsonBytes(unchangedCap + 1, "added");
  writeFileSync(path.join(root, "changed.json"), changed);
  writeFileSync(path.join(root, "added.json"), added);
  writeFileSync(path.join(root, "too-large.json"), jsonBytes(cap + 1, "omitted"));
  const binary = Buffer.alloc(unchangedCap + 1, 0);
  writeFileSync(path.join(root, "binary.json"), binary);
  run("git", ["add", "."]);
  run("git", ["-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "head"]);
  const head = run("git", ["rev-parse", "HEAD"]).trim();
  const args = ["--base-sha", base, "--head-sha", head];
  const diff = run(process.execPath, [path.join(scripts, "build-review-diff.mjs"), ...args]);
  assert.match(diff, /-\{"value":"before"\}/);
  assert.match(diff, /\+\{"value":"after"\}/);
  assert.match(diff, /\+\{"value":"added"\}/);
  assert.match(diff, /Binary files .*too-large\.json differ/);
  assert.match(diff, /Binary files .*binary\.json differ/);
  assert.ok(!diff.includes('"value":"omitted"'));
  snapshot = toNativeAbsolutePath(run(process.execPath, [path.join(scripts, "build-review-snapshot.mjs"), ...args, "--related", "unchanged.json"]).trim());
  const metadata = JSON.parse(readFileSync(snapshot + ".metadata.json", "utf8"));
  for (const [name, expected] of [["changed.json", changed], ["added.json", added], ["binary.json", binary]]) {
    assert.deepEqual(readFileSync(path.join(snapshot, name)), expected);
    const item = metadata.manifest.find(entry => entry.path === name);
    assert.equal(item.kind, "blob");
    assert.equal(item.size, expected.length);
    assert.equal(item.sha256, createHash("sha256").update(expected).digest("hex"));
    if (process.platform !== "win32") assert.equal(statSync(path.join(snapshot, name)).mode & 0o777, 0o400);
  }
  for (const name of ["too-large.json", "unchanged.json"]) {
    const marker = readFileSync(path.join(snapshot, name), "utf8");
    assert.match(marker, /^REVIEW_BLOB_OMITTED:/);
    assert.match(marker, /reason=individual-byte-limit/);
    assert.equal(metadata.manifest.find(entry => entry.path === name).kind, "omitted-blob");
  }
  assert.ok(!metadata.manifest.some(entry => entry.path === "credentials.json"));
  process.stdout.write("PASS: bounded large changed blobs retain safe diff, exact bytes, hashes, readonly state, binary handling and unchanged-file protections\n");
} finally {
  if (snapshot) {
    removeReadonly(snapshot);
    chmodSync(snapshot + ".metadata.json", 0o600);
    rmSync(snapshot + ".metadata.json");
  }
  removeReadonly(root);
}
