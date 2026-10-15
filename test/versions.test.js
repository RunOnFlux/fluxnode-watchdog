const test = require('node:test');
const assert = require('node:assert');

const { compareVersions } = require('../versions');

// The apt pool lists the release number; dpkg reports the installed package's
// full version, which a build from a commit carries as build metadata.
test('build metadata does not make a version newer', () => {
  assert.strictEqual(compareVersions('9.1.0', '9.1.0+4cdfe2b83'), 0);
  assert.strictEqual(compareVersions('9.1.0+4cdfe2b83', '9.1.0'), 0);
});

test('a remote behind the installed version is not an update', () => {
  assert.strictEqual(compareVersions('6.3.1', '6.5.0'), -1);
  assert.ok(!(compareVersions('6.3.1', '6.5.0') > 0));
});

test('a remote ahead of the installed version is an update', () => {
  assert.strictEqual(compareVersions('6.5.1', '6.5.0'), 1);
  assert.strictEqual(compareVersions('8.10.0', '8.9.1'), 1);
});

test('a pre-release ranks below its release', () => {
  assert.strictEqual(compareVersions('1.0.0-rc.1', '1.0.0'), -1);
  assert.strictEqual(compareVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1);
  assert.strictEqual(compareVersions('1.0.0-beta.2', '1.0.0-beta.11'), -1);
});

test('an unreadable version never orders', () => {
  for (const bad of ['', null, undefined, '8.18', '08.1.0', 'null']) {
    assert.ok(Number.isNaN(compareVersions(bad, '1.0.0')));
    assert.ok(!(compareVersions(bad, '1.0.0') > 0));
    assert.ok(!(compareVersions('1.0.0', bad) > 0));
  }
});
