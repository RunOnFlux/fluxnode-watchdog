const test = require('node:test');
const assert = require('node:assert');

const { fluxosUnitStarting } = require('../fluxos_state');

test('an activating unit is starting', () => {
  assert.strictEqual(fluxosUnitStarting({ stdout: 'activating\n' }), true);
});

test('any other state is not', () => {
  for (const stdout of ['active\n', 'inactive\n', 'failed\n', 'deactivating\n', '', 'activ']) {
    assert.strictEqual(fluxosUnitStarting({ stdout }), false, stdout);
  }
  assert.strictEqual(fluxosUnitStarting(), false);
});
