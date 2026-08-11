import { describe, expect, test } from 'vitest'

import { computeEnhancedDifference } from './pixelDifference'


describe('computeEnhancedDifference', () => {
  test('computes absolute RGB differences, enhances by 32, and clamps at 255', () => {
    const original = new Uint8ClampedArray([10, 20, 30, 120, 100, 100, 100, 255])
    const modified = new Uint8ClampedArray([12, 17, 40, 10, 120, 90, 108, 0])

    expect(Array.from(computeEnhancedDifference(original, modified))).toEqual([
      64, 96, 255, 255,
      255, 255, 255, 255,
    ])
  })

  test('rejects buffers that cannot describe matching RGBA pixels', () => {
    expect(() => computeEnhancedDifference(
      new Uint8ClampedArray([0, 0, 0, 255]),
      new Uint8ClampedArray([0, 0, 0]),
    )).toThrow('equal RGBA lengths')
  })
})
