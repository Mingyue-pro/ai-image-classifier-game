import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { FixedPixelRegionImage, PixelInspector } from './PixelInspector'


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
  let microGridReadCount = 0
  let modifiedOffset = 4
  const context = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4)
      if (width === 8) {
        const state = microGridReadCount++ % 3
        const offset = state === 0 ? 0 : state === 1 ? 4 : modifiedOffset
        for (let index = 0; index < data.length; index += 4) {
          data[index] = 120 + offset
          data[index + 1] = 80 - offset
          data[index + 2] = 60 + offset
          data[index + 3] = 255
        }
      }
      return new FakeImageData(data, width, height)
    }),
    putImageData: vi.fn(),
    strokeRect: vi.fn(),
    imageSmoothingEnabled: true,
    strokeStyle: '',
    lineWidth: 1,
  }

  beforeEach(() => {
    FakeImage.requestedUrls = []
    microGridReadCount = 0
    modifiedOffset = 4
    context.strokeRect.mockClear()
    vi.stubGlobal('Image', FakeImage)
    vi.stubGlobal('ImageData', FakeImageData)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test('draws three pixelated regions and keeps edge clicks inside the image', async () => {
    render(<PixelInspector originalUrl="original.png" modifiedUrl="modified.png" subject="strawberry" strength={4} showOriginalStrength />)

    const originalCrop = await screen.findByLabelText('Original 32 by 32 Pixel region')
    await waitFor(() => expect(originalCrop).toHaveAttribute('width', '320'))
    expect(screen.getByLabelText('Initial attacked 32 by 32 Pixel region')).toHaveAttribute('height', '320')
    expect(screen.getByLabelText('Adjusted 32 by 32 Pixel region')).toHaveAttribute('height', '320')
    expect(screen.getByText('32×32 selected regions')).toBeInTheDocument()
    expect(screen.getByText('1. Original selected region')).toBeInTheDocument()
    expect(screen.getByText('2. Initial (attacked) selected region')).toBeInTheDocument()
    expect(screen.getByText('3. Adjusted selected region')).toBeInTheDocument()
    expect(screen.getByText('Enhanced Difference · Same 8×8 Region')).toBeInTheDocument()
    expect(screen.getByLabelText('Three Stage 3 Enhanced Difference comparisons')).toBeInTheDocument()
    expect(screen.getByText('1. Original ↔ Initial (attacked)')).toBeInTheDocument()
    expect(screen.getByText('Changes introduced by the attack')).toBeInTheDocument()
    expect(screen.getByText('2. Initial (attacked) ↔ Adjusted')).toBeInTheDocument()
    expect(screen.getByText('Changes made during this repair')).toBeInTheDocument()
    expect(screen.getByText('3. Original ↔ Adjusted')).toBeInTheDocument()
    expect(screen.getByText('Difference remaining after repair')).toBeInTheDocument()
    expect(screen.getByText(/outlined 8×8 area below is enlarged into the Pixel Grids/)).toBeInTheDocument()
    expect(screen.getByText(/outlined 8×8 area below.*32×32 region contains 1,024 pixels/)).toBeInTheDocument()
    expect(await screen.findByLabelText('Selected pixel RGB value change chart')).toBeInTheDocument()
    expect(screen.getByLabelText(/Enhanced difference from Initial \(attacked\) to Adjusted for the same 8 by 8 Pixel region/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Enhanced difference from Original to Initial \(attacked\) for the same 8 by 8 Pixel region/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Enhanced difference from Original to Adjusted for the same 8 by 8 Pixel region/)).toBeInTheDocument()
    expect(screen.getByText(/\|Adjusted − Initial \(attacked\)\| × 32/)).toBeInTheDocument()
    expect(screen.getByText(/same 8×8 region as the RGB grids above/)).toBeInTheDocument()
    expect(screen.getByLabelText('Enhanced difference colour guide')).toHaveTextContent('Black: No stored RGB difference.')
    expect(screen.getByLabelText('Enhanced difference colour guide')).toHaveTextContent('Grey: R, G and B changed by similar amounts.')
    expect(screen.getByLabelText('Enhanced difference colour guide')).toHaveTextContent('Darker grey means smaller changes; lighter grey means larger changes.')
    expect(screen.getByLabelText('Enhanced difference colour guide')).toHaveTextContent('Coloured: The RGB channels changed by different amounts.')
    expect(screen.getByText(/each change by 4.*128, 128, 128.*grey/i)).toBeInTheDocument()
    expect(screen.getByText(/A change of 3 is displayed more brightly than a change of 1/)).toBeInTheDocument()
    expect(screen.getByText(/\+3 and −3 have the same brightness/)).toBeInTheDocument()
    expect(screen.getAllByText('4/255').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByLabelText('Original strength 0/255, initial attacked strength 4/255, adjusted strength 4/255')).toBeInTheDocument()
    expect(screen.getByText('32×32 px · x=16–47, y=16–47')).toBeInTheDocument()
    expect(await screen.findByText('8×8 real Pixel Grid')).toBeInTheDocument()
    const rgbSection = screen.getByRole('region', { name: 'Single pixel RGB comparison' })
    const differenceSection = screen.getByText('Enhanced Difference · Same 8×8 Region').closest('section')
    expect(rgbSection.compareDocumentPosition(differenceSection!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.getByText('R120 G80 B60')).toBeInTheDocument()
    expect(screen.getAllByText('R124 G76 B64')).toHaveLength(2)
    expect(screen.getByText('R 0')).toBeInTheDocument()
    expect(screen.getByText('G 0')).toBeInTheDocument()
    expect(screen.getByText('B 0')).toBeInTheDocument()
    expect(screen.getByText(/does not mean that 4 pixels were changed/)).toBeInTheDocument()
    expect(screen.getByText(/This selected pixel is one example, not proof/)).toBeInTheDocument()
    expect(screen.getByText(/A Pixel modification makes small RGB changes across many pixels/)).toBeInTheDocument()
    expect(screen.queryByText(/FGSM makes small RGB changes/)).not.toBeInTheDocument()
    expect(context.strokeRect).toHaveBeenCalled()

    const overview = screen.getByLabelText('Select Pixel inspection region for strawberry')
    expect(FakeImage.requestedUrls).toContain('original.png?pixel_inspector=1')
    expect(FakeImage.requestedUrls).toContain('modified.png?pixel_inspector=1')
    vi.spyOn(overview, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100,
      width: 100, height: 100, toJSON: () => ({}),
    })
    fireEvent.click(overview, { clientX: 100, clientY: 100 })
    await waitFor(() => expect(screen.getByText('32×32 px · x=32–63, y=32–63')).toBeInTheDocument())
    expect(context.strokeRect).toHaveBeenCalledWith(32, 32, 32, 32)
    expect(context.strokeRect).toHaveBeenCalledWith(121, 121, 78, 78)
    expect(context.imageSmoothingEnabled).toBe(false)
  })

  test('draws the same fixed 32 by 32 frame on a whole-image card', async () => {
    render(<FixedPixelRegionImage title="Observe" imageUrl="observe.png" alt="Observe with fixed region" details="Starting Strength" />)

    expect(screen.getByRole('img', { name: 'Observe with fixed region' })).toBeInTheDocument()
    expect(screen.getByText('Orange frame: fixed 32×32 region')).toBeInTheDocument()
    await waitFor(() => expect(context.strokeRect).toHaveBeenCalledWith(16, 16, 32, 32))
  })

  test('keeps the selected coordinate and refreshes its RGB change with a new strength image', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<PixelInspector originalUrl="original.png" modifiedUrl="modified-4.png" subject="traffic light" strength={4} />)
    const pixel = await screen.findByRole('gridcell', { name: /Original Pixel Grid pixel x 29, y 28/ })
    await user.click(pixel)
    expect(screen.getByText('(29, 28)')).toBeInTheDocument()

    modifiedOffset = 1
    microGridReadCount = 0
    rerender(<PixelInspector originalUrl="original.png" modifiedUrl="modified-1.png" subject="traffic light" strength={1} />)

    await waitFor(() => expect(screen.getByText('R121 G79 B61')).toBeInTheDocument())
    expect(screen.getByText('(29, 28)')).toBeInTheDocument()
    expect(screen.getByText('R -3')).toBeInTheDocument()
    expect(screen.getByText('G +3')).toBeInTheDocument()
    expect(screen.getByText('B -3')).toBeInTheDocument()
  })

  test('uses the original two-state comparison in teaching mode', async () => {
    render(<PixelInspector mode="teaching" originalUrl="original.png" modifiedUrl="modified.png" subject="strawberry" strength={4} />)

    expect(await screen.findByLabelText('Original 32 by 32 Pixel region')).toBeInTheDocument()
    expect(screen.getByLabelText('Modified 32 by 32 Pixel region')).toBeInTheDocument()
    expect(screen.queryByLabelText('Initial attacked 32 by 32 Pixel region')).not.toBeInTheDocument()
    expect(screen.getByText('2. Modified selected region')).toBeInTheDocument()
    expect(screen.queryByText('3. Adjusted selected region')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Original strength 0/255, modified strength 4/255')).toBeInTheDocument()
    expect(await screen.findByRole('grid', { name: 'Modified Pixel Grid' })).toBeInTheDocument()
    expect(screen.queryByRole('grid', { name: 'Initial attacked Pixel Grid' })).not.toBeInTheDocument()
    expect(screen.getByText('Selected pixel RGB values: Original → Modified')).toBeInTheDocument()
  })

  test('shows the fixed Stage 1 location while limiting analysis to the 32 by 32 Before and After regions', async () => {
    render(<PixelInspector mode="introduction" allowRegionSelection={false} originalUrl="original.png" modifiedUrl="modified.png" subject="strawberry" strength={4} />)

    expect(await screen.findByLabelText('Original 32 by 32 Pixel region')).toBeInTheDocument()
    expect(screen.getByLabelText('Modified 32 by 32 Pixel region')).toBeInTheDocument()
    expect(screen.getByLabelText('Fixed Pixel inspection region for strawberry')).toBeInTheDocument()
    expect(screen.getByText(/fixed 32×32 region used for this comparison/)).toBeInTheDocument()
    expect(screen.queryByText('Enhanced Difference')).not.toBeInTheDocument()
    expect(screen.queryByRole('grid', { name: 'Original Pixel Grid' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Selected pixel RGB value change chart')).not.toBeInTheDocument()
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
