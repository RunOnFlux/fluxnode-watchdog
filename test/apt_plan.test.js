const test = require('node:test');
const assert = require('node:assert');

const { aptInstallPlan } = require('../apt_plan');

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
  const plan = aptInstallPlan({ error: null, stdout: BOTH_PUBLISHED, stderr: '' }, 'flux');
  assert.strictEqual(plan.installable, true);
  assert.strictEqual(plan.reason, '');
  assert.deepStrictEqual(plan.installs, { fluxbench: '6.5.0', flux: '9.2.0' });
  assert.deepStrictEqual(plan.removes, []);
});

test('a release whose dependency is not out yet is not installable', () => {
  const plan = aptInstallPlan({ error: exit100, stdout: UNMET, stderr: '' }, 'flux');
  assert.strictEqual(plan.installable, false);
  assert.match(plan.reason, /Depends: fluxbench \(>= 6\.5\.0\)/);
});

test('an install that would remove a package is not installable', () => {
  const plan = aptInstallPlan({ error: null, stdout: REMOVES, stderr: '' }, 'flux');
  assert.strictEqual(plan.installable, false);
  assert.deepStrictEqual(plan.removes, ['fluxbench']);
  assert.match(plan.reason, /remove fluxbench/);
});

test('a plan that does not install the package asked for is not installable', () => {
  const stdout = `${SIMULATION}0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n`;
  const plan = aptInstallPlan({ error: null, stdout, stderr: '' }, 'flux');
  assert.strictEqual(plan.installable, false);
  assert.match(plan.reason, /would not install flux/);
});

test('apt failing without naming a dependency gives its last error line', () => {
  const stderr = 'E: Could not get lock /var/lib/dpkg/lock-frontend\n';
  const plan = aptInstallPlan({ error: exit100, stdout: '', stderr }, 'flux');
  assert.strictEqual(plan.installable, false);
  assert.strictEqual(
    plan.reason,
    'apt refused it: E: Could not get lock /var/lib/dpkg/lock-frontend',
  );
});
