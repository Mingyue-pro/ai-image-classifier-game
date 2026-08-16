import { useEffect, useRef, useState } from 'react'
import { Crosshair, ScanSearch } from 'lucide-react'

import { computeEnhancedDifference } from './pixelDifference'


const DEFAULT_CROP_SIZE = 32
const DEFAULT_MAGNIFICATION = 10
const DIFFERENCE_ENHANCEMENT = 32
const PIXEL_GRID_SIZE = 8

type LoadedImages = {
  original: HTMLImageElement
  attacked: HTMLImageElement
  modified: HTMLImageElement
}

type CropOrigin = { x: number; y: number }
type Rgb = { red: number; green: number; blue: number }
type PixelGridData = { origin: CropOrigin; original: Rgb[]; attacked: Rgb[]; modified: Rgb[] }

type PixelInspectorProps = {
  originalUrl: string
  modifiedUrl: string
  subject: string
  strength: number
  observedStrength?: number
  cropSize?: number
  magnification?: number
  showOriginalStrength?: boolean
  attackedStrength?: number
  mode?: 'teaching' | 'repair'
}

function loadImage(url: string, reloadToken: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error('An image URL is missing.'))
      return
    }
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Could not load image: ${url}`))
    const separator = url.includes('?') ? '&' : '?'
    const inspectorUrl = `${url}${separator}pixel_inspector=1`
    image.src = reloadToken > 0 ? `${inspectorUrl}&retry=${reloadToken}` : inspectorUrl
  })
}

function originalImageUrl(url: string): string {
  return url.replace(/\/states\/[^/]+\/image(?:\?.*)?$/, '/original-image')
}

function clampCropOrigin(
  centreX: number,
  centreY: number,
  width: number,
  height: number,
  cropSize: number,
): CropOrigin {
  return {
    x: Math.max(0, Math.min(width - cropSize, Math.round(centreX - cropSize / 2))),
    y: Math.max(0, Math.min(height - cropSize, Math.round(centreY - cropSize / 2))),
  }
}

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas drawing is not available in this browser.')
  return context
}

function readCrop(image: HTMLImageElement, origin: CropOrigin, cropSize: number): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = cropSize
  canvas.height = cropSize
  const context = canvasContext(canvas)
  context.drawImage(image, origin.x, origin.y, cropSize, cropSize, 0, 0, cropSize, cropSize)
  return context.getImageData(0, 0, cropSize, cropSize)
}

function drawPixelatedImage(imageData: ImageData, target: HTMLCanvasElement, magnification: number) {
  const source = document.createElement('canvas')
  source.width = imageData.width
  source.height = imageData.height
  canvasContext(source).putImageData(imageData, 0, 0)

  target.width = imageData.width * magnification
  target.height = imageData.height * magnification
  const targetContext = canvasContext(target)
  targetContext.imageSmoothingEnabled = false
  targetContext.clearRect(0, 0, target.width, target.height)
  targetContext.drawImage(source, 0, 0, target.width, target.height)
}

function outlineChangedPixels(original: ImageData, modified: ImageData, target: HTMLCanvasElement, magnification: number) {
  const context = canvasContext(target)
  context.strokeStyle = 'rgba(255, 143, 77, 0.9)'
  context.lineWidth = 1
  for (let pixel = 0; pixel < original.data.length / 4; pixel += 1) {
    const offset = pixel * 4
    const changed = original.data[offset] !== modified.data[offset]
      || original.data[offset + 1] !== modified.data[offset + 1]
      || original.data[offset + 2] !== modified.data[offset + 2]
    if (!changed) continue
    const x = (pixel % original.width) * magnification
    const y = Math.floor(pixel / original.width) * magnification
    context.strokeRect(x + 0.5, y + 0.5, magnification - 1, magnification - 1)
  }
}

function outlinePixelGridRegion(target: HTMLCanvasElement, cropSize: number, magnification: number) {
  const inset = Math.floor((cropSize - PIXEL_GRID_SIZE) / 2) * magnification
  const size = PIXEL_GRID_SIZE * magnification
  const context = canvasContext(target)
  context.strokeStyle = '#25a7c4'
  context.lineWidth = 2
  context.strokeRect(inset + 1, inset + 1, size - 2, size - 2)
}

function rgbPixels(imageData: ImageData): Rgb[] {
  const pixels: Rgb[] = []
  for (let index = 0; index < imageData.data.length; index += 4) {
    pixels.push({
      red: imageData.data[index],
      green: imageData.data[index + 1],
      blue: imageData.data[index + 2],
    })
  }
  return pixels
}

function signedChange(value: number): string {
  return value > 0 ? `+${value}` : `${value}`
}

export function PixelInspector({
  originalUrl,
  modifiedUrl,
  subject,
  strength,
  observedStrength = 0,
  cropSize = DEFAULT_CROP_SIZE,
  magnification = DEFAULT_MAGNIFICATION,
  showOriginalStrength = false,
  attackedStrength = 4,
  mode = 'repair',
}: PixelInspectorProps) {
  const overviewRef = useRef<HTMLCanvasElement>(null)
  const originalCropRef = useRef<HTMLCanvasElement>(null)
  const attackedCropRef = useRef<HTMLCanvasElement>(null)
  const modifiedCropRef = useRef<HTMLCanvasElement>(null)
  const differenceCropRef = useRef<HTMLCanvasElement>(null)
  const [images, setImages] = useState<LoadedImages | null>(null)
  const [origin, setOrigin] = useState<CropOrigin>({ x: 0, y: 0 })
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [pixelGrid, setPixelGrid] = useState<PixelGridData | null>(null)
  const [selectedPixelIndex, setSelectedPixelIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([loadImage(originalImageUrl(originalUrl), reloadToken), loadImage(originalUrl, reloadToken), loadImage(modifiedUrl, reloadToken)])
      .then(([original, attacked, modified]) => {
        if (cancelled) return
        if (original.naturalWidth !== modified.naturalWidth || original.naturalHeight !== modified.naturalHeight) {
          throw new Error('Original and Modified images must have the same pixel dimensions.')
        }
        if (original.naturalWidth < cropSize || original.naturalHeight < cropSize) {
          throw new Error(`Images must be at least ${cropSize}×${cropSize} pixels.`)
        }
        setOrigin(clampCropOrigin(
          original.naturalWidth / 2,
          original.naturalHeight / 2,
          original.naturalWidth,
          original.naturalHeight,
          cropSize,
        ))
        setError(null)
        setImages({ original, attacked, modified })
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Pixel Inspector could not load the images.')
      })
    return () => { cancelled = true }
  }, [cropSize, modifiedUrl, originalUrl, reloadToken])

  useEffect(() => {
    if (!images || error) return
    try {
      const overview = overviewRef.current
      const originalTarget = originalCropRef.current
      const attackedTarget = attackedCropRef.current
      const modifiedTarget = modifiedCropRef.current
      const differenceTarget = differenceCropRef.current
      if (!overview || !originalTarget || !attackedTarget || !modifiedTarget || !differenceTarget) {
        throw new Error('Pixel Inspector Canvas elements are unavailable.')
      }

      overview.width = images.original.naturalWidth
      overview.height = images.original.naturalHeight
      const overviewContext = canvasContext(overview)
      overviewContext.clearRect(0, 0, overview.width, overview.height)
      overviewContext.drawImage(images.original, 0, 0)
      overviewContext.strokeStyle = '#ff8f4d'
      overviewContext.lineWidth = Math.max(2, Math.round(overview.width / 250))
      overviewContext.strokeRect(origin.x, origin.y, cropSize, cropSize)

      const originalCrop = readCrop(images.original, origin, cropSize)
      const attackedCrop = readCrop(images.attacked, origin, cropSize)
      const modifiedCrop = readCrop(images.modified, origin, cropSize)
      const differencePixels = computeEnhancedDifference(
        originalCrop.data,
        modifiedCrop.data,
        DIFFERENCE_ENHANCEMENT,
      )
      const differenceBuffer = new Uint8ClampedArray(differencePixels.length)
      differenceBuffer.set(differencePixels)
      const differenceCrop = new ImageData(differenceBuffer, cropSize, cropSize)
      drawPixelatedImage(originalCrop, originalTarget, magnification)
      drawPixelatedImage(attackedCrop, attackedTarget, magnification)
      drawPixelatedImage(modifiedCrop, modifiedTarget, magnification)
      outlineChangedPixels(originalCrop, attackedCrop, attackedTarget, magnification)
      outlineChangedPixels(originalCrop, modifiedCrop, modifiedTarget, magnification)
      outlinePixelGridRegion(originalTarget, cropSize, magnification)
      outlinePixelGridRegion(attackedTarget, cropSize, magnification)
      outlinePixelGridRegion(modifiedTarget, cropSize, magnification)
      drawPixelatedImage(differenceCrop, differenceTarget, magnification)

      const gridOrigin = {
        x: origin.x + Math.floor((cropSize - PIXEL_GRID_SIZE) / 2),
        y: origin.y + Math.floor((cropSize - PIXEL_GRID_SIZE) / 2),
      }
      const originalGrid = readCrop(images.original, gridOrigin, PIXEL_GRID_SIZE)
      const attackedGrid = readCrop(images.attacked, gridOrigin, PIXEL_GRID_SIZE)
      const modifiedGrid = readCrop(images.modified, gridOrigin, PIXEL_GRID_SIZE)
      const nextPixelGrid = {
        origin: gridOrigin,
        original: rgbPixels(originalGrid),
        attacked: rgbPixels(attackedGrid),
        modified: rgbPixels(modifiedGrid),
      }
      queueMicrotask(() => setPixelGrid(nextPixelGrid))
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Pixel Inspector could not draw the selected region.'
      queueMicrotask(() => setError(message))
    }
  }, [cropSize, error, images, magnification, origin])

  function selectRegion(event: React.MouseEvent<HTMLCanvasElement>) {
    if (!images) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) {
      setError('Pixel Inspector could not measure the overview image.')
      return
    }
    const x = (event.clientX - bounds.left) * (images.original.naturalWidth / bounds.width)
    const y = (event.clientY - bounds.top) * (images.original.naturalHeight / bounds.height)
    setOrigin(clampCropOrigin(x, y, images.original.naturalWidth, images.original.naturalHeight, cropSize))
  }

  function retryImages() {
    setError(null)
    setImages(null)
    setReloadToken((value) => value + 1)
  }

  const originalPixel = pixelGrid?.original[selectedPixelIndex]
  const attackedPixel = pixelGrid?.attacked[selectedPixelIndex]
  const modifiedPixel = pixelGrid?.modified[selectedPixelIndex]
  const selectedX = selectedPixelIndex % PIXEL_GRID_SIZE
  const selectedY = Math.floor(selectedPixelIndex / PIXEL_GRID_SIZE)
  const chartValues = originalPixel && attackedPixel && modifiedPixel ? [
    ['R', originalPixel.red, attackedPixel.red, modifiedPixel.red, '#d95b4f'],
    ['G', originalPixel.green, attackedPixel.green, modifiedPixel.green, '#438b62'],
    ['B', originalPixel.blue, attackedPixel.blue, modifiedPixel.blue, '#4777b8'],
  ] as const : []
  const adjustedSelected = modifiedUrl !== originalUrl
  const isTeachingMode = mode === 'teaching'

  function renderPixelGrid(pixels: Rgb[], label: string) {
    return <div className="pixel-inspector__pixel-grid" role="grid" aria-label={label}>
      {pixels.map((pixel, index) => {
        const x = index % PIXEL_GRID_SIZE
        const y = Math.floor(index / PIXEL_GRID_SIZE)
        return <button
          type="button"
          role="gridcell"
          key={`${x}-${y}`}
          className={index === selectedPixelIndex ? 'is-selected' : ''}
          aria-label={`${label} pixel x ${pixelGrid!.origin.x + x}, y ${pixelGrid!.origin.y + y}: R ${pixel.red}, G ${pixel.green}, B ${pixel.blue}`}
          aria-selected={index === selectedPixelIndex}
          style={{ backgroundColor: `rgb(${pixel.red} ${pixel.green} ${pixel.blue})` }}
          onClick={() => setSelectedPixelIndex(index)}
        />
      })}
    </div>
  }

  return (
    <section className="pixel-inspector" aria-label={`Pixel Inspector for ${subject}`}>
      <div className="pixel-inspector__overview-module">
      <div className="pixel-inspector__heading">
        <div><ScanSearch size={20} /><strong>Pixel Inspector</strong></div>
        <dl>
          <div><dt>Strength</dt><dd>{strength}/255</dd></div>
          <div><dt>Selected crop</dt><dd>{cropSize}×{cropSize} px · x={origin.x}–{origin.x + cropSize - 1}, y={origin.y}–{origin.y + cropSize - 1}</dd></div>
        </dl>
      </div>
      <p className="pixel-inspector__strength-explanation"><strong>Strength: {strength}/255.</strong> Pixel Strength controls how far pixel values can be shifted from the original image. It does not mean that {strength} pixels were changed.</p>
      {error ? <div className="pixel-inspector__error" role="alert"><span>{error}</span><button type="button" onClick={retryImages}>Retry images</button></div> : (
        <>
          <figure className="pixel-inspector__overview">
            <canvas ref={overviewRef} onClick={selectRegion} aria-label={`Select Pixel inspection region for ${subject}`} />
            <figcaption><Crosshair size={16} />Click the full image to inspect another {cropSize}×{cropSize} region. Edge selections are kept inside the image.</figcaption>
          </figure>
          {!images ? <p className="pixel-inspector__loading" role="status">Loading Original and Modified images…</p> : null}
        </>
      )}
          </div>
          {!error ? <>
          <div className="pixel-inspector__crop-section">
          <div className="pixel-inspector__crop-header"><strong>{cropSize}×{cropSize} selected crops</strong>{isTeachingMode ? <div className="pixel-inspector__strength-comparison" aria-label={`Original strength ${observedStrength}/255, modified strength ${strength}/255`}><span><small>Original</small><strong>{observedStrength}/255</strong></span><b>→</b><span><small>Modified</small><strong>{strength}/255</strong></span></div> : <div className="pixel-inspector__strength-comparison pixel-inspector__strength-comparison--three" aria-label={showOriginalStrength ? `Original strength ${observedStrength}/255, initial attacked strength ${attackedStrength}/255, adjusted strength ${adjustedSelected ? `${strength}/255` : 'pending'}` : `Correct original reference, initial attacked strength ${attackedStrength}/255, adjusted strength ${adjustedSelected ? `${strength}/255` : 'pending'}`}><span><small>Original</small><strong>{showOriginalStrength ? `${observedStrength}/255` : 'Correct reference'}</strong></span><b>→</b><span><small>Initial (attacked)</small><strong>{attackedStrength}/255</strong></span><b>→</b><span><small>Adjusted</small><strong>{adjustedSelected ? `${strength}/255` : 'Pending'}</strong></span></div>}</div>
          <div className={`pixel-inspector__crop-pair ${isTeachingMode ? '' : 'pixel-inspector__crop-triplet'}`}>
          <section className="pixel-inspector__module" aria-labelledby="original-crop-heading">
            <div><strong id="original-crop-heading">1. Original selected crop</strong><p>The enlarged selected crop before repair. Each visible square comes from the same location in the original image.</p></div>
            <figure className="pixel-inspector__single-crop"><canvas ref={originalCropRef} aria-label={`Original ${cropSize} by ${cropSize} Pixel crop`} /></figure>
          </section>
          {!isTeachingMode ? <section className="pixel-inspector__module" aria-labelledby="attacked-crop-heading">
            <div><strong id="attacked-crop-heading">2. Initial (attacked) selected crop</strong><p>The same coordinates in the initial attacked image. Orange outlines mark visible RGB changes from Original.</p></div>
            <figure className="pixel-inspector__single-crop"><canvas ref={attackedCropRef} aria-label={`Initial attacked ${cropSize} by ${cropSize} Pixel crop`} /></figure>
          </section> : <canvas ref={attackedCropRef} hidden aria-hidden="true" />}
          <section className={`pixel-inspector__module ${isTeachingMode || adjustedSelected ? '' : 'pixel-inspector__pending'}`} aria-labelledby="modified-crop-heading">
            <div><strong id="modified-crop-heading">{isTeachingMode ? '2. Modified selected crop' : '3. Adjusted selected crop'}</strong><p>{isTeachingMode ? 'The same coordinates after applying the selected Pixel Strength.' : adjustedSelected ? 'The same coordinates after the newly selected Strength adjustment.' : 'Select a new Pixel Strength to generate and display the adjusted crop.'}</p></div>
            <figure className="pixel-inspector__single-crop">{isTeachingMode || adjustedSelected ? <canvas ref={modifiedCropRef} aria-label={`${isTeachingMode ? 'Modified' : 'Adjusted'} ${cropSize} by ${cropSize} Pixel crop`} /> : <div className="pixel-inspector__pending-box">Waiting for a new parameter</div>}</figure>
            {!isTeachingMode && !adjustedSelected ? <canvas ref={modifiedCropRef} hidden aria-hidden="true" /> : null}
          </section>
          </div>
          <p className="pixel-inspector__grid-link">The outlined 8×8 area below is enlarged into the Pixel Grids. Both grids show the same coordinates before and after modification. The 32×32 crop contains 1,024 pixels, so displaying all of them as interactive cells would make each cell and its RGB values too small to inspect clearly. The fixed central 8×8 area provides a readable sample; it is not treated as more important or more causal than other pixels.</p>
          <section className="pixel-inspector__module pixel-inspector__difference-module" aria-labelledby="difference-heading">
            <figure className="pixel-inspector__single-crop"><canvas ref={differenceCropRef} aria-label={`Enhanced difference ${cropSize} by ${cropSize} Pixel crop`} /></figure>
            <div className="pixel-inspector__difference-copy">
              <strong id="difference-heading">3. Enhanced Difference · {cropSize}×{cropSize}</strong>
              <p>This final helper view colour-amplifies the small RGB value changes that are difficult to see clearly in the Original and Modified crops above.</p>
              <p className="pixel-inspector__difference-intro">For each pixel, the view calculates the absolute change in each colour channel: <strong>|Modified − Original| × {DIFFERENCE_ENHANCEMENT}</strong>. A change of 3 is therefore displayed more brightly than a change of 1. Red, green and blue areas show which RGB channels changed by different amounts.</p>
              <ul className="pixel-inspector__difference-legend" aria-label="Enhanced difference colour guide">
                <li><strong>Black:</strong> No RGB value changed at that pixel.</li>
                <li><strong>Darker colour:</strong> A smaller RGB change.</li>
                <li><strong>Brighter colour:</strong> A larger RGB change.</li>
              </ul>
              <p className="difference-notice">This amplified view is for visual inspection only. It shows the magnitude of RGB changes, not their direction: +3 and −3 have the same brightness. It also does not prove that any displayed pixel is the unique cause of the classification result.</p>
            </div>
          </section>
          </div>
          <div className="pixel-inspector__analysis-pair">
          {pixelGrid && originalPixel && attackedPixel && modifiedPixel ? <section className="pixel-inspector__micro-view" aria-label="Single pixel RGB comparison">
            <div className="pixel-inspector__micro-heading"><div><strong>8×8 real Pixel Grid</strong><span>{isTeachingMode ? 'Select one coordinate to compare its Original and Modified RGB values.' : 'Select one coordinate to compare its Original, Initial (attacked) and latest Adjusted RGB values.'}</span></div><span>x={pixelGrid.origin.x}–{pixelGrid.origin.x + PIXEL_GRID_SIZE - 1}, y={pixelGrid.origin.y}–{pixelGrid.origin.y + PIXEL_GRID_SIZE - 1}</span></div>
            <div className="pixel-inspector__micro-grids">
              <figure><figcaption>Original</figcaption>{renderPixelGrid(pixelGrid.original, 'Original Pixel Grid')}</figure>
              {!isTeachingMode ? <figure><figcaption>Initial (attacked)</figcaption>{renderPixelGrid(pixelGrid.attacked, 'Initial attacked Pixel Grid')}</figure> : null}
              {isTeachingMode || adjustedSelected ? <figure><figcaption>{isTeachingMode ? 'Modified' : 'Adjusted'}</figcaption>{renderPixelGrid(pixelGrid.modified, `${isTeachingMode ? 'Modified' : 'Adjusted'} Pixel Grid`)}</figure> : <figure className="pixel-inspector__pending"><figcaption>Adjusted</figcaption><div className="pixel-inspector__pending-box">Select a new parameter to display this 8×8 grid.</div></figure>}
            </div>
            <dl className="pixel-inspector__rgb-readout">
              <div className="pixel-inspector__coordinate"><dt>Selected pixel coordinate</dt><dd>({pixelGrid.origin.x + selectedX}, {pixelGrid.origin.y + selectedY})</dd></div>
              <div><dt>Original RGB</dt><dd>R{originalPixel.red} G{originalPixel.green} B{originalPixel.blue}</dd></div>
              {!isTeachingMode ? <div><dt>Initial (attacked) RGB</dt><dd>R{attackedPixel.red} G{attackedPixel.green} B{attackedPixel.blue}</dd></div> : null}
              <div><dt>{isTeachingMode ? 'Modified RGB' : 'Adjusted RGB'}</dt><dd>{isTeachingMode || adjustedSelected ? `R${modifiedPixel.red} G${modifiedPixel.green} B${modifiedPixel.blue}` : 'Waiting for a new parameter'}</dd></div>
              <div><dt>{isTeachingMode ? 'RGB change' : 'Latest adjustment'}</dt><dd>{isTeachingMode || adjustedSelected ? <><span>R {signedChange(modifiedPixel.red - (isTeachingMode ? originalPixel.red : attackedPixel.red))}</span><span>G {signedChange(modifiedPixel.green - (isTeachingMode ? originalPixel.green : attackedPixel.green))}</span><span>B {signedChange(modifiedPixel.blue - (isTeachingMode ? originalPixel.blue : attackedPixel.blue))}</span></> : 'Not available yet'}</dd></div>
            </dl>
            {isTeachingMode || adjustedSelected ? <figure className="pixel-inspector__rgb-chart" aria-label="Selected pixel RGB value change chart">
              <figcaption>Selected pixel RGB values: {isTeachingMode ? 'Original → Modified' : 'Original → Initial (attacked) → Adjusted'}</figcaption>
              <svg viewBox="0 0 520 190" role="img" aria-label="Line chart comparing original attacked and adjusted red green and blue values">
                <line x1="45" y1="15" x2="45" y2="155" /><line x1="45" y1="155" x2="370" y2="155" />
                <text x="75" y="178">Original</text>{isTeachingMode ? <text x="305" y="178">Modified</text> : <><text x="180" y="178">Initial</text><text x="305" y="178">Adjusted</text></>}
                {chartValues.map(([channel, original, attacked, adjusted, colour], index) => {
                  const values = isTeachingMode ? [original, adjusted] : [original, attacked, adjusted]
                  const xPositions = isTeachingMode ? [100, 330] : [100, 215, 330]
                  const points = values.map((value, point) => `${xPositions[point]},${155 - (value / 255) * 130}`).join(' ')
                  return <g key={channel}><polyline points={points} fill="none" stroke={colour} strokeWidth="3" />{values.map((value, point) => <circle key={point} cx={xPositions[point]} cy={155 - (value / 255) * 130} r="5" fill={colour} />)}<text className="rgb-chart-legend" x="390" y={28 + index * 19} fill={colour}>{isTeachingMode ? `${channel} ${original} → ${adjusted}` : `${channel} ${original} → ${attacked} → ${adjusted}`}</text></g>
                })}
              </svg>
            </figure> : <div className="pixel-inspector__pending-box pixel-inspector__pending-chart">Select a new Pixel Strength to display the three-state RGB chart.</div>}
            <p>FGSM makes small RGB changes across many pixels. This selected pixel is one example, not proof that it alone caused the classification result.</p>
          </section> : null}
          </div>
        </> : null}
    </section>
  )
}
