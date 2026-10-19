/**
 * What `apt-get -s install <pkg>` would do, read from its output.
 *
 * The simulation prints one line per action: `Inst <pkg> [<installed>] (<new> ...)`,
 * `Remv <pkg> [<installed>]` and `Conf ...`. A package whose dependencies apt
 * cannot meet (one released before the package it depends on) makes apt print
 * the unmet dependencies and exit non-zero.
 * @param {{error: Error|null, stdout: string, stderr: string}} result - the simulation's run
 * @param {string} pkg - the package asked for
 * @returns {{installable: boolean, installs: Object<string, string>, removes: string[], reason: string}}
 *   `installable` only when apt would install `pkg` and remove nothing; `reason`
 *   says why not, and is '' when it is.
 */
function aptInstallPlan(result, pkg) {
  const installs = {};
  const removes = [];
  for (const line of (result.stdout || '').split('\n')) {
    const inst = /^Inst (\S+) (?:\[[^\]]*\] )?\((\S+)/.exec(line);
    if (inst) installs[inst[1]] = inst[2];
    const remv = /^Remv (\S+)/.exec(line);
    if (remv) removes.push(remv[1]);
  }

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
  } else if (!installs[pkg]) {
    reason = `apt would not install ${pkg}`;
  }
  return { installable: reason === '', installs, removes, reason };
}

module.exports = { aptInstallPlan };
