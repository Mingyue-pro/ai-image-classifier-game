import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { PixelInspector } from './PixelInspector'


class FakeImageData {
  data: Uint8ClampedArray
  width: number
  height: number

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data
    this.width = width
    this.height = height
  }
}

class FakeImage {
  static requestedUrls: string[] = []
  crossOrigin: string | null = null
  naturalWidth = 64
  naturalHeight = 64
  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  set src(value: string) {
    FakeImage.requestedUrls.push(value)
    if (value.includes('missing')) {
      queueMicrotask(() => this.onerror?.())
    } else {
      if (value.includes('different-size')) this.naturalWidth = 80
      queueMicrotask(() => this.onload?.())
    }
  }
}

describe('PixelInspector', () => {
  const context = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn(() => new FakeImageData(new Uint8ClampedArray(32 * 32 * 4), 32, 32)),
    putImageData: vi.fn(),
    strokeRect: vi.fn(),
    imageSmoothingEnabled: true,
    strokeStyle: '',
    lineWidth: 1,
  }

  beforeEach(() => {
    FakeImage.requestedUrls = []
    vi.stubGlobal('Image', FakeImage)
    vi.stubGlobal('ImageData', FakeImageData)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test('draws three pixelated crops and keeps edge clicks inside the image', async () => {
    render(<PixelInspector originalUrl="original.png" modifiedUrl="modified.png" subject="strawberry" strength={4} />)

    const originalCrop = await screen.findByLabelText('Original 32 by 32 Pixel crop')
    await waitFor(() => expect(originalCrop).toHaveAttribute('width', '320'))
    expect(screen.getByLabelText('Modified 32 by 32 Pixel crop')).toHaveAttribute('height', '320')
    expect(screen.getByLabelText('Enhanced difference 32 by 32 Pixel crop')).toBeInTheDocument()
    expect(screen.getByLabelText('Enhanced difference colour guide')).toHaveTextContent('Black: No visible pixel difference.')
    expect(screen.getByLabelText('Enhanced difference colour guide')).toHaveTextContent('Dark grey: A small pixel difference.')
    expect(screen.getByLabelText('Enhanced difference colour guide')).toHaveTextContent('Bright grey or colour: A larger pixel difference, or different amounts of change across the red, green and blue (RGB) channels.')
    expect(screen.getByText('4/255')).toBeInTheDocument()
    expect(screen.getByText('32×32 px')).toBeInTheDocument()
    expect(screen.getByText('x=16, y=16')).toBeInTheDocument()

    const overview = screen.getByLabelText('Select Pixel inspection region for strawberry')
    expect(FakeImage.requestedUrls).toContain('original.png?pixel_inspector=1')
    expect(FakeImage.requestedUrls).toContain('modified.png?pixel_inspector=1')
    vi.spyOn(overview, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100,
      width: 100, height: 100, toJSON: () => ({}),
    })
    fireEvent.click(overview, { clientX: 100, clientY: 100 })
    await waitFor(() => expect(screen.getByText('x=32, y=32')).toBeInTheDocument())
    expect(context.strokeRect).toHaveBeenLastCalledWith(32, 32, 32, 32)
    expect(context.imageSmoothingEnabled).toBe(false)
  })

  test('reports missing images and dimension mismatches without throwing', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<PixelInspector originalUrl="original.png" modifiedUrl="missing.png" subject="traffic light" strength={1} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load image')
    await user.click(screen.getByRole('button', { name: 'Retry images' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load image')
    expect(FakeImage.requestedUrls.some((url) => url.includes('pixel_inspector=1&retry=1'))).toBe(true)

    rerender(<PixelInspector originalUrl="original.png" modifiedUrl="different-size.png" subject="traffic light" strength={1} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('same pixel dimensions')
  })
})
