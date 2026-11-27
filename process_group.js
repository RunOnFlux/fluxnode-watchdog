/**
 * Runs a command in its own process group, with a timeout that stops the whole group.
 *
 * A timeout sends the group SIGTERM, so the command can remove its own files, and SIGKILL
 * once the grace period has passed: signalling only the first process leaves its children
 * (npm's installs, a download) running on their own. Anything the command leaves running in
 * its group is stopped once it exits.
 */

const { spawn } = require('child_process');

const DEFAULT_GRACE_MS = 10 * 1000;
const MAX_OUTPUT_CHARS = 4000;

function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    // ESRCH: every process in the group has already exited.
  }
}

/**
 * @param {object} options
 * @param {string[]} options.command - Command and arguments.
 * @param {string} [options.cwd]
 * @param {object} [options.env] - The whole environment the command runs with.
 * @param {number} options.timeoutMs
 * @param {number} [options.graceMs] - Time from SIGTERM to SIGKILL after a timeout.
 * @returns {Promise<{ok: boolean, timedOut: boolean, timeoutMs: number, code: number|null,
 *   signal: string|null, error: Error|null, output: string}>}
 */
function runProcessGroup({
  command,
  cwd,
  env = process.env,
  timeoutMs,
  graceMs = DEFAULT_GRACE_MS,
}) {
  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let spawnError = null;
    let settled = false;
    let timer = null;
    let graceTimer = null;

    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      resolve({
        ok: !timedOut && !spawnError && code === 0,
        timedOut,
        timeoutMs,
        code,
        signal,
        error: spawnError,
        output: output.slice(-MAX_OUTPUT_CHARS),
      });
    };

    const child = spawn(command[0], command.slice(1), {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const collect = (chunk) => {
      output = (output + chunk).slice(-MAX_OUTPUT_CHARS * 2);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    timer = setTimeout(() => {
      timedOut = true;
      signalGroup(child.pid, 'SIGTERM');
      graceTimer = setTimeout(() => signalGroup(child.pid, 'SIGKILL'), graceMs);
    }, timeoutMs);

    child.on('error', (error) => {
      spawnError = error;
      finish(null, null);
    });
    // After a timeout the group is still removing its files, and the grace timer stops it.
    child.on('exit', () => {
      if (!timedOut) signalGroup(child.pid, 'SIGKILL');
    });
    child.on('close', finish);
  });
}

/**
 * A duration in the largest whole unit that states it exactly.
 * @param {number} ms
 * @returns {string}
 */
function duration(ms) {
  const units = [
    [3_600_000, 'hour'],
    [60_000, 'minute'],
    [1_000, 'second'],
  ];
  const [size, name] = units.find(([unit]) => ms >= unit && ms % unit === 0) || [1, 'millisecond'];
  const count = ms / size;

  return `${count} ${name}${count === 1 ? '' : 's'}`;
}

/**
 * Why a run that did not succeed failed, for the log.
 * @param {{timedOut: boolean, timeoutMs: number, error: Error|null, signal: string|null,
 *   code: number|null}} result
 * @returns {string}
 */
function failureReason(result) {
  if (result.timedOut) return `timed out after ${duration(result.timeoutMs)}`;
  if (result.error) return result.error.message;
  if (result.signal) return `killed by ${result.signal}`;

  return `exited with code ${result.code}`;
}

module.exports = { runProcessGroup, failureReason, DEFAULT_GRACE_MS };
