const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planAspectFit } = require('./aspect_ratio.js');

test('image already exactly 16:9 crops to itself (no-op)', () => {
  const plan = planAspectFit(1920, 1080);
  assert.deepEqual(plan, { mode: 'crop', x: 0, y: 0, width: 1920, height: 1080 });
});

test('image slightly wider than 16:9 but within tolerance crops width from center', () => {
  // 2000x1080 -> ratio 1.8519, ~4.2% wider than 16:9 (1.7778), inside default 5% tolerance
  const plan = planAspectFit(2000, 1080);
  assert.deepEqual(plan, { mode: 'crop', x: 40, y: 0, width: 1920, height: 1080 });
});

test('image slightly narrower than 16:9 but within tolerance crops height from center', () => {
  // 1720x1000 -> ratio 1.72, ~3.25% narrower than 16:9 (1.7778), inside default 5% tolerance
  const plan = planAspectFit(1720, 1000);
  assert.deepEqual(plan, { mode: 'crop', x: 0, y: 16, width: 1720, height: 968 });
});

test('panoramic image outside tolerance letterboxes (pads top/bottom) instead of cropping', () => {
  // 3000x1000 -> ratio 3.0, ~69% wider than 16:9, outside default 5% tolerance.
  // Canvas stays 3000 wide; height grows to 1688 so the original fits without losing content.
  const plan = planAspectFit(3000, 1000);
  assert.deepEqual(plan, { mode: 'pad', x: 0, y: 344, width: 3000, height: 1688 });
});

test('portrait image outside tolerance pillarboxes (pads left/right) instead of cropping', () => {
  // 800x1600 -> ratio 0.5, way narrower than 16:9, outside default 5% tolerance.
  // Canvas stays 1600 tall; width grows to 2844 so the original fits without losing content.
  const plan = planAspectFit(800, 1600);
  assert.deepEqual(plan, { mode: 'pad', x: 1022, y: 0, width: 2844, height: 1600 });
});
