const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('node:path');

const { runCloudUiUpdate, failureReason } = require('../cloudui_update');

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
  assert.strictEqual(failureReason(result), 'timed out after 10 minutes');
  const downloadPid = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.ok(downloadPid > 0);
  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual(alive(downloadPid), false);
  assert.strictEqual(fs.existsSync(scratchDir), false);
});

test('a timeout lets the update remove its own files before the group is killed', async () => {
  const { base, scratchDir } = tempDirs();
  const leftover = path.join(base, 'download.part');
  // The first process exits on SIGTERM at once, as npm does, while the script below it is
  // still removing its download.
  const script = `touch ${leftover}; trap "sleep 0.3; rm -f ${leftover}; exit 143" TERM; while :; do sleep 0.05; done`;
  const result = await runCloudUiUpdate({
    fluxOsRootDir: base,
    apiBaseUrl: 'https://api.github.com',
    scratchDir,
    timeoutMs: 500,
    graceMs: 5000,
    command: ['sh', '-c', `sh -c '${script}' & trap "exit 143" TERM; wait`],
  });
  assert.strictEqual(result.timedOut, true);
  assert.strictEqual(fs.existsSync(leftover), false);
});

test('a timeout kills an update that ignores SIGTERM once the grace period has passed', async () => {
  const { base, scratchDir } = tempDirs();
  const pidFile = path.join(base, 'update.pid');
  const started = Date.now();
  const update = runCloudUiUpdate({
    fluxOsRootDir: base,
    apiBaseUrl: 'https://api.github.com',
    scratchDir,
    timeoutMs: 300,
    graceMs: 300,
    command: ['sh', '-c', `trap "" TERM; echo $$ > ${pidFile}; while :; do sleep 0.05; done`],
  });
  let deadline;
  try {
    // An update that is never killed would never settle; the deadline fails the test instead.
    const result = await Promise.race([
      update,
      new Promise((resolve) => {
        deadline = setTimeout(() => resolve(null), 3000);
      }),
    ]);
    assert.ok(result, 'the update was still running 3 s after it started');
    assert.strictEqual(result.timedOut, true);
    assert.strictEqual(result.signal, 'SIGKILL');
    assert.ok(Date.now() - started >= 600);
    assert.strictEqual(alive(Number(fs.readFileSync(pidFile, 'utf8'))), false);
  } finally {
    clearTimeout(deadline);
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    if (alive(pid)) process.kill(-pid, 'SIGKILL');
  }
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
  assert.strictEqual(failureReason(result), 'exited with code 1');
  assert.strictEqual(fs.existsSync(scratchDir), false);
});

test('reports an update ended by a signal from outside the watchdog', async () => {
  const { base, scratchDir } = tempDirs();
  const result = await runCloudUiUpdate({
    fluxOsRootDir: base,
    apiBaseUrl: 'https://api.github.com',
    scratchDir,
    command: ['sh', '-c', 'kill -TERM $$'],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.timedOut, false);
  assert.strictEqual(result.code, null);
  assert.strictEqual(result.signal, 'SIGTERM');
  assert.strictEqual(failureReason(result), 'killed by SIGTERM');
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
  assert.strictEqual(failureReason(result), result.error.message);
  assert.strictEqual(fs.existsSync(scratchDir), false);
});
