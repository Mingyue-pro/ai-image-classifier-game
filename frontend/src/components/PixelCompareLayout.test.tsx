import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import { PixelCompareLayout } from './PixelCompareLayout'

vi.mock('./PixelInspector', () => ({
  PixelInspector: ({ originalUrl, referenceOriginalUrl, modifiedUrl }: {
    originalUrl: string
    referenceOriginalUrl?: string
    modifiedUrl: string
  }) => <div
    data-testid="pixel-inspector-inputs"
    data-before={originalUrl}
    data-reference={referenceOriginalUrl}
    data-after={modifiedUrl}
  />,
}))

test('uses the supplied before image as the real two-state RGB reference', () => {
  render(<PixelCompareLayout
    mode="two-state"
    beforeImageUrl="/states/pre-round/image"
    afterImageUrl="/states/post-round/image"
    subject="lemon"
    beforeStrength={1}
    afterStrength={2}
    beforeLabel="Pre-round cumulative state"
    afterLabel="Post-round state"
  />)

  const inspector = screen.getByTestId('pixel-inspector-inputs')
  expect(inspector).toHaveAttribute('data-before', '/states/pre-round/image')
  expect(inspector).toHaveAttribute('data-reference', '/states/pre-round/image')
  expect(inspector).toHaveAttribute('data-after', '/states/post-round/image')
})
