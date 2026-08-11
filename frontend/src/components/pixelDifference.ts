export function computeEnhancedDifference(
  original: Uint8ClampedArray,
  modified: Uint8ClampedArray,
  enhancement = 32,
): Uint8ClampedArray {
  if (original.length !== modified.length || original.length % 4 !== 0) {
    throw new Error('Pixel buffers must have equal RGBA lengths.')
  }
  if (!Number.isFinite(enhancement) || enhancement < 0) {
    throw new Error('Difference enhancement must be a non-negative number.')
  }

  const difference = new Uint8ClampedArray(original.length)
  for (let index = 0; index < original.length; index += 4) {
    difference[index] = Math.min(255, Math.abs(modified[index] - original[index]) * enhancement)
    difference[index + 1] = Math.min(255, Math.abs(modified[index + 1] - original[index + 1]) * enhancement)
    difference[index + 2] = Math.min(255, Math.abs(modified[index + 2] - original[index + 2]) * enhancement)
    difference[index + 3] = 255
  }
  return difference
}
