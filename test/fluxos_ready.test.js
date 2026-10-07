const test = require('node:test');
const assert = require('node:assert');

const { waitForFluxOs } = require('../fluxos_ready');

// A clock that only moves when the hold sleeps.
function fakeClock() {
  let t = 0;
  const slept = [];
  return {
    now: () => t,
    sleep: async (ms) => { slept.push(ms); t += ms; },
    slept,
  };
}

test('goes on at once when FluxOS answers', async () => {
  const clock = fakeClock();
  const result = await waitForFluxOs(async () => true, { ...clock, maxWaitMs: 1000, pollMs: 10 });
  assert.deepStrictEqual(result, { answered: true, waitedMs: 0 });
  assert.deepStrictEqual(clock.slept, []);
});

test('polls until FluxOS answers', async () => {
  const clock = fakeClock();
  let asks = 0;
  const answers = async () => { asks += 1; return asks === 3; };
  const result = await waitForFluxOs(answers, { ...clock, maxWaitMs: 1000, pollMs: 10 });
  assert.deepStrictEqual(result, { answered: true, waitedMs: 20 });
  assert.deepStrictEqual(clock.slept, [10, 10]);
});

test('gives up after the longest wait and says so', async () => {
  const clock = fakeClock();
  const result = await waitForFluxOs(async () => false, { ...clock, maxWaitMs: 50, pollMs: 10 });
  assert.deepStrictEqual(result, { answered: false, waitedMs: 50 });
  assert.strictEqual(clock.slept.length, 5);
});
