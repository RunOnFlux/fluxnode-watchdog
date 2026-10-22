/**
 * Runs FluxOS's CloudUI update (`npm run update:cloudui -- <api-base-url>`).
 *
 * The update downloads a release tarball of about 55 MB, so the timeout is sized for a
 * slow link. The update runs in its own process group and a timeout kills the whole
 * group: killing only the first process leaves the download running on its own.
 *
 * The update's temporary files go in one scratch directory the watchdog owns
 * (`TMPDIR`), emptied before and after every run. A run cut short by the watchdog
 * itself stopping is cleared by the next run. On ArcaneOS /tmp is memory, so a
 * leftover download costs RAM until it is removed.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('node:path');

const CLOUDUI_UPDATE_TIMEOUT_MS = 10 * 60 * 1000;
const CLOUDUI_SCRATCH_DIR = path.join(os.tmpdir(), 'fluxwatchdog-cloudui');
const MAX_OUTPUT_CHARS = 4000;

function clearScratch(scratchDir) {
  fs.rmSync(scratchDir, { recursive: true, force: true });
}

function killGroup(pid) {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // ESRCH: every process in the group has already exited.
  }
}

/**
 * @param {object} options
 * @param {string} options.fluxOsRootDir - FluxOS checkout the update runs in.
 * @param {string} options.apiBaseUrl - GitHub API host the update reads the release from.
 * @param {number} [options.timeoutMs]
 * @param {string} [options.scratchDir] - Directory given to the update as TMPDIR.
 * @param {string[]} [options.command] - Command and arguments; defaults to the npm script.
 * @returns {Promise<{ok: boolean, timedOut: boolean, code: number|null,
 *   signal: string|null, error: Error|null, output: string}>}
 */
function runCloudUiUpdate({
  fluxOsRootDir,
  apiBaseUrl,
  timeoutMs = CLOUDUI_UPDATE_TIMEOUT_MS,
  scratchDir = CLOUDUI_SCRATCH_DIR,
  command = ['npm', 'run', 'update:cloudui', '--', apiBaseUrl],
}) {
  clearScratch(scratchDir);
  fs.mkdirSync(scratchDir, { recursive: true, mode: 0o700 });

  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let spawnError = null;
    let settled = false;

    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearScratch(scratchDir);
      resolve({
        ok: !timedOut && !spawnError && code === 0,
        timedOut,
        code,
        signal,
        error: spawnError,
        output: output.slice(-MAX_OUTPUT_CHARS),
      });
    };

    const child = spawn(command[0], command.slice(1), {
      cwd: fluxOsRootDir,
      env: { ...process.env, TMPDIR: scratchDir },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const collect = (chunk) => {
      output = (output + chunk).slice(-MAX_OUTPUT_CHARS * 2);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid);
    }, timeoutMs);

    child.on('error', (error) => {
      spawnError = error;
      finish(null, null);
    });
    // Anything the update left running in its group is stopped once the update exits.
    child.on('exit', () => killGroup(child.pid));
    child.on('close', finish);
  });
}

module.exports = { runCloudUiUpdate, CLOUDUI_UPDATE_TIMEOUT_MS, CLOUDUI_SCRATCH_DIR };
