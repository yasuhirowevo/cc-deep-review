#!/usr/bin/env node
// Usage: node test-wave-lock-races.mjs [--source /absolute/path/review-wave-state.mjs]
// The implementation comes from the selected source; only filesystem/PID events
// are simulated. No lock files, subprocesses, or production test hooks are used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--source')) {
  throw new Error('Usage: node test-wave-lock-races.mjs [--source <source-path>]');
}
const sourcePath = path.resolve(args[1] ?? fileURLToPath(
  new URL('../scripts/review-wave-state.mjs', import.meta.url),
));
const source = readFileSync(sourcePath, 'utf8');
const start = source.indexOf('\nfunction fail(');
const end = source.indexOf('\nfunction acquireLock(', start);
const schemaDeclaration = source.match(/^const LOCK_SCHEMA = [^\r\n]+;$/mu)?.[0];
assert.ok(start >= 0 && end > start && schemaDeclaration,
  'Source layout changed: update the helper-region boundaries without copying its implementation');
const helperSource = `${schemaDeclaration}\n${source.slice(start, end)}\n` +
  '({ recoverDeadLock, tryReadLockMetadata, LOCK_SCHEMA });';

const root = '/fixture';
const lockPath = `${root}/status.json.lock`;
const recoveryPath = `${lockPath}.recovery`;
const originalOwner = { pid: 101, nonce: 'original-owner' };
const primaryOwner = { pid: 303, nonce: 'primary-owner' };
const staleError = /stale wave recovery lock requires manual verification/u;

function systemError(code, target) {
  return Object.assign(new Error(`${code}: ${target}`), { code });
}

function fixture({ recovery = true, onKill, onRead } = {}) {
  const files = new Map();
  const events = [];
  const readCounts = new Map();
  let uuid = 0;
  let hooksTriggered = 0;
  const record = (operation, target) => events.push({ operation, target });
  const requireFile = (target) => {
    if (!files.has(target)) throw systemError('ENOENT', target);
    return files.get(target);
  };
  const harness = {
    files, events,
    trigger() { hooksTriggered += 1; },
    get hooksTriggered() { return hooksTriggered; },
  };
  const context = vm.createContext({
    path: path.posix,
    toNativeAbsolutePath: (value) => value,
    toBashAbsolutePath: (value) => value,
    randomUUID: () => `fixture-uuid-${++uuid}`,
    process: {
      pid: 909,
      kill(pid, signal) {
        assert.equal(signal, 0, 'Liveness checks must never send a signal');
        record('kill', pid);
        if (onKill) return onKill(pid, harness);
        throw systemError('ESRCH', String(pid));
      },
    },
    existsSync(target) {
      record('exists', target);
      return target === root || files.has(target);
    },
    lstatSync(target) {
      record('stat', target);
      const isDirectory = target === root;
      const content = isDirectory ? '' : requireFile(target);
      return {
        isDirectory: () => isDirectory,
        isFile: () => !isDirectory,
        isSymbolicLink: () => false,
        size: Buffer.byteLength(content),
      };
    },
    realpathSync(target) {
      record('realpath', target);
      if (target !== root) requireFile(target);
      return target;
    },
    readFileSync(target, encoding) {
      assert.equal(encoding, 'utf8');
      record('read', target);
      const count = (readCounts.get(target) ?? 0) + 1;
      readCounts.set(target, count);
      if (onRead) onRead(target, count, harness);
      return requireFile(target);
    },
    writeFileSync(target, content, options) {
      record('write', target);
      if (options?.flag === 'wx' && files.has(target)) {
        throw systemError('EEXIST', target);
      }
      files.set(target, String(content));
    },
    chmodSync(target) {
      record('chmod', target);
      requireFile(target);
    },
    linkSync(from, to) {
      record('link', to);
      const content = requireFile(from);
      if (files.has(to)) throw systemError('EEXIST', to);
      files.set(to, content);
    },
    renameSync(from, to) {
      record('rename', to);
      files.set(to, requireFile(from));
      files.delete(from);
    },
    rmSync(target) {
      record('remove', target);
      files.delete(target);
    },
  });
  const api = vm.runInContext(helperSource, context, {
    filename: sourcePath,
    timeout: 1000,
  });
  harness.ownerBytes = (owner) => JSON.stringify({
    schema: api.LOCK_SCHEMA,
    ...owner,
    createdAt: '2026-10-17T00:00:00.000Z',
  });
  harness.recover = () => api.recoverDeadLock(lockPath);
  harness.originalPrimary = harness.ownerBytes(primaryOwner);
  harness.originalRecovery = harness.ownerBytes(originalOwner);
  files.set(lockPath, harness.originalPrimary);
  if (recovery) files.set(recoveryPath, harness.originalRecovery);
  harness.assertPrimaryUntouched = () => {
    assert.equal(files.get(lockPath), harness.originalPrimary);
    assert.ok(!events.some((event) => event.operation === 'remove' && event.target === lockPath),
      'A contender must not remove the primary lock while another recovery owner exists');
    assert.ok([...files.keys()].every((name) => name === lockPath || name === recoveryPath),
      'Temporary lock publication files must be cleaned');
  };
  return harness;
}

test('normal owner cleanup and exit after metadata read permits retry', () => {
  const f = fixture({ onKill(pid, state) {
    assert.equal(pid, originalOwner.pid);
    assert.ok(state.events.some((event) => event.operation === 'read' && event.target === recoveryPath));
    state.trigger();
    state.files.delete(recoveryPath);
    throw systemError('ESRCH', String(pid));
  } });
  assert.equal(f.recover(), false);
  assert.equal(f.hooksTriggered, 1);
  assert.ok(!f.files.has(recoveryPath));
  f.assertPrimaryUntouched();
});

for (const [label, replacement] of [
  ['PID changes', { pid: 202, nonce: originalOwner.nonce }],
  ['nonce changes', { pid: originalOwner.pid, nonce: 'replacement-owner' }],
  ['PID and nonce change', { pid: 202, nonce: 'replacement-owner' }],
]) {
  test(`recovery ownership ${label} after metadata read preserves the new owner`, () => {
    const f = fixture({ onKill(pid, state) {
      assert.equal(pid, originalOwner.pid);
      state.trigger();
      state.files.set(recoveryPath, state.ownerBytes(replacement));
      throw systemError('ESRCH', String(pid));
    } });
    assert.equal(f.recover(), false);
    assert.equal(f.hooksTriggered, 1);
    assert.equal(f.files.get(recoveryPath), f.ownerBytes(replacement));
    assert.ok(!f.events.some((event) => event.operation === 'remove' && event.target === recoveryPath),
      'A contender must never delete a replacement recovery owner');
    f.assertPrimaryUntouched();
  });
}

for (const readNumber of [1, 2]) {
  test(`recovery disappears during metadata read ${readNumber} without invalid-JSON failure`, () => {
    const f = fixture({ onRead(target, count, state) {
      if (target === recoveryPath && count === readNumber) {
        state.trigger();
        state.files.delete(target);
        throw systemError('ENOENT', target);
      }
    } });
    assert.equal(f.recover(), false);
    assert.equal(f.hooksTriggered, 1, 'The intended readFileSync race must actually occur');
    assert.ok(!f.files.has(recoveryPath));
    f.assertPrimaryUntouched();
  });
}

test('primary lock disappears during read and owned recovery lock is released', () => {
  const f = fixture({ recovery: false, onRead(target, count, state) {
    if (target === lockPath && count === 1) {
      state.trigger();
      state.files.delete(target);
      throw systemError('ENOENT', target);
    }
  } });
  assert.equal(f.recover(), true);
  assert.equal(f.hooksTriggered, 1);
  assert.equal(f.files.size, 0);
});

test('persistent dead recovery owner still fails closed and remains untouched', () => {
  const f = fixture();
  assert.throws(() => f.recover(), staleError);
  assert.equal(f.files.get(recoveryPath), f.originalRecovery);
  f.assertPrimaryUntouched();
});

test('malformed recovery JSON still fails closed and remains untouched', () => {
  const f = fixture();
  const malformed = '{"schema":';
  f.files.set(recoveryPath, malformed);
  assert.throws(() => f.recover(), /invalid JSON/u);
  assert.equal(f.files.get(recoveryPath), malformed);
  assert.ok(!f.events.some((event) => event.operation === 'kill'));
  f.assertPrimaryUntouched();
});

test('invalid recovery metadata still fails closed and remains untouched', () => {
  const f = fixture();
  const invalid = f.ownerBytes({ pid: originalOwner.pid, nonce: '' });
  f.files.set(recoveryPath, invalid);
  assert.throws(() => f.recover(), /metadata is invalid/u);
  assert.equal(f.files.get(recoveryPath), invalid);
  f.assertPrimaryUntouched();
});

test('live recovery owner is preserved and the contender retries', () => {
  const f = fixture({ onKill(pid) { assert.equal(pid, originalOwner.pid); } });
  assert.equal(f.recover(), false);
  assert.equal(f.files.get(recoveryPath), f.originalRecovery);
  f.assertPrimaryUntouched();
});

test('dead primary lock can still be reclaimed and temporary ownership is released', () => {
  const f = fixture({ recovery: false });
  assert.equal(f.recover(), true);
  assert.equal(f.files.size, 0);
});
