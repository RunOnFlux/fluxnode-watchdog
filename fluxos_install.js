/**
 * Updates the FluxOS checkout to a commit while FluxOS keeps running for all but the swap.
 *
 * The new commit's dependencies are installed into a staging directory beside the checkout
 * (`<root>.next`) while the old FluxOS still serves. Only once that install has finished is
 * FluxOS stopped: the checkout moves to the commit, the staged `node_modules` is renamed into
 * place and the old one aside (`<root>.prev`), and FluxOS is started. Both directories sit
 * beside the checkout so the renames stay on one filesystem and never show in its git status.
 *
 * A checkout with commits of its own, or a staging install that fails or times out, leaves
 * FluxOS untouched. A FluxOS that does not
 * answer with the new version in time is rolled back: the checkout returns to its commit,
 * the previous `node_modules` is renamed back, and the old version is started.
 */

const fs = require('fs');
const path = require('node:path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const { runProcessGroup, failureReason, DEFAULT_GRACE_MS } = require('./process_group');

const execFilePromise = promisify(execFile);

// Nothing is down while the staging install runs, so it may take as long as a slow link
// needs; the first install from a new lock rebuilds every package.
const STAGE_TIMEOUT_MS = 20 * 60 * 1000;
const GIT_TIMEOUT_MS = 2 * 60 * 1000;

function stageDirFor(fluxOsRootDir) {
  return `${fluxOsRootDir}.next`;
}

function previousDirFor(fluxOsRootDir) {
  return `${fluxOsRootDir}.prev`;
}

async function git(fluxOsRootDir, args) {
  const { stdout } = await execFilePromise('git', ['-C', fluxOsRootDir, ...args], {
    timeout: GIT_TIMEOUT_MS,
  });

  return stdout.trim();
}

/**
 * Whether the commit holds the file; asked by exit status alone.
 * @returns {Promise<boolean>}
 */
async function commitHasFile(fluxOsRootDir, commit, file) {
  try {
    await git(fluxOsRootDir, ['cat-file', '-e', `${commit}:${file}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether `ancestor` is an ancestor of `commit`; asked by exit status alone.
 * @returns {Promise<boolean>}
 */
async function isAncestor(fluxOsRootDir, ancestor, commit) {
  try {
    await git(fluxOsRootDir, ['merge-base', '--is-ancestor', ancestor, commit]);
    return true;
  } catch {
    return false;
  }
}

async function writeFromCommit(fluxOsRootDir, commit, file, stageDir) {
  const { stdout } = await execFilePromise(
    'git',
    ['-C', fluxOsRootDir, 'show', `${commit}:${file}`],
    { timeout: GIT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
  );
  fs.writeFileSync(path.join(stageDir, file), stdout);
}

/**
 * Installs the commit's production dependencies into the staging directory. `npm ci` from
 * the commit's lock when it has one, `npm install` from its package.json otherwise.
 * @param {object} options
 * @param {string} options.fluxOsRootDir
 * @param {string} options.commit
 * @param {string[]} [options.npmArgs] - Flags this node's installs always use.
 * @param {string} [options.npm] - The npm executable.
 * @param {number} [options.timeoutMs]
 * @param {number} [options.graceMs]
 * @returns {Promise<{ok: boolean, reason?: string, output?: string}>}
 */
async function stageModules({
  fluxOsRootDir,
  commit,
  npmArgs = [],
  npm = 'npm',
  timeoutMs = STAGE_TIMEOUT_MS,
  graceMs = DEFAULT_GRACE_MS,
}) {
  const stageDir = stageDirFor(fluxOsRootDir);
  const hasLock = await commitHasFile(fluxOsRootDir, commit, 'package-lock.json');
  try {
    fs.rmSync(stageDir, { recursive: true, force: true });
    fs.mkdirSync(stageDir, { recursive: true });
    await writeFromCommit(fluxOsRootDir, commit, 'package.json', stageDir);
    if (hasLock) await writeFromCommit(fluxOsRootDir, commit, 'package-lock.json', stageDir);
  } catch (error) {
    fs.rmSync(stageDir, { recursive: true, force: true });
    return { ok: false, reason: error.message };
  }

  const result = await runProcessGroup({
    command: [npm, hasLock ? 'ci' : 'install', '--omit=dev', ...npmArgs],
    cwd: stageDir,
    timeoutMs,
    graceMs,
  });
  if (!result.ok) {
    fs.rmSync(stageDir, { recursive: true, force: true });
    return { ok: false, reason: failureReason(result), output: result.output };
  }
  if (!fs.existsSync(path.join(stageDir, 'node_modules'))) {
    fs.rmSync(stageDir, { recursive: true, force: true });
    return { ok: false, reason: 'the install left no node_modules' };
  }

  return { ok: true };
}

/**
 * Renames the staged node_modules into the checkout and the live one aside. Called with
 * FluxOS stopped.
 */
function swapInStagedModules(fluxOsRootDir) {
  const live = path.join(fluxOsRootDir, 'node_modules');
  const previousDir = previousDirFor(fluxOsRootDir);
  const previous = path.join(previousDir, 'node_modules');
  fs.rmSync(previousDir, { recursive: true, force: true });
  fs.mkdirSync(previousDir, { recursive: true });
  if (fs.existsSync(live)) fs.renameSync(live, previous);
  try {
    fs.renameSync(path.join(stageDirFor(fluxOsRootDir), 'node_modules'), live);
  } catch (error) {
    if (fs.existsSync(previous)) fs.renameSync(previous, live);
    throw error;
  }
  fs.rmSync(stageDirFor(fluxOsRootDir), { recursive: true, force: true });
}

/**
 * Renames the previous node_modules back into the checkout. Called with FluxOS stopped.
 */
function restorePreviousModules(fluxOsRootDir) {
  const live = path.join(fluxOsRootDir, 'node_modules');
  const previous = path.join(previousDirFor(fluxOsRootDir), 'node_modules');
  if (!fs.existsSync(previous)) return;
  fs.rmSync(live, { recursive: true, force: true });
  fs.renameSync(previous, live);
  fs.rmSync(previousDirFor(fluxOsRootDir), { recursive: true, force: true });
}

/**
 * Moves the checkout to `commit`: a fast-forward of the branch it is on, so the code is
 * exactly the commit whose dependencies were staged.
 */
async function checkoutCommit(fluxOsRootDir, commit) {
  await git(fluxOsRootDir, ['checkout', '.']);
  await git(fluxOsRootDir, ['merge', '--ff-only', commit]);
}

/**
 * @param {object} options
 * @param {string} options.fluxOsRootDir
 * @param {string} options.commit - The commit to update to, already fetched.
 * @param {string} options.version - The FluxOS version that commit carries.
 * @param {() => Promise<void>} options.stop - Stops FluxOS.
 * @param {() => Promise<void>} options.start - Starts FluxOS.
 * @param {(version: string) => Promise<boolean>} options.answersWith - Waits until FluxOS
 *   answers with this version, and says whether it did.
 * @param {string[]} [options.npmArgs]
 * @param {string} [options.npm]
 * @param {number} [options.stageTimeoutMs]
 * @returns {Promise<{outcome: 'updated'|'not-fast-forward'|'not-staged'|'checkout-failed'|
 *   'rolled-back',
 *   reason?: string, output?: string}>}
 */
async function updateFluxOs({
  fluxOsRootDir,
  commit,
  version,
  stop,
  start,
  answersWith,
  npmArgs = [],
  npm = 'npm',
  stageTimeoutMs = STAGE_TIMEOUT_MS,
}) {
  if (!(await isAncestor(fluxOsRootDir, 'HEAD', commit))) {
    return {
      outcome: 'not-fast-forward',
      reason: `the checkout has commits of its own that ${commit} does not hold`,
    };
  }
  const staged = await stageModules({
    fluxOsRootDir,
    commit,
    npmArgs,
    npm,
    timeoutMs: stageTimeoutMs,
  });
  if (!staged.ok) return { outcome: 'not-staged', reason: staged.reason, output: staged.output };

  const before = await git(fluxOsRootDir, ['rev-parse', 'HEAD']);
  const previousVersion = JSON.parse(
    fs.readFileSync(path.join(fluxOsRootDir, 'package.json'), 'utf8'),
  ).version;

  await stop();
  try {
    await checkoutCommit(fluxOsRootDir, commit);
    swapInStagedModules(fluxOsRootDir);
  } catch (error) {
    await git(fluxOsRootDir, ['reset', '--hard', before]);
    fs.rmSync(stageDirFor(fluxOsRootDir), { recursive: true, force: true });
    await start();
    return { outcome: 'checkout-failed', reason: error.message };
  }
  await start();

  if (await answersWith(version)) {
    fs.rmSync(previousDirFor(fluxOsRootDir), { recursive: true, force: true });
    return { outcome: 'updated' };
  }

  await stop();
  await git(fluxOsRootDir, ['reset', '--hard', before]);
  restorePreviousModules(fluxOsRootDir);
  await start();
  return {
    outcome: 'rolled-back',
    reason: `FluxOS ${version} did not answer; ${previousVersion} restored`,
  };
}

module.exports = {
  updateFluxOs,
  stageModules,
  stageDirFor,
  previousDirFor,
  STAGE_TIMEOUT_MS,
};
