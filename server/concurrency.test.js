const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mapWithConcurrency } = require('./concurrency.js');

test('preserves input order in the results regardless of completion order', async () => {
  const delays = [30, 10, 20, 5];
  const results = await mapWithConcurrency(delays, 2, (ms) => new Promise((resolve) => setTimeout(() => resolve(ms), ms)));
  assert.deepEqual(results, delays);
});

test('never runs more than `limit` tasks concurrently', async () => {
  let active = 0;
  let maxActive = 0;
  const items = Array.from({ length: 10 }, (_, i) => i);

  await mapWithConcurrency(items, 3, async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
  });

  assert.ok(maxActive <= 3, `expected max concurrency <= 3, got ${maxActive}`);
});

test('with limit >= items.length, runs everything in parallel', async () => {
  const items = [1, 2, 3];
  const start = Date.now();
  await mapWithConcurrency(items, 10, () => new Promise((resolve) => setTimeout(resolve, 20)));
  assert.ok(Date.now() - start < 60, 'expected all three ~20ms tasks to overlap, not run serially');
});

test('empty input resolves to an empty array without spawning workers', async () => {
  const results = await mapWithConcurrency([], 4, () => {
    throw new Error('should never be called');
  });
  assert.deepEqual(results, []);
});
