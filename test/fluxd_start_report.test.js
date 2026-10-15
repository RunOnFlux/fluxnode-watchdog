const test = require('node:test');
const assert = require('node:assert');

const { fluxdStartReport, SLOW_START_MS } = require('../fluxd_start_report');

const starting = { state: 'starting', phase: 'Rescanning...' };
const running = { state: 'running', height: 3027644 };
const dead = { state: 'dead' };
const fresh = { since: null, reported: false };

test('a start is timed from the first check that sees it', () => {
  assert.deepStrictEqual(fluxdStartReport(starting, fresh, 1000), {
    since: 1000,
    reported: false,
    report: null,
  });
});

test('a start shorter than the limit is not reported', () => {
  const record = { since: 1000, reported: false };
  assert.deepStrictEqual(fluxdStartReport(starting, record, 1000 + SLOW_START_MS - 1), {
    since: 1000,
    reported: false,
    report: null,
  });
  assert.deepStrictEqual(fluxdStartReport(running, record, 1000 + SLOW_START_MS - 1), {
    since: null,
    reported: false,
    report: null,
  });
});

test('a start past the limit is reported once', () => {
  const first = fluxdStartReport(starting, { since: 1000, reported: false }, 1000 + SLOW_START_MS);
  assert.deepStrictEqual(first, { since: 1000, reported: true, report: 'slow' });
  const second = fluxdStartReport(starting, first, 1000 + 2 * SLOW_START_MS);
  assert.deepStrictEqual(second, { since: 1000, reported: true, report: null });
});

test('fluxd answering after a reported start is reported once', () => {
  const answered = fluxdStartReport(
    running,
    { since: 1000, reported: true },
    1000 + 2 * SLOW_START_MS,
  );
  assert.deepStrictEqual(answered, { since: null, reported: false, report: 'started' });
  assert.deepStrictEqual(fluxdStartReport(running, answered, 1000 + 3 * SLOW_START_MS), {
    since: null,
    reported: false,
    report: null,
  });
});

test('a fluxd that stops answering is left to the crash check', () => {
  assert.deepStrictEqual(
    fluxdStartReport(dead, { since: 1000, reported: true }, 1000 + 2 * SLOW_START_MS),
    { since: null, reported: false, report: null },
  );
  assert.deepStrictEqual(fluxdStartReport(dead, fresh, 1000), {
    since: null,
    reported: false,
    report: null,
  });
});
