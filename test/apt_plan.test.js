const test = require('node:test');
const assert = require('node:assert');

const { simulateInstallCommand, aptInstallPlan, updateServices } = require('../apt_plan');

// apt-get -s output captured from apt on Ubuntu 26.04, a local repository and
// an installed flux 9.1.0 and fluxbench 6.3.1.
const SIMULATION = `NOTE: This is only a simulation!
      apt-get needs root privileges for real execution.
Reading package lists...
Building dependency tree...
Reading state information...
`;

const BOTH_PUBLISHED = `${SIMULATION}The following additional packages will be installed:
  fluxbench
The following packages will be upgraded:
  flux fluxbench
2 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.
Inst fluxbench [6.3.1] (6.5.0 localhost [amd64]) []
Inst flux [9.1.0] (9.2.0 localhost [amd64])
Conf fluxbench (6.5.0 localhost [amd64])
Conf flux (9.2.0 localhost [amd64])
`;

const UNMET = `${SIMULATION}Some packages could not be installed. This may mean that you have
requested an impossible situation or if you are using the unstable
distribution that some required packages have not yet been created
or been moved out of Incoming.
The following information may help to resolve the situation:

The following packages have unmet dependencies:
 flux : Depends: fluxbench (>= 6.5.0) but 6.3.1 is to be installed
E: Unable to satisfy dependencies. Reached two conflicting assignments:
`;

const REMOVES = `${SIMULATION}The following packages will be REMOVED:
  fluxbench
The following packages will be upgraded:
  flux
1 upgraded, 0 newly installed, 1 to remove and 0 not upgraded.
Remv fluxbench [6.3.1]
Inst flux [9.1.0] (9.2.0 localhost [amd64])
Conf flux (9.2.0 localhost [amd64])
`;

const exit100 = Object.assign(new Error('Command failed: apt-get -s install flux'), { code: 100 });

test('both released: installable, and both are installed together', () => {
  const plan = aptInstallPlan({ error: null, stdout: BOTH_PUBLISHED, stderr: '' }, ['flux']);
  assert.strictEqual(plan.installable, true);
  assert.strictEqual(plan.reason, '');
  assert.deepStrictEqual(plan.installs, { fluxbench: '6.5.0', flux: '9.2.0' });
  assert.deepStrictEqual(plan.removes, []);
});

test('packages asked for together are installable when apt installs every one', () => {
  const plan = aptInstallPlan(ok(BOTH_PUBLISHED), ['flux', 'fluxbench']);
  assert.strictEqual(plan.installable, true);
  assert.deepStrictEqual(plan.installs, { fluxbench: '6.5.0', flux: '9.2.0' });
});

test('packages asked for together are not installable when apt leaves one out', () => {
  const plan = aptInstallPlan(ok(FLUX_ALONE), ['flux', 'fluxbench']);
  assert.strictEqual(plan.installable, false);
  assert.strictEqual(plan.reason, 'apt would not install fluxbench');
});

test('a release whose dependency is not out yet is not installable', () => {
  const plan = aptInstallPlan({ error: exit100, stdout: UNMET, stderr: '' }, ['flux']);
  assert.strictEqual(plan.installable, false);
  assert.match(plan.reason, /Depends: fluxbench \(>= 6\.5\.0\)/);
});

test('an install that would remove a package is not installable', () => {
  const plan = aptInstallPlan({ error: null, stdout: REMOVES, stderr: '' }, ['flux']);
  assert.strictEqual(plan.installable, false);
  assert.deepStrictEqual(plan.removes, ['fluxbench']);
  assert.match(plan.reason, /remove fluxbench/);
});

test('a plan that does not install the package asked for is not installable', () => {
  const stdout = `${SIMULATION}0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n`;
  const plan = aptInstallPlan({ error: null, stdout, stderr: '' }, ['flux']);
  assert.strictEqual(plan.installable, false);
  assert.match(plan.reason, /would not install flux/);
});

test('apt failing without naming a dependency gives its last error line', () => {
  const stderr = 'E: Could not get lock /var/lib/dpkg/lock-frontend\n';
  const plan = aptInstallPlan({ error: exit100, stdout: '', stderr }, ['flux']);
  assert.strictEqual(plan.installable, false);
  assert.strictEqual(
    plan.reason,
    'apt refused it: E: Could not get lock /var/lib/dpkg/lock-frontend',
  );
});

const ARCANE = { isArcane: true, fluxdServiceName: 'fluxd.service' };
const LEGACY = { isArcane: false, fluxdServiceName: 'zelcash.service' };
const ok = (stdout) => ({ error: null, stdout, stderr: '' });
const FLUX_ALONE = `${SIMULATION}The following packages will be upgraded:
  flux
1 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.
Inst flux [9.1.0] (9.1.1 localhost [amd64])
Conf flux (9.1.1 localhost [amd64])
`;

test('on ArcaneOS an install of flux alone restarts fluxd only', () => {
  assert.deepStrictEqual(updateServices(aptInstallPlan(ok(FLUX_ALONE), ['flux']), ARCANE), {
    stop: [['stop', 'fluxd.service']],
    start: [['start', '--no-block', 'fluxd.service']],
  });
});

test('on ArcaneOS an install that upgrades fluxbench restarts fluxbenchd and starts FluxOS, whichever package was asked for', () => {
  for (const pkgs of [['flux'], ['fluxbench'], ['flux', 'fluxbench']]) {
    assert.deepStrictEqual(
      updateServices(aptInstallPlan(ok(BOTH_PUBLISHED), pkgs), ARCANE),
      {
        stop: [
          ['stop', 'fluxd.service'],
          ['stop', 'fluxbenchd.service'],
        ],
        start: [
          ['start', 'fluxbenchd.service'],
          ['start', '--no-block', 'fluxos.service'],
          ['start', '--no-block', 'fluxd.service'],
        ],
      },
      pkgs.join(' '),
    );
  }
});

test("on a legacy node every install restarts fluxd's service only", () => {
  for (const [stdout, pkgs] of [
    [FLUX_ALONE, ['flux']],
    [BOTH_PUBLISHED, ['flux']],
    [BOTH_PUBLISHED, ['fluxbench']],
    [BOTH_PUBLISHED, ['flux', 'fluxbench']],
  ]) {
    assert.deepStrictEqual(
      updateServices(aptInstallPlan(ok(stdout), pkgs), LEGACY),
      {
        stop: [['stop', 'zelcash.service']],
        start: [['start', '--no-block', 'zelcash.service']],
      },
      pkgs.join(' '),
    );
  }
});

test("the simulation runs in the C locale, so apt's messages are read the same on every node", () => {
  assert.strictEqual(
    simulateInstallCommand(['flux']),
    'LC_ALL=C apt-get -s install flux < /dev/null',
  );
});

test('packages installed together are simulated in one run', () => {
  assert.strictEqual(
    simulateInstallCommand(['flux', 'fluxbench']),
    'LC_ALL=C apt-get -s install flux fluxbench < /dev/null',
  );
});
