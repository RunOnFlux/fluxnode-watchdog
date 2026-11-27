/**
 * Runs FluxOS's CloudUI update (`npm run update:cloudui -- <api-base-url>`).
 *
 * The update downloads a release tarball of about 60 MB, and a slow link takes hours, so
 * the update runs in the background (`startCloudUiUpdate`), one at a time, and the
 * timeout only stops a download that never finishes: 6 hours is 60 MB at under 3 KB/s.
 * The update runs in its own process group (process_group.js), so a timeout stops the
 * download as well as npm.
 *
 * The update's temporary files go in one scratch directory the watchdog owns
 * (`TMPDIR`), emptied before and after every run. A run cut short by the watchdog
 * itself stopping is cleared by the next run. On ArcaneOS /tmp is memory, so a
 * leftover download costs RAM until it is removed.
 */

const fs = require('fs');
const os = require('os');
const path = require('node:path');
const { runProcessGroup, failureReason } = require('./process_group');

const CLOUDUI_UPDATE_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const CLOUDUI_UPDATE_GRACE_MS = 10 * 1000;
const CLOUDUI_SCRATCH_DIR = path.join(os.tmpdir(), 'fluxwatchdog-cloudui');

// The update in progress, if there is one.
let running = null;

function clearScratch(scratchDir) {
  fs.rmSync(scratchDir, { recursive: true, force: true });
}

/**
 * @param {object} options
 * @param {string} options.fluxOsRootDir - FluxOS checkout the update runs in.
 * @param {string} options.apiBaseUrl - GitHub API host the update reads the release from.
 * @param {number} [options.timeoutMs]
 * @param {number} [options.graceMs] - Time from SIGTERM to SIGKILL after a timeout.
 * @param {string} [options.scratchDir] - Directory given to the update as TMPDIR.
 * @param {string[]} [options.command] - Command and arguments; defaults to the npm script.
 * @returns {Promise<{ok: boolean, timedOut: boolean, timeoutMs: number, code: number|null,
 *   signal: string|null, error: Error|null, output: string}>}
 */
async function runCloudUiUpdate({
  fluxOsRootDir,
  apiBaseUrl,
  timeoutMs = CLOUDUI_UPDATE_TIMEOUT_MS,
  graceMs = CLOUDUI_UPDATE_GRACE_MS,
  scratchDir = CLOUDUI_SCRATCH_DIR,
  command = ['npm', 'run', 'update:cloudui', '--', apiBaseUrl],
}) {
  // A scratch directory that cannot be emptied or created fails the update before it
  // starts.
  try {
    clearScratch(scratchDir);
    fs.mkdirSync(scratchDir, { recursive: true, mode: 0o700 });
  } catch (error) {
    return {
      ok: false,
      timedOut: false,
      timeoutMs,
      code: null,
      signal: null,
      error,
      output: '',
    };
  }

  const result = await runProcessGroup({
    command,
    cwd: fluxOsRootDir,
    env: { ...process.env, TMPDIR: scratchDir },
    timeoutMs,
    graceMs,
  });
  try {
    clearScratch(scratchDir);
  } catch {
    // Left in place; the next run cannot prepare it either and reports why.
  }

  return result;
}

/**
 * Starts an update in the background unless one is already running, and calls onDone
 * with its result when it ends.
 * @param {object} options - As for runCloudUiUpdate.
 * @param {function(object): void} onDone
 * @returns {Promise<void>|null} The started update, or null when one is already running.
 */
function startCloudUiUpdate(options, onDone) {
  if (running) return null;
  running = runCloudUiUpdate(options)
    .then(onDone)
    .catch((error) => console.log(`CloudUI update: ${error.message}`))
    .finally(() => {
      running = null;
    });

  return running;
}

module.exports = {
  runCloudUiUpdate,
  startCloudUiUpdate,
  failureReason,
  CLOUDUI_UPDATE_TIMEOUT_MS,
  CLOUDUI_UPDATE_GRACE_MS,
  CLOUDUI_SCRATCH_DIR,
};
