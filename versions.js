const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

/**
 * Compare two versions by semver precedence (semver.org, section 11): the
 * numeric core first, then a pre-release ranks below its release, identifier
 * by identifier. Build metadata is ignored.
 * @param {string} v1
 * @param {string} v2
 * @returns {number} 1, 0 or -1; NaN when either is not a valid semver, so
 *   every ordering test on the result is false.
 */
function compareVersions(v1, v2) {
  const a = SEMVER.exec(String(v1).trim());
  const b = SEMVER.exec(String(v2).trim());
  if (!a || !b) return NaN;
  for (let i = 1; i <= 3; i += 1) {
    const d = Number(a[i]) - Number(b[i]);
    if (d !== 0) return Math.sign(d);
  }
  if (!a[4] || !b[4]) return (a[4] ? -1 : 0) + (b[4] ? 1 : 0);
  const pa = a[4].split('.');
  const pb = b[4].split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    const na = /^\d+$/.test(pa[i]);
    const nb = /^\d+$/.test(pb[i]);
    if (na && nb) {
      const d = Number(pa[i]) - Number(pb[i]);
      if (d !== 0) return Math.sign(d);
    } else if (na !== nb) {
      return na ? -1 : 1;
    } else if (pa[i] !== pb[i]) {
      return pa[i] < pb[i] ? -1 : 1;
    }
  }
  return 0;
}

module.exports = { compareVersions };
