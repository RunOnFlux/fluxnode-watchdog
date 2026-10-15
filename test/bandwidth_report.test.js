const test = require('node:test');
const assert = require('node:assert');

const { bandwidthReport } = require('../bandwidth_report');

test('an unmeasured node is reported once', () => {
  assert.strictEqual(bandwidthReport(true, false), 'unmeasured');
  assert.strictEqual(bandwidthReport(true, true), null);
});

test('a measurement after a report is reported once', () => {
  assert.strictEqual(bandwidthReport(false, true), 'measured');
  assert.strictEqual(bandwidthReport(false, false), null);
});

test('a check that could not read getbenchmarks reports nothing', () => {
  assert.strictEqual(bandwidthReport(undefined, true), null);
  assert.strictEqual(bandwidthReport(undefined, false), null);
});
