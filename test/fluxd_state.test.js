const test = require('node:test');
const assert = require('node:assert');

const { fluxdState } = require('../fluxd_state');

// flux-cli's output for a fluxd in each state, as it prints it.
const warmup = (phase) => ({ stdout: '', stderr: `error code: -28\nerror message:\n${phase}\n` });

test('a block height means fluxd is running', () => {
  assert.deepStrictEqual(fluxdState({ stdout: '2998707\n', stderr: '' }), { state: 'running', height: 2998707 });
});

test('error -28 means fluxd is starting, at the step it names', () => {
  for (const phase of ['Loading block index...', 'Verifying blocks...', 'Activating best chain...']) {
    assert.deepStrictEqual(fluxdState(warmup(phase)), { state: 'starting', phase });
  }
});

test('no answer means fluxd is dead', () => {
  assert.deepStrictEqual(
    fluxdState({ stdout: '', stderr: 'error: couldn\'t connect to server: unknown (code -1)\n' }),
    { state: 'dead' },
  );
  assert.deepStrictEqual(fluxdState({ stdout: '', stderr: '' }), { state: 'dead' });
  assert.deepStrictEqual(fluxdState(), { state: 'dead' });
});

test('an RPC error other than -28 means fluxd is dead', () => {
  assert.deepStrictEqual(
    fluxdState({ stdout: '', stderr: 'error code: -1\nerror message:\nInternal error\n' }),
    { state: 'dead' },
  );
  assert.deepStrictEqual(
    fluxdState({ stdout: '', stderr: 'error code: -280\nerror message:\nLoading block index...\n' }),
    { state: 'dead' },
  );
});
