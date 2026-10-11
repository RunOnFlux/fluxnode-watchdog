/**
 * What to report about a fluxd that is still starting.
 *
 * fluxd's start takes a minute or two and every failure in it exits. The one
 * step that grows is the wallet rescan, which re-reads the whole chain after
 * `-rescan` on a wallet holding an imported key. A restart starts that rescan
 * again, so a long start is reported, not restarted: once when it passes
 * SLOW_START_MS, and once when fluxd answers again. A fluxd that stops
 * answering is the crash check's to report.
 */

const SLOW_START_MS = 60 * 60 * 1000;

/**
 * @param {{state: 'running'|'starting'|'dead', phase?: string}} fluxd - This check's `fluxdState()`.
 * @param {{since: number|null, reported: boolean}} previous - The previous check's record.
 * @param {number} now - This check's time, in ms.
 * @returns {{since: number|null, reported: boolean, report: 'slow'|'started'|null}}
 *   The record to keep, and the report to send, if any.
 */
function fluxdStartReport(fluxd, { since, reported }, now) {
  if (fluxd.state === 'starting') {
    const start = since === null ? now : since;
    const slow = !reported && now - start >= SLOW_START_MS;
    return { since: start, reported: reported || slow, report: slow ? 'slow' : null };
  }
  return {
    since: null,
    reported: false,
    report: fluxd.state === 'running' && reported ? 'started' : null,
  };
}

module.exports = { fluxdStartReport, SLOW_START_MS };
