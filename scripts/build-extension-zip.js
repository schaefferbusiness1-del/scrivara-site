'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const candidates = [];
if (process.env.PYTHON) candidates.push([process.env.PYTHON, []]);
if (process.platform === 'win32') {
  candidates.push([
    path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe'),
    []
  ]);
}
candidates.push(['python3', []], ['python', []]);
if (process.platform === 'win32') candidates.push(['py', ['-3']]);

let selected = null;
for (const [command, prefix] of candidates) {
  if (path.isAbsolute(command) && !fs.existsSync(command)) continue;
  const probe = spawnSync(command, [...prefix, '--version'], { encoding: 'utf8', windowsHide: true });
  if (probe.status === 0) {
    selected = { command, prefix };
    break;
  }
}

if (!selected) {
  console.error('Python 3 is required to build the deterministic extension ZIP. Set PYTHON to its executable path.');
  process.exit(1);
}

const script = path.join(__dirname, 'build_extension_zip.py');
const result = spawnSync(
  selected.command,
  [...selected.prefix, script, ...process.argv.slice(2)],
  { cwd: path.resolve(__dirname, '..'), stdio: 'inherit', windowsHide: true }
);
process.exit(result.status === null ? 1 : result.status);
