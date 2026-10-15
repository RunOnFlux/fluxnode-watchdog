/**
 * What a `getblockcount` call through flux-cli says about fluxd.
 *
 * fluxd answers every RPC with error -28 from the moment it starts until it has
 * loaded its chain, naming the step it is on. Any failure while it starts makes
 * it exit, so a fluxd that will not come up gives no answer at all.
 *
 * @param {{stdout?: string, stderr?: string}} result - The flux-cli call's output.
 * @returns {{state: 'running', height: number}
 *   | {state: 'starting', phase: string}
 *   | {state: 'dead'}}
 */
function fluxdState({ stdout = '', stderr = '' } = {}) {
  const height = stdout.trim();
  if (/^\d+$/.test(height)) {
    return { state: 'running', height: Number(height) };
  }
  const warmup = stderr.match(/^error code: -28\s*\nerror message:\s*\n([\s\S]*)$/m);
  if (warmup) {
    return { state: 'starting', phase: warmup[1].trim() };
  }
  return { state: 'dead' };
}

module.exports = { fluxdState };
