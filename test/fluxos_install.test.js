const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('node:path');
const { execFileSync } = require('child_process');

const { updateFluxOs, stageModules, stageDirFor, previousDirFor } = require('../fluxos_install');

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

/**
 * A checkout on 1.0.0 with node_modules installed, and a fetched commit ahead of it on
 * 2.0.0. `withLock` puts a package-lock.json in the new commit.
 */
function checkout({ withLock = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxos-install-test-'));
  const root = path.join(base, 'fluxos');
  fs.mkdirSync(root);
  git(root, 'init', '-q', '-b', 'master');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'test');
  git(root, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n');
  writeJson(path.join(root, 'package.json'), { name: 'flux', version: '1.0.0' });
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'one');
  const before = git(root, 'rev-parse', 'HEAD');

  writeJson(path.join(root, 'package.json'), { name: 'flux', version: '2.0.0' });
  if (withLock) writeJson(path.join(root, 'package-lock.json'), { lockfileVersion: 3 });
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'two');
  const commit = git(root, 'rev-parse', 'HEAD');
  git(root, 'reset', '-q', '--hard', before);

  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'node_modules', 'marker'), '1.0.0');

  return { base, root, before, commit };
}

/**
 * An npm that records its arguments and installs a node_modules naming the package.json
 * version it was run against. `extra` runs before it exits.
 */
function fakeNpm(base, extra = '') {
  const npm = path.join(base, 'npm');
  const log = path.join(base, 'npm.log');
  fs.writeFileSync(
    npm,
    `#!/bin/sh
echo "$@" >> ${log}
mkdir -p node_modules
sed -n 's/.*"version": "\\(.*\\)".*/\\1/p' package.json > node_modules/marker
${extra}
`,
    { mode: 0o755 },
  );

  return { npm, log };
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function recorder() {
  const events = [];
  return {
    events,
    stop: async () => {
      events.push('stop');
    },
    start: async () => {
      events.push('start');
    },
  };
}

function marker(root) {
  return fs.readFileSync(path.join(root, 'node_modules', 'marker'), 'utf8').trim();
}

test('stages with npm ci from the commit lock, and the node flags', async () => {
  const { base, root, commit } = checkout();
  const { npm, log } = fakeNpm(base);
  const result = await stageModules({
    fluxOsRootDir: root,
    commit,
    npm,
    npmArgs: ['--legacy-peer-deps'],
  });
  assert.deepStrictEqual(result, { ok: true });
  assert.strictEqual(fs.readFileSync(log, 'utf8').trim(), 'ci --omit=dev --legacy-peer-deps');
  assert.strictEqual(
    fs.readFileSync(path.join(stageDirFor(root), 'node_modules', 'marker'), 'utf8').trim(),
    '2.0.0',
  );
  assert.strictEqual(marker(root), '1.0.0');
});

test('stages with npm install when the commit has no lock', async () => {
  const { base, root, commit } = checkout({ withLock: false });
  const { npm, log } = fakeNpm(base);
  const result = await stageModules({ fluxOsRootDir: root, commit, npm });
  assert.deepStrictEqual(result, { ok: true });
  assert.strictEqual(fs.readFileSync(log, 'utf8').trim(), 'install --omit=dev');
});

test('updates: FluxOS is stopped only after staging, and runs the new code and modules', async () => {
  const { base, root, commit } = checkout();
  const { npm, log } = fakeNpm(base);
  const { events, stop, start } = recorder();
  const result = await updateFluxOs({
    fluxOsRootDir: root,
    commit,
    version: '2.0.0',
    npm,
    stop: async () => {
      assert.ok(fs.existsSync(log), 'FluxOS was stopped before its dependencies were staged');
      await stop();
    },
    start,
    answersWith: async (version) => {
      events.push(`answers ${version}`);
      return true;
    },
  });
  assert.deepStrictEqual(result, { outcome: 'updated' });
  assert.deepStrictEqual(events, ['stop', 'start', 'answers 2.0.0']);
  assert.strictEqual(git(root, 'rev-parse', 'HEAD'), commit);
  assert.strictEqual(marker(root), '2.0.0');
  assert.strictEqual(fs.existsSync(stageDirFor(root)), false);
  assert.strictEqual(fs.existsSync(previousDirFor(root)), false);
});

test('a failed staging install leaves FluxOS running on its code and modules', async () => {
  const { base, root, before, commit } = checkout();
  const { npm } = fakeNpm(base, 'echo "npm ERR! network"; exit 1');
  const { events, stop, start } = recorder();
  const result = await updateFluxOs({
    fluxOsRootDir: root,
    commit,
    version: '2.0.0',
    npm,
    stop,
    start,
    answersWith: async () => true,
  });
  assert.strictEqual(result.outcome, 'not-staged');
  assert.strictEqual(result.reason, 'exited with code 1');
  assert.match(result.output, /npm ERR! network/);
  assert.deepStrictEqual(events, []);
  assert.strictEqual(git(root, 'rev-parse', 'HEAD'), before);
  assert.strictEqual(marker(root), '1.0.0');
  assert.strictEqual(fs.existsSync(stageDirFor(root)), false);
});

test('a staging timeout stops every process npm started and leaves FluxOS running', async () => {
  const { base, root, before, commit } = checkout();
  const pidFile = path.join(base, 'child.pid');
  // npm's child holds the output pipe open: the update returns only once it is stopped.
  const { npm } = fakeNpm(base, `sleep 300 & echo $! > ${pidFile}; wait`);
  const { events, stop, start } = recorder();
  const update = updateFluxOs({
    fluxOsRootDir: root,
    commit,
    version: '2.0.0',
    npm,
    stageTimeoutMs: 500,
    stop,
    start,
    answersWith: async () => true,
  });
  let deadline;
  try {
    const result = await Promise.race([
      update,
      new Promise((resolve) => {
        deadline = setTimeout(() => resolve(null), 5000);
      }),
    ]);
    assert.ok(result, "the update was still waiting on npm's child 5 s after it started");
    assert.strictEqual(result.outcome, 'not-staged');
    assert.strictEqual(result.reason, 'timed out after 500 milliseconds');
    assert.strictEqual(alive(Number(fs.readFileSync(pidFile, 'utf8'))), false);
    assert.deepStrictEqual(events, []);
    assert.strictEqual(git(root, 'rev-parse', 'HEAD'), before);
    assert.strictEqual(marker(root), '1.0.0');
  } finally {
    clearTimeout(deadline);
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    if (alive(pid)) process.kill(pid, 'SIGKILL');
  }
});

test('a FluxOS that does not answer with the new version is rolled back', async () => {
  const { base, root, before, commit } = checkout();
  const { npm } = fakeNpm(base);
  const { events, stop, start } = recorder();
  const result = await updateFluxOs({
    fluxOsRootDir: root,
    commit,
    version: '2.0.0',
    npm,
    stop,
    start,
    answersWith: async () => false,
  });
  assert.deepStrictEqual(result, {
    outcome: 'rolled-back',
    reason: 'FluxOS 2.0.0 did not answer; 1.0.0 restored',
  });
  assert.deepStrictEqual(events, ['stop', 'start', 'stop', 'start']);
  assert.strictEqual(git(root, 'rev-parse', 'HEAD'), before);
  assert.strictEqual(marker(root), '1.0.0');
  assert.strictEqual(fs.existsSync(previousDirFor(root)), false);
});

test('a checkout with commits of its own is left running without staging', async () => {
  const { base, root, before, commit } = checkout();
  fs.writeFileSync(path.join(root, 'local.txt'), 'a branch commit of its own');
  git(root, 'add', 'local.txt');
  git(root, 'commit', '-q', '-m', 'local');
  const head = git(root, 'rev-parse', 'HEAD');
  assert.notStrictEqual(head, before);
  const { npm, log } = fakeNpm(base);
  const { events, stop, start } = recorder();
  const result = await updateFluxOs({
    fluxOsRootDir: root,
    commit,
    version: '2.0.0',
    npm,
    stop,
    start,
    answersWith: async () => true,
  });
  assert.strictEqual(result.outcome, 'not-fast-forward');
  assert.deepStrictEqual(events, []);
  assert.strictEqual(fs.existsSync(log), false);
  assert.strictEqual(git(root, 'rev-parse', 'HEAD'), head);
  assert.strictEqual(marker(root), '1.0.0');
});

test('a checkout that fails after the stop restarts the installed version', async () => {
  const { base, root, before, commit } = checkout();
  const { npm } = fakeNpm(base);
  const { events, stop, start } = recorder();
  const result = await updateFluxOs({
    fluxOsRootDir: root,
    commit,
    version: '2.0.0',
    npm,
    stop: async () => {
      await stop();
      // A tracked file git cannot overwrite, made unwritable by its directory.
      fs.chmodSync(root, 0o555);
    },
    start: async () => {
      fs.chmodSync(root, 0o755);
      await start();
    },
    answersWith: async () => true,
  });
  assert.strictEqual(result.outcome, 'checkout-failed');
  assert.deepStrictEqual(events, ['stop', 'start']);
  assert.strictEqual(git(root, 'rev-parse', 'HEAD'), before);
  assert.strictEqual(marker(root), '1.0.0');
  assert.strictEqual(fs.existsSync(stageDirFor(root)), false);
});
