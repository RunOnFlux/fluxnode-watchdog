const test = require('node:test');
const assert = require('node:assert');

const { fluxdChain, syncCheckApplies, runSyncCheck } = require('../fluxd_chain');

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

// One cycle of runSyncCheck with a fixed roll and fluxd answering `answer`;
// returns what the cycle did.
async function cycle(rollValue, answer) {
  const done = { asked: 0, checked: 0, logs: [] };
  await runSyncCheck({
    roll: () => rollValue,
    readChainInfo: async () => {
      done.asked += 1;
      return answer;
    },
    checkSync: async () => {
      done.checked += 1;
    },
    log: (line) => done.logs.push(line),
  });
  return done;
}

test('a cycle that rolls a skip does not ask fluxd or run the check', async () => {
  for (const rollValue of [1, 2]) {
    const done = await cycle(rollValue, info('main'));
    assert.strictEqual(done.asked, 0);
    assert.strictEqual(done.checked, 0);
    assert.deepStrictEqual(done.logs, [`Sync check skipped: ${rollValue} <= 2`]);
  }
});

test('a cycle that rolls the check runs it on mainnet', async () => {
  for (const rollValue of [3, 4]) {
    const done = await cycle(rollValue, info('main'));
    assert.strictEqual(done.asked, 1);
    assert.strictEqual(done.checked, 1);
    assert.deepStrictEqual(done.logs, []);
  }
});

test('on another chain the check does not run and the log says why', async () => {
  const done = await cycle(3, info('labnet'));
  assert.strictEqual(done.checked, 0);
  assert.deepStrictEqual(done.logs, [
    'Sync check off: the explorers it compares with serve mainnet, and fluxd is on labnet',
  ]);
});

test('when fluxd gives no chain the check does not run', async () => {
  const done = await cycle(3, { stdout: "error: couldn't connect to server: unknown (code -1)" });
  assert.strictEqual(done.asked, 1);
  assert.strictEqual(done.checked, 0);
  assert.deepStrictEqual(done.logs, []);
});

test('a fluxd restarted on another chain is followed at the next check', async () => {
  assert.strictEqual((await cycle(3, info('test'))).checked, 0);
  assert.strictEqual((await cycle(3, info('main'))).checked, 1);
  assert.strictEqual((await cycle(3, info('test'))).checked, 0);
});
