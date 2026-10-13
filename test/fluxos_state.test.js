const test = require('node:test');
const assert = require('node:assert');

const { fluxosUnitStarting } = require('../fluxos_state');

// `systemctl show fluxos.service -p ActiveState -p SubState -p Job -p NRestarts`
// output; systemd prints the properties in its own order.
const show = (state, { sub = '', job = '', restarts = '0' } = {}) => ({
  stdout: `NRestarts=${restarts}\nActiveState=${state}\nSubState=${sub}\nJob=${job}\n`,
});

test('a first attempt that is activating is starting', () => {
  for (const sub of ['start-pre', 'start', 'start-post']) {
    assert.strictEqual(fluxosUnitStarting(show('activating', { sub })), true, sub);
  }
  assert.strictEqual(fluxosUnitStarting(show('activating', { sub: 'start', job: '4648' })), true);
});

test('a unit waiting for systemd to restart it is not starting', () => {
  for (const sub of ['auto-restart', 'auto-restart-queued']) {
    for (const restarts of ['0', '3']) {
      assert.strictEqual(fluxosUnitStarting(show('activating', { sub, restarts })), false, `${sub} ${restarts}`);
    }
  }
});

test('an attempt systemd made after a failure is not starting', () => {
  assert.strictEqual(fluxosUnitStarting(show('activating', { sub: 'start', restarts: '1' })), false);
  assert.strictEqual(fluxosUnitStarting(show('activating', { sub: 'start-pre', restarts: '12' })), false);
});

test('an activating unit without a restart count is not starting', () => {
  assert.strictEqual(fluxosUnitStarting(show('activating', { sub: 'start', restarts: '' })), false);
  assert.strictEqual(fluxosUnitStarting({ stdout: 'ActiveState=activating\nSubState=start\n' }), false);
});

test('an inactive unit with a queued job is starting', () => {
  assert.strictEqual(fluxosUnitStarting(show('inactive', { sub: 'dead', job: '4785' })), true);
  assert.strictEqual(fluxosUnitStarting(show('inactive', { sub: 'dead', job: '4785', restarts: '2' })), true);
});

test('an inactive unit with no job is not starting', () => {
  assert.strictEqual(fluxosUnitStarting(show('inactive', { sub: 'dead' })), false);
});

test('an active unit is not starting, with or without a job', () => {
  assert.strictEqual(fluxosUnitStarting(show('active', { sub: 'running' })), false);
  assert.strictEqual(fluxosUnitStarting(show('active', { sub: 'running', job: '5001' })), false);
});

test('any other state is not starting', () => {
  for (const state of ['failed', 'deactivating', 'activ', '']) {
    assert.strictEqual(fluxosUnitStarting(show(state, { sub: 'start', job: '5001' })), false, state);
  }
  assert.strictEqual(fluxosUnitStarting({ stdout: '' }), false);
  assert.strictEqual(fluxosUnitStarting(), false);
});
