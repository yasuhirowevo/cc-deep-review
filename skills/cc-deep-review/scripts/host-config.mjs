import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function writeHostConfig(skillDirs, output) {
  const commands = ['run-review-preflight.sh', 'launch-run-reviewer.sh', 'launch-run-codex.sh'];
  const paths = new Set();
  for (const input of skillDirs) {
    const root = fs.realpathSync(input).replaceAll('\\', '/');
    if (!fs.existsSync(path.join(root, 'SKILL.md'))) throw new Error(`Not a skill directory: ${input}`);
    for (const command of commands) {
      const script = `${root}/scripts/${command}`;
      if (!fs.statSync(script).isFile()) throw new Error(`Missing launcher: ${command}`);
      paths.add(script);
      if (/^[A-Za-z]:\//.test(script)) paths.add(`/${script[0].toLowerCase()}${script.slice(2)}`);
    }
  }
  const rules = [...paths].map(script => [
    'prefix_rule(',
    `  pattern = ["bash", ${JSON.stringify(script)}],`,
    '  decision = "allow",',
    '  justification = "cc-deep-review fixed validated launcher",',
    ')',
  ].join('\n')).join('\n\n') + '\n';
  const settings = {
    env: { BASH_MAX_TIMEOUT_MS: '2400000' },
    permissions: { allow: [...paths].map(script => `Bash(bash ${JSON.stringify(script)}:*)`) },
  };
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(output, 'cc-deep-review.rules'), rules);
  fs.writeFileSync(path.join(output, 'claude-settings.json'), JSON.stringify(settings, null, 2) + '\n');
  return { rules: path.join(output, 'cc-deep-review.rules'), settings: path.join(output, 'claude-settings.json') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const dirs = [];
    let output;
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = process.argv[i], value = process.argv[i + 1];
      if (!value) throw new Error(`${key} requires a value`);
      if (key === '--skill-dir') dirs.push(value);
      else if (key === '--output') output = value;
      else throw new Error(`Unknown argument: ${key}`);
    }
    if (!dirs.length || !output) throw new Error('Usage: node scripts/host-config.mjs --skill-dir <installed skill> [--skill-dir <another>] --output <directory>');
    console.log(JSON.stringify(writeHostConfig(dirs, output)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
