/**
 * The simulation aptInstallPlan reads. It runs in the C locale, so apt's
 * messages, which aptInstallPlan matches, are the same on every node.
 * @param {string[]} pkgs - the packages installed together
 * @returns {string} shell command
 */
function simulateInstallCommand(pkgs) {
  return `LC_ALL=C apt-get -s install ${pkgs.join(' ')} < /dev/null`;
}

/**
 * What `apt-get -s install <pkgs>` would do, read from its output.
 *
 * The simulation prints one line per action: `Inst <pkg> [<installed>] (<new> ...)`,
 * `Remv <pkg> [<installed>]` and `Conf ...`. A package whose dependencies apt
 * cannot meet (one released before the package it depends on) makes apt print
 * the unmet dependencies and exit non-zero.
 * @param {{error: Error|null, stdout: string, stderr: string}} result - the simulation's run
 * @param {string[]} pkgs - the packages asked for
 * @returns {{installable: boolean, installs: Object<string, string>, removes: string[], reason: string}}
 *   `installable` only when apt would install every package in `pkgs` and
 *   remove nothing; `reason` says why not, and is '' when it is.
 */
function aptInstallPlan(result, pkgs) {
  const installs = {};
  const removes = [];
  for (const line of (result.stdout || '').split('\n')) {
    const inst = /^Inst (\S+) (?:\[[^\]]*\] )?\((\S+)/.exec(line);
    if (inst) installs[inst[1]] = inst[2];
    const remv = /^Remv (\S+)/.exec(line);
    if (remv) removes.push(remv[1]);
  }

  const missing = pkgs.filter((pkg) => !installs[pkg]);
  let reason = '';
  if (result.error) {
    const unmet = (result.stdout + result.stderr)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /Depends:|Breaks:|Conflicts:/.test(l));
    reason = unmet.length
      ? `apt cannot meet its dependencies: ${unmet.join('; ')}`
      : `apt refused it: ${(result.stderr || result.error.message).trim().split('\n').pop()}`;
  } else if (removes.length) {
    reason = `apt would remove ${removes.join(', ')}`;
  } else if (missing.length) {
    reason = `apt would not install ${missing.join(', ')}`;
  }
  return { installable: reason === '', installs, removes, reason };
}

/**
 * The systemctl calls around an install of `plan`, stops before it and starts
 * after it, in order. fluxd is always restarted. On ArcaneOS fluxbenchd is its
 * own service, so an install that upgrades fluxbench, whichever package was
 * asked for, also restarts fluxbenchd and starts FluxOS, which an image that
 * requires fluxbenchd stops with it. Elsewhere starting fluxd's service starts
 * fluxbenchd.
 * @param {{installs: Object<string, string>}} plan - from aptInstallPlan
 * @param {{isArcane: boolean, fluxdServiceName: string}} node
 * @returns {{stop: string[][], start: string[][]}} systemctl arguments
 */
function updateServices(plan, { isArcane, fluxdServiceName }) {
  const fluxbench = isArcane && Boolean(plan.installs.fluxbench);
  const stop = [['stop', fluxdServiceName]];
  const start = [];
  if (fluxbench) {
    stop.push(['stop', 'fluxbenchd.service']);
    start.push(['start', 'fluxbenchd.service'], ['start', '--no-block', 'fluxos.service']);
  }
  start.push(['start', '--no-block', fluxdServiceName]);

  return { stop, start };
}

module.exports = { simulateInstallCommand, aptInstallPlan, updateServices };
