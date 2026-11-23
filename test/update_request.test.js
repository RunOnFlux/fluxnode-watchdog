const test = require('node:test');
const assert = require('node:assert');

const { createUpdateRequest, updateDue } = require('../update_request');

test('an update check asked for runs at the next pass, once', () => {
  const request = createUpdateRequest();
  assert.strictEqual(updateDue(request, 7, 120), false);
  request.ask();
  assert.strictEqual(updateDue(request, 8, 120), true);
  assert.strictEqual(updateDue(request, 9, 120), false);
});

test('asking twice before a pass gives one check', () => {
  const request = createUpdateRequest();
  request.ask();
  request.ask();
  assert.strictEqual(updateDue(request, 3, 120), true);
  assert.strictEqual(updateDue(request, 4, 120), false);
});

test('the schedule runs the check when it comes round, asked for or not', () => {
  const request = createUpdateRequest();
  assert.strictEqual(updateDue(request, 120, 120), true);
  request.ask();
  assert.strictEqual(updateDue(request, 240, 120), true);
  assert.strictEqual(updateDue(request, 241, 120), false);
});
