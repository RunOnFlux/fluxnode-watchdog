const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('node:path');

const { runCloudUiUpdate } = require('../cloudui_update');

function tempDirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudui-update-test-'));
  return { base, scratchDir: path.join(base, 'scratch') };
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('runs the update with TMPDIR set to the scratch directory', async () => {
  const { base, scratchDir } = tempDirs();
  const result = await runCloudUiUpdate({
    fluxOsRootDir: base,
    apiBaseUrl: 'https://api.github.com',
    scratchDir,
    command: ['sh', '-c', 'd=$(mktemp -d) && echo "made $d" && touch "$d/dist.tar.gz"'],
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.timedOut, false);
  assert.match(result.output, new RegExp(`made ${scratchDir}/`));
  assert.strictEqual(fs.existsSync(scratchDir), false);
});

test('removes what a previous run left before starting', async () => {
  const { base, scratchDir } = tempDirs();
  fs.mkdirSync(path.join(scratchDir, 'tmp.left'), { recursive: true });
  fs.writeFileSync(path.join(scratchDir, 'tmp.left', 'dist.tar.gz'), 'x');
  const result = await runCloudUiUpdate({
    fluxOsRootDir: base,
    apiBaseUrl: 'https://api.github.com',
    scratchDir,
    command: ['sh', '-c', 'echo "dir:$TMPDIR"; ls -A "$TMPDIR"; echo end'],
  });
  assert.strictEqual(result.ok, true);
  assert.match(result.output, new RegExp(`dir:${scratchDir}\\s+end`));
});

test('a timeout kills every process the update started and removes its files', async () => {
  const { base, scratchDir } = tempDirs();
  const pidFile = path.join(base, 'download.pid');
  const result = await runCloudUiUpdate({
    fluxOsRootDir: base,
    apiBaseUrl: 'https://api.github.com',
    scratchDir,
    timeoutMs: 500,
    command: [
      'sh',
      '-c',
      `d=$(mktemp -d); (while :; do date >> "$d/dist.tar.gz"; sleep 0.05; done) & echo $! > ${pidFile}; wait`,
    ],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.timedOut, true);
  const downloadPid = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.ok(downloadPid > 0);
  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual(alive(downloadPid), false);
  assert.strictEqual(fs.existsSync(scratchDir), false);
});

test('stops a process the update left running after it exited', async () => {
  const { base, scratchDir } = tempDirs();
  const pidFile = path.join(base, 'straggler.pid');
  const result = await runCloudUiUpdate({
    fluxOsRootDir: base,
    apiBaseUrl: 'https://api.github.com',
    scratchDir,
    command: ['sh', '-c', `sleep 30 >/dev/null 2>&1 & echo $! > ${pidFile}`],
  });
  assert.strictEqual(result.ok, true);
  const stragglerPid = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.ok(stragglerPid > 0);
  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual(alive(stragglerPid), false);
});

test('reports a failed update and still removes its files', async () => {
  const { base, scratchDir } = tempDirs();
  const result = await runCloudUiUpdate({
    fluxOsRootDir: base,
    apiBaseUrl: 'https://api.github.com',
    scratchDir,
    command: ['sh', '-c', 'touch "$(mktemp -d)/release.json"; echo "Error: no release"; exit 1'],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.timedOut, false);
  assert.strictEqual(result.code, 1);
  assert.match(result.output, /Error: no release/);
  assert.strictEqual(fs.existsSync(scratchDir), false);
});

test('reports a command that cannot start', async () => {
  const { base, scratchDir } = tempDirs();
  const result = await runCloudUiUpdate({
    fluxOsRootDir: base,
    apiBaseUrl: 'https://api.github.com',
    scratchDir,
    command: [path.join(base, 'no-such-command')],
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error);
  assert.strictEqual(fs.existsSync(scratchDir), false);
});
