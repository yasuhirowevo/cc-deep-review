import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repo = fileURLToPath(new URL('../', import.meta.url));
const installer = path.join(repo, 'scripts', 'install.mjs');
function run(home, ...args) {
  return spawnSync(process.execPath, [installer, '--home', home, ...args], { encoding: 'utf8' });
}

test('fresh install, guarded replacement, config preservation and backups', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-review-install-'));
  try {
    const first = run(home, '--target', 'both');
    assert.equal(first.status, 0, first.stderr);
    const installed = path.join(home, '.agents/skills/cc-deep-review');
    assert.equal(fs.readFileSync(path.join(installed, 'SKILL.md'), 'utf8'), fs.readFileSync(path.join(repo, 'skills/cc-deep-review/SKILL.md'), 'utf8'));
    assert.ok(fs.existsSync(path.join(home, '.claude/skills/cc-deep-review/SKILL.md')));
    const config = path.join(home, '.config/cc-deep-review/reviewer.env');
    fs.writeFileSync(config, '# user configuration\n');
    fs.writeFileSync(path.join(installed, 'local-note.txt'), 'keep this local edit');
    const refused = run(home, '--target', 'both');
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /Already installed/);
    assert.ok(fs.existsSync(path.join(installed, 'local-note.txt')));
    const replaced = run(home, '--target', 'both', '--replace');
    assert.equal(replaced.status, 0, replaced.stderr);
    assert.equal(fs.readFileSync(config, 'utf8'), '# user configuration\n');
    const backups = path.join(home, '.config/cc-deep-review/backups');
    const oldAgents = fs.readdirSync(backups).find(name => name.startsWith('agents-'));
    assert.equal(fs.readFileSync(path.join(backups, oldAgents, 'local-note.txt'), 'utf8'), 'keep this local edit');
    assert.equal(fs.existsSync(path.join(installed, 'local-note.txt')), false);
    const rules = fs.readFileSync(path.join(home, '.config/cc-deep-review/setup/cc-deep-review.rules'), 'utf8');
    assert.ok(rules.includes(JSON.stringify(path.join(fs.realpathSync(installed), 'scripts/launch-run-reviewer.sh').replaceAll('\\', '/'))));
    assert.ok(!rules.includes('"bash", "-c"'));
    const settings = JSON.parse(fs.readFileSync(path.join(home, '.config/cc-deep-review/setup/claude-settings.json'), 'utf8'));
    assert.equal(settings.env.BASH_MAX_TIMEOUT_MS, '2400000');
    assert.ok(settings.permissions.allow.every(rule => !rule.includes('run-codex-core')));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('invalid target leaves the home unchanged', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-review-invalid-'));
  try {
    assert.notEqual(run(home, '--target', 'unknown').status, 0);
    assert.deepEqual(fs.readdirSync(home), []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
