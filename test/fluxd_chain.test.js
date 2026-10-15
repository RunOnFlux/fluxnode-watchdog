const test = require('node:test');
const assert = require('node:assert');

const { fluxdChain, syncCheckApplies } = require('../fluxd_chain');

// `flux-cli getblockchaininfo` output, trimmed to the fields around `chain`.
const info = (chain) => ({ stdout: JSON.stringify({ chain, blocks: 9569, headers: 9569 }) });

test('the chain is read from getblockchaininfo', () => {
  for (const chain of ['main', 'test', 'labnet', 'regtest']) {
    assert.strictEqual(fluxdChain(info(chain)), chain);
  }
});

test('an answer without a chain is unknown, never mainnet', () => {
  for (const result of [
    { stdout: '' },
    { stdout: "error: couldn't connect to server: unknown (code -1)" },
    { stdout: '{"code":-28,"message":"Loading block index..."}' },
    { stdout: JSON.stringify({ chain: '' }) },
    { stdout: JSON.stringify({ chain: 1 }) },
    { stdout: 'null' },
    {},
    undefined,
  ]) {
    assert.strictEqual(fluxdChain(result), null, JSON.stringify(result));
  }
});

test('the explorer sync check runs on mainnet only', () => {
  assert.strictEqual(syncCheckApplies('main'), true);
  for (const chain of ['test', 'labnet', 'regtest', null, undefined]) {
    assert.strictEqual(syncCheckApplies(chain), false, String(chain));
  }
});
