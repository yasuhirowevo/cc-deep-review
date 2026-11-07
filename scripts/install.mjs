import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { writeHostConfig } from '../skills/cc-deep-review/scripts/host-config.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(repo, 'skills', 'cc-deep-review');

function assertTree(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const item = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not supported in the skill package: ${item}`);
    if (entry.isDirectory()) assertTree(item);
    else if (!entry.isFile()) throw new Error(`Not a regular file: ${item}`);
  }
}

try {
  let target = 'agents', userRoot = os.homedir(), replace = false;
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--replace') replace = true;
    else if (arg === '--target' || arg === '--home') {
      const value = process.argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--target') target = value;
      else userRoot = path.resolve(value);
    } else if (arg === '--help') {
      console.log('Usage: node scripts/install.mjs [--target agents|claude|both] [--replace] [--home <directory>]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!['agents', 'claude', 'both'].includes(target)) throw new Error('Target must be agents, claude or both');
  if (!fs.statSync(userRoot).isDirectory()) throw new Error('Home directory must exist');
  userRoot = fs.realpathSync(userRoot);
  const hosts = target === 'both' ? ['agents', 'claude'] : [target];
  const targets = hosts.map(host => path.join(userRoot, `.${host}`, 'skills', 'cc-deep-review'));
  const configDir = path.join(userRoot, '.config', 'cc-deep-review');
  assertTree(source);
  for (const destination of targets) {
    if (path.resolve(source) === path.resolve(destination)) throw new Error('Cannot install over the source checkout');
    if (fs.existsSync(destination) || fs.lstatSync(destination, { throwIfNoEntry: false })) {
      const stat = fs.lstatSync(destination);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Destination must be a regular directory: ${destination}`);
      if (!replace) throw new Error(`Already installed: ${destination}. Use --replace to keep a backup and update.`);
    }
  }
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  for (let i = 0; i < targets.length; i++) {
    const destination = targets[i];
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const staging = fs.mkdtempSync(path.join(path.dirname(destination), '.cc-deep-review-install-'));
    fs.cpSync(source, staging, { recursive: true, preserveTimestamps: true });
    let backup;
    if (fs.existsSync(destination)) {
      backup = path.join(configDir, 'backups', `${hosts[i]}-${Date.now()}-${randomUUID()}`);
      fs.mkdirSync(path.dirname(backup), { recursive: true, mode: 0o700 });
      fs.renameSync(destination, backup);
    }
    try {
      fs.renameSync(staging, destination);
    } catch (error) {
      if (backup) fs.renameSync(backup, destination);
      throw error;
    }
    console.log(`Installed: ${destination}`);
    if (backup) console.log(`Previous installation saved: ${backup}`);
  }
  const config = path.join(configDir, 'reviewer.env');
  if (!fs.existsSync(config)) {
    fs.copyFileSync(path.join(repo, 'config', 'reviewer.env.example'), config, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(config, 0o600);
    console.log(`Set your reviewer models and effort values: ${config}`);
  } else console.log(`Existing reviewer configuration retained: ${config}`);
  const generated = writeHostConfig(targets, path.join(configDir, 'setup'));
  console.log(`Optional Codex rule file: ${generated.rules}`);
  console.log(`Claude settings to merge: ${generated.settings}`);
  console.log('See README.md for host setup and invocation.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
