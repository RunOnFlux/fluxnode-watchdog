/**
 * The hold before the watchdog's first check.
 *
 * The watchdog starts with the stack, and FluxOS can still be coming up: on
 * Arcane it is a notify unit that is activating until its API listens, under
 * pm2 it is simply slower than the watchdog. A FluxOS judged before it has
 * answered once would be restarted for starting.
 */

const DEFAULT_MAX_WAIT_MS = 5 * 60 * 1000;
const DEFAULT_POLL_MS = 10 * 1000;

const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Waits until `answers()` resolves true, or `maxWaitMs` have passed.
 * @param {() => Promise<boolean>} answers - Whether FluxOS's API answered.
 * @param {{now?: () => number, sleep?: (ms: number) => Promise<void>,
 *   maxWaitMs?: number, pollMs?: number}} [options]
 * @returns {Promise<{answered: boolean, waitedMs: number}>}
 */
async function waitForFluxOs(answers, {
  now = Date.now, sleep = defaultSleep, maxWaitMs = DEFAULT_MAX_WAIT_MS, pollMs = DEFAULT_POLL_MS,
} = {}) {
  const start = now();
  for (;;) {
    if (await answers()) return { answered: true, waitedMs: now() - start };
    if (now() - start >= maxWaitMs) return { answered: false, waitedMs: now() - start };
    await sleep(pollMs);
  }
}

module.exports = { waitForFluxOs, DEFAULT_MAX_WAIT_MS, DEFAULT_POLL_MS };
