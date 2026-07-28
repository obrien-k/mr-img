const DEFAULT_TARGET_RATIO = 16 / 9;
const DEFAULT_TOLERANCE = 0.05;

function planAspectFit(width, height, { targetRatio = DEFAULT_TARGET_RATIO, tolerance = DEFAULT_TOLERANCE } = {}) {
  const ratio = width / height;
  const withinTolerance = Math.abs(ratio - targetRatio) / targetRatio <= tolerance;

  if (withinTolerance) {
    if (ratio > targetRatio) {
      const cropWidth = Math.round(height * targetRatio);
      return { mode: 'crop', x: Math.round((width - cropWidth) / 2), y: 0, width: cropWidth, height };
    }

    if (ratio < targetRatio) {
      const cropHeight = Math.round(width / targetRatio);
      return { mode: 'crop', x: 0, y: Math.round((height - cropHeight) / 2), width, height: cropHeight };
    }

    return { mode: 'crop', x: 0, y: 0, width, height };
  }

  if (ratio > targetRatio) {
    const canvasHeight = Math.round(width / targetRatio);
    return { mode: 'pad', x: 0, y: Math.round((canvasHeight - height) / 2), width, height: canvasHeight };
  }

  const canvasWidth = Math.round(height * targetRatio);
  return { mode: 'pad', x: Math.round((canvasWidth - width) / 2), y: 0, width: canvasWidth, height };
}

module.exports = { planAspectFit, DEFAULT_TARGET_RATIO, DEFAULT_TOLERANCE };
