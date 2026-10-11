const test = require('node:test');
const assert = require('node:assert');

const { fluxosUnitStarting } = require('../fluxos_state');

// `systemctl show fluxos.service -p ActiveState -p Job` output, as systemd prints it.
const show = (state, job = '') => ({ stdout: `ActiveState=${state}\nJob=${job}\n` });

test('an activating unit is starting', () => {
  assert.strictEqual(fluxosUnitStarting(show('activating', '4648')), true);
  assert.strictEqual(fluxosUnitStarting(show('activating')), true);
});

test('an inactive unit with a queued job is starting', () => {
  assert.strictEqual(fluxosUnitStarting(show('inactive', '4785')), true);
});

test('an inactive unit with no job is not starting', () => {
  assert.strictEqual(fluxosUnitStarting(show('inactive')), false);
});

test('an active unit is not starting, with or without a job', () => {
  assert.strictEqual(fluxosUnitStarting(show('active')), false);
  assert.strictEqual(fluxosUnitStarting(show('active', '5001')), false);
});

test('any other state is not starting', () => {
  for (const state of ['failed', 'deactivating', 'activ', '']) {
    assert.strictEqual(fluxosUnitStarting(show(state, '5001')), false, state);
  }
  assert.strictEqual(fluxosUnitStarting({ stdout: '' }), false);
  assert.strictEqual(fluxosUnitStarting(), false);
});
