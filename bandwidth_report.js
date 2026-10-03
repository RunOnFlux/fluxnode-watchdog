/**
 * What to report about a node's bandwidth figure on this check.
 *
 * fluxbench marks `unmeasured` in getbenchmarks when a cycle ends with no
 * bandwidth figure and nothing stored to stand in for it. Such a node still
 * reports its tier, but fluxbench refuses its confirmations until a speedtest
 * succeeds. The state is reported once when it starts and once when it clears;
 * a check that could not read getbenchmarks changes nothing.
 *
 * @param {boolean | undefined} unmeasured - getbenchmarks' marker, undefined when unread.
 * @param {boolean} reported - Whether the unmeasured state has been reported.
 * @returns {'unmeasured' | 'measured' | null} The report to send, if any.
 */
function bandwidthReport(unmeasured, reported) {
  if (unmeasured === true && !reported) return 'unmeasured';
  if (unmeasured === false && reported) return 'measured';
  return null;
}

module.exports = { bandwidthReport };
