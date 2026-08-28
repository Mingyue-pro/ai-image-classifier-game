import { useEffect, useRef, useState } from 'react'
import { Crosshair, ScanSearch } from 'lucide-react'

import { computeEnhancedDifference } from './pixelDifference'
import { EnhancedDifferenceExplanation, PIXEL_STRENGTH_EXPLANATION } from './PixelLearning'


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
  referenceOriginalUrl?: string
  modifiedUrl: string
  subject: string
  strength: number
  observedStrength?: number
  cropSize?: number
  magnification?: number
  showOriginalStrength?: boolean
  attackedStrength?: number
  mode?: 'introduction' | 'preview' | 'teaching' | 'repair' | 'comparison'
  showStrengthDetails?: boolean
  overviewState?: 'original' | 'attacked' | 'modified'
  currentStateLabel?: string
  previewReady?: boolean
  beforeLabelOverride?: string
  afterLabelOverride?: string
  allowRegionSelection?: boolean
  showEnhancedDifference?: boolean
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

function outlineSelectedPixel(target: HTMLCanvasElement, selectedPixelIndex: number, magnification: number) {
  const x = (selectedPixelIndex % PIXEL_GRID_SIZE) * magnification
  const y = Math.floor(selectedPixelIndex / PIXEL_GRID_SIZE) * magnification
  const context = canvasContext(target)
  context.strokeStyle = '#25a7c4'
  context.lineWidth = 2
  context.strokeRect(x + 1, y + 1, magnification - 2, magnification - 2)
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
  referenceOriginalUrl,
  modifiedUrl,
  subject,
  strength,
  observedStrength = 0,
  cropSize = DEFAULT_CROP_SIZE,
  magnification = DEFAULT_MAGNIFICATION,
  showOriginalStrength = false,
  attackedStrength = 4,
  mode = 'repair',
  showStrengthDetails = true,
  overviewState = 'original',
  currentStateLabel = 'Initial (attacked)',
  previewReady = true,
  beforeLabelOverride,
  afterLabelOverride,
  allowRegionSelection = true,
  showEnhancedDifference = false,
}: PixelInspectorProps) {
  const overviewRef = useRef<HTMLCanvasElement>(null)
  const originalCropRef = useRef<HTMLCanvasElement>(null)
  const attackedCropRef = useRef<HTMLCanvasElement>(null)
  const modifiedCropRef = useRef<HTMLCanvasElement>(null)
  const differenceCropRef = useRef<HTMLCanvasElement>(null)
  const attackDifferenceRef = useRef<HTMLCanvasElement>(null)
  const remainingDifferenceRef = useRef<HTMLCanvasElement>(null)
  const [images, setImages] = useState<LoadedImages | null>(null)
  const [origin, setOrigin] = useState<CropOrigin>({ x: 0, y: 0 })
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [pixelGrid, setPixelGrid] = useState<PixelGridData | null>(null)
  const [selectedPixelIndex, setSelectedPixelIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([loadImage(referenceOriginalUrl ?? originalImageUrl(originalUrl), reloadToken), loadImage(originalUrl, reloadToken), loadImage(modifiedUrl, reloadToken)])
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
  }, [cropSize, modifiedUrl, originalUrl, referenceOriginalUrl, reloadToken])

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
      const overviewImage = overviewState === 'attacked' ? images.attacked : overviewState === 'modified' ? images.modified : images.original
      overviewContext.drawImage(overviewImage, 0, 0)
      overviewContext.strokeStyle = '#ff8f4d'
      overviewContext.lineWidth = Math.max(2, Math.round(overview.width / 250))
      overviewContext.strokeRect(origin.x, origin.y, cropSize, cropSize)

      const originalCrop = readCrop(images.original, origin, cropSize)
      const attackedCrop = readCrop(images.attacked, origin, cropSize)
      const modifiedCrop = readCrop(images.modified, origin, cropSize)
      drawPixelatedImage(originalCrop, originalTarget, magnification)
      drawPixelatedImage(attackedCrop, attackedTarget, magnification)
      drawPixelatedImage(modifiedCrop, modifiedTarget, magnification)
      if (mode !== 'introduction' && mode !== 'preview') {
        outlineChangedPixels(originalCrop, attackedCrop, attackedTarget, magnification)
        outlineChangedPixels(originalCrop, modifiedCrop, modifiedTarget, magnification)
        outlinePixelGridRegion(originalTarget, cropSize, magnification)
        outlinePixelGridRegion(attackedTarget, cropSize, magnification)
        outlinePixelGridRegion(modifiedTarget, cropSize, magnification)
      }
      const gridOrigin = {
        x: origin.x + Math.floor((cropSize - PIXEL_GRID_SIZE) / 2),
        y: origin.y + Math.floor((cropSize - PIXEL_GRID_SIZE) / 2),
      }
      const originalGrid = readCrop(images.original, gridOrigin, PIXEL_GRID_SIZE)
      const attackedGrid = readCrop(images.attacked, gridOrigin, PIXEL_GRID_SIZE)
      const modifiedGrid = readCrop(images.modified, gridOrigin, PIXEL_GRID_SIZE)
      const differenceBeforeGrid = mode === 'repair' ? attackedGrid : originalGrid
      const differencePixels = computeEnhancedDifference(
        differenceBeforeGrid.data,
        modifiedGrid.data,
        DIFFERENCE_ENHANCEMENT,
      )
      const differenceBuffer = new Uint8ClampedArray(differencePixels.length)
      differenceBuffer.set(differencePixels)
      const differenceGrid = new ImageData(differenceBuffer, PIXEL_GRID_SIZE, PIXEL_GRID_SIZE)
      drawPixelatedImage(differenceGrid, differenceTarget, magnification)
      outlineSelectedPixel(differenceTarget, selectedPixelIndex, magnification)
      if (mode === 'repair') {
        const attackTarget = attackDifferenceRef.current
        const remainingTarget = remainingDifferenceRef.current
        if (!attackTarget || !remainingTarget) throw new Error('Stage 3 Enhanced Difference Canvas elements are unavailable.')
        const attackPixels = computeEnhancedDifference(originalGrid.data, attackedGrid.data, DIFFERENCE_ENHANCEMENT)
        const remainingPixels = computeEnhancedDifference(originalGrid.data, modifiedGrid.data, DIFFERENCE_ENHANCEMENT)
        drawPixelatedImage(new ImageData(new Uint8ClampedArray(attackPixels), PIXEL_GRID_SIZE, PIXEL_GRID_SIZE), attackTarget, magnification)
        drawPixelatedImage(new ImageData(new Uint8ClampedArray(remainingPixels), PIXEL_GRID_SIZE, PIXEL_GRID_SIZE), remainingTarget, magnification)
        outlineSelectedPixel(attackTarget, selectedPixelIndex, magnification)
        outlineSelectedPixel(remainingTarget, selectedPixelIndex, magnification)
      }
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
  }, [cropSize, error, images, magnification, mode, origin, overviewState, selectedPixelIndex])

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
  const isIntroductionMode = mode === 'introduction'
  const isPreviewMode = mode === 'preview'
  const isCropOnlyMode = isIntroductionMode || isPreviewMode
  const hideOverview = isPreviewMode
  const isTeachingMode = mode === 'teaching'
  const isComparisonMode = mode === 'comparison' || isPreviewMode
  const isTwoStateMode = isCropOnlyMode || isTeachingMode || isComparisonMode
  const beforeLabel = beforeLabelOverride ?? (isComparisonMode ? 'Before' : 'Original')
  const afterLabel = afterLabelOverride ?? (isComparisonMode ? 'After' : 'Modified')
  const differenceBeforeLabel = isTwoStateMode ? beforeLabel : currentStateLabel
  const differenceAfterLabel = isTwoStateMode ? afterLabel : 'Adjusted'
  const afterStateReady = !isPreviewMode || previewReady

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
    <section className={`pixel-inspector ${showEnhancedDifference ? 'pixel-inspector--show-difference' : ''}`.trim()} aria-label={`Pixel Inspector for ${subject}`}>
      {hideOverview ? <canvas ref={overviewRef} hidden aria-hidden="true" /> : null}
      {isCropOnlyMode ? <canvas ref={differenceCropRef} hidden aria-hidden="true" /> : null}
      {!hideOverview ? <>
      <div className="pixel-inspector__overview-module">
      <div className="pixel-inspector__heading">
        <div><ScanSearch size={20} /><strong>Pixel Inspector</strong></div>
        <dl>
          {showStrengthDetails ? <div><dt>Strength</dt><dd>{strength}/255</dd></div> : null}
          <div><dt>Selected region</dt><dd>{cropSize}×{cropSize} px · x={origin.x}–{origin.x + cropSize - 1}, y={origin.y}–{origin.y + cropSize - 1}</dd></div>
        </dl>
      </div>
      {showStrengthDetails ? <p className="pixel-inspector__strength-explanation"><strong>Strength: {strength}/255.</strong> {PIXEL_STRENGTH_EXPLANATION} It does not mean that {strength} pixels were changed.</p> : <p className="pixel-inspector__strength-explanation">This fixed Pixel modification makes small RGB adjustments across many pixels.</p>}
      {error ? <div className="pixel-inspector__error" role="alert"><span>{error}</span><button type="button" onClick={retryImages}>Retry images</button></div> : (
        <>
          <figure className="pixel-inspector__overview">
            <canvas ref={overviewRef} className={allowRegionSelection ? '' : 'is-fixed'} onClick={allowRegionSelection ? selectRegion : undefined} aria-label={allowRegionSelection ? overviewState === 'original' ? `Select Pixel inspection region for ${subject}` : `Select Pixel inspection region from ${overviewState === 'attacked' ? currentStateLabel : overviewState} for ${subject}` : `Fixed Pixel inspection region for ${subject}`} />
            <figcaption><Crosshair size={16} />{allowRegionSelection ? <>This full image shows the {overviewState === 'attacked' ? currentStateLabel : overviewState} used to select a {cropSize}×{cropSize} region. Click it to inspect another location.</> : <>This full image shows the fixed {cropSize}×{cropSize} region used for this comparison. The same coordinates are used before and after the Pixel modification.</>}</figcaption>
          </figure>
          {!images ? <p className="pixel-inspector__loading" role="status">Loading {beforeLabel} and {afterLabel} images…</p> : null}
        </>
      )}
          </div>
          </> : null}
          {!error ? <>
          <div className="pixel-inspector__crop-section">
          <div className="pixel-inspector__crop-header"><strong>{cropSize}×{cropSize} selected {isPreviewMode ? 'region' : 'regions'}</strong>{isTwoStateMode ? <div className="pixel-inspector__strength-comparison" aria-label={showStrengthDetails ? `${beforeLabel} strength ${observedStrength}/255, ${afterLabel.toLowerCase()} strength ${afterStateReady ? `${strength}/255` : 'not selected'}` : `${beforeLabel} and ${afterLabel.toLowerCase()} fixed Pixel states`}><span><small>{beforeLabel}</small><strong>{showStrengthDetails ? `${observedStrength}/255` : 'Before'}</strong></span><b>→</b><span><small>{afterLabel}</small><strong>{showStrengthDetails ? afterStateReady ? `${strength}/255` : 'Select Strength' : 'After'}</strong></span></div> : <div className="pixel-inspector__strength-comparison pixel-inspector__strength-comparison--three" aria-label={showOriginalStrength ? `Original strength ${observedStrength}/255, ${currentStateLabel === 'Initial (attacked)' ? 'initial attacked' : currentStateLabel} strength ${attackedStrength}/255, adjusted strength ${adjustedSelected ? `${strength}/255` : 'pending'}` : `Correct original reference, ${currentStateLabel === 'Initial (attacked)' ? 'initial attacked' : currentStateLabel} strength ${attackedStrength}/255, adjusted strength ${adjustedSelected ? `${strength}/255` : 'pending'}`}><span><small>Original</small><strong>{showOriginalStrength ? `${observedStrength}/255` : 'Correct reference'}</strong></span><b>→</b><span><small>{currentStateLabel}</small><strong>{attackedStrength}/255</strong></span><b>→</b><span><small>Adjusted</small><strong>{adjustedSelected ? `${strength}/255` : 'Pending'}</strong></span></div>}</div>
          {isPreviewMode ? <p className="pixel-inspector__fixed-region-note">The same fixed {cropSize}×{cropSize} region is shown before and after the selected Strength is applied.</p> : null}
          <div className={`pixel-inspector__crop-pair ${isTwoStateMode ? '' : 'pixel-inspector__crop-triplet'}`}>
          <section className="pixel-inspector__module" aria-labelledby="original-crop-heading">
            <div><strong id="original-crop-heading">1. {beforeLabel} selected region</strong><p>The enlarged selected region before this adjustment. Each visible square comes from the same image location.</p></div>
            <figure className="pixel-inspector__single-crop"><canvas ref={originalCropRef} aria-label={`${beforeLabel} ${cropSize} by ${cropSize} Pixel region`} /></figure>
          </section>
          {!isTwoStateMode ? <section className="pixel-inspector__module" aria-labelledby="attacked-crop-heading">
            <div><strong id="attacked-crop-heading">2. {currentStateLabel} selected region</strong><p>The same coordinates in the current image state. Orange outlines mark visible RGB changes from Original.</p></div>
            <figure className="pixel-inspector__single-crop"><canvas ref={attackedCropRef} aria-label={`${currentStateLabel === 'Initial (attacked)' ? 'Initial attacked' : currentStateLabel} ${cropSize} by ${cropSize} Pixel region`} /></figure>
          </section> : <canvas ref={attackedCropRef} hidden aria-hidden="true" />}
          <section className={`pixel-inspector__module ${afterStateReady && (isTeachingMode || adjustedSelected) ? '' : 'pixel-inspector__pending'}`} aria-labelledby="modified-crop-heading">
            <div><strong id="modified-crop-heading">{isTwoStateMode ? `2. ${afterLabel} selected region` : '3. Adjusted selected region'}</strong><p>{isPreviewMode && !afterStateReady ? 'Choose a Strength to compare the selected region.' : isTwoStateMode ? 'The same coordinates after applying this Pixel Strength adjustment.' : adjustedSelected ? 'The same coordinates after the newly selected Strength adjustment.' : 'Select a new Pixel Strength to generate and display the adjusted region.'}</p></div>
            <figure className="pixel-inspector__single-crop">{afterStateReady && (isTwoStateMode || adjustedSelected) ? <canvas ref={modifiedCropRef} aria-label={`${isTwoStateMode ? afterLabel : 'Adjusted'} ${cropSize} by ${cropSize} Pixel region`} /> : <div className="pixel-inspector__pending-box">Choose a Strength to compare the selected region.</div>}</figure>
            {!afterStateReady || (!isTwoStateMode && !adjustedSelected) ? <canvas ref={modifiedCropRef} hidden aria-hidden="true" /> : null}
          </section>
          </div>
          {!isCropOnlyMode ? <p className="pixel-inspector__grid-link">The outlined 8×8 area below is enlarged into the Pixel Grids. Both grids show the same coordinates before and after modification. The 32×32 region contains 1,024 pixels, so displaying all of them as interactive cells and RGB values would make them too small to inspect clearly. The fixed central 8×8 area provides a readable sample; it is not treated as more important or more causal than other pixels.</p> : null}
          </div>
          {!isCropOnlyMode ? <>
          <div className="pixel-inspector__analysis-pair">
          {pixelGrid && originalPixel && attackedPixel && modifiedPixel ? <section className="pixel-inspector__micro-view" aria-label="Single pixel RGB comparison">
            <div className="pixel-inspector__micro-heading"><div><strong>8×8 real Pixel Grid</strong><span>{isTwoStateMode ? `Select one coordinate to compare its ${beforeLabel} and ${afterLabel} RGB values.` : `Select one coordinate to compare its Original, ${currentStateLabel} and latest Adjusted RGB values.`}</span></div><span>x={pixelGrid.origin.x}–{pixelGrid.origin.x + PIXEL_GRID_SIZE - 1}, y={pixelGrid.origin.y}–{pixelGrid.origin.y + PIXEL_GRID_SIZE - 1}</span></div>
            <div className={`pixel-inspector__micro-grids ${isTwoStateMode ? '' : 'pixel-inspector__micro-grids--three'}`}>
              <figure><figcaption>{beforeLabel}</figcaption>{renderPixelGrid(pixelGrid.original, `${beforeLabel} Pixel Grid`)}</figure>
              {!isTwoStateMode ? <figure><figcaption>{currentStateLabel}</figcaption>{renderPixelGrid(pixelGrid.attacked, `${currentStateLabel} Pixel Grid`)}</figure> : null}
              {isTwoStateMode || adjustedSelected ? <figure><figcaption>{isTwoStateMode ? afterLabel : 'Adjusted'}</figcaption>{renderPixelGrid(pixelGrid.modified, `${isTwoStateMode ? afterLabel : 'Adjusted'} Pixel Grid`)}</figure> : <figure className="pixel-inspector__pending"><figcaption>Adjusted</figcaption><div className="pixel-inspector__pending-box">Select a new parameter to display this 8×8 grid.</div></figure>}
            </div>
            <dl className="pixel-inspector__rgb-readout">
              <div className="pixel-inspector__coordinate"><dt>Selected pixel coordinate</dt><dd>({pixelGrid.origin.x + selectedX}, {pixelGrid.origin.y + selectedY})</dd></div>
              <div><dt>{beforeLabel} RGB</dt><dd>R{originalPixel.red} G{originalPixel.green} B{originalPixel.blue}</dd></div>
              {!isTwoStateMode ? <div><dt>{currentStateLabel} RGB</dt><dd>R{attackedPixel.red} G{attackedPixel.green} B{attackedPixel.blue}</dd></div> : null}
              <div><dt>{isTwoStateMode ? `${afterLabel} RGB` : 'Adjusted RGB'}</dt><dd>{isTwoStateMode || adjustedSelected ? `R${modifiedPixel.red} G${modifiedPixel.green} B${modifiedPixel.blue}` : 'Waiting for a new parameter'}</dd></div>
              <div><dt>{isTwoStateMode ? 'RGB change' : 'Latest adjustment'}</dt><dd>{isTwoStateMode || adjustedSelected ? <><span>R {signedChange(modifiedPixel.red - (isTwoStateMode ? originalPixel.red : attackedPixel.red))}</span><span>G {signedChange(modifiedPixel.green - (isTwoStateMode ? originalPixel.green : attackedPixel.green))}</span><span>B {signedChange(modifiedPixel.blue - (isTwoStateMode ? originalPixel.blue : attackedPixel.blue))}</span></> : 'Not available yet'}</dd></div>
            </dl>
            {isTwoStateMode || adjustedSelected ? <figure className="pixel-inspector__rgb-chart" aria-label="Selected pixel RGB value change chart">
              <figcaption>Selected pixel RGB values: {isTwoStateMode ? `${beforeLabel} → ${afterLabel}` : 'Original → Initial (attacked) → Adjusted'}</figcaption>
              <svg viewBox="0 0 520 190" role="img" aria-label="Line chart comparing original attacked and adjusted red green and blue values">
                <line x1="45" y1="15" x2="45" y2="155" /><line x1="45" y1="155" x2="370" y2="155" />
                <text x="75" y="178">{beforeLabel}</text>{isTwoStateMode ? <text x="305" y="178">{afterLabel}</text> : <><text x="180" y="178">Initial</text><text x="305" y="178">Adjusted</text></>}
                {chartValues.map(([channel, original, attacked, adjusted, colour], index) => {
                  const values = isTwoStateMode ? [original, adjusted] : [original, attacked, adjusted]
                  const xPositions = isTwoStateMode ? [100, 330] : [100, 215, 330]
                  const points = values.map((value, point) => `${xPositions[point]},${155 - (value / 255) * 130}`).join(' ')
                  return <g key={channel}><polyline points={points} fill="none" stroke={colour} strokeWidth="3" />{values.map((value, point) => <circle key={point} cx={xPositions[point]} cy={155 - (value / 255) * 130} r="5" fill={colour} />)}<text className="rgb-chart-legend" x="390" y={28 + index * 19} fill={colour}>{isTwoStateMode ? `${channel} ${original} → ${adjusted}` : `${channel} ${original} → ${attacked} → ${adjusted}`}</text></g>
                })}
              </svg>
            </figure> : <div className="pixel-inspector__pending-box pixel-inspector__pending-chart">Select a new Pixel Strength to display the three-state RGB chart.</div>}
            <p>A Pixel modification makes small RGB changes across many pixels. This selected pixel is one example, not proof that it alone caused the classification result.</p>
          </section> : null}
          </div>
          <section className="pixel-inspector__module pixel-inspector__difference-module" aria-labelledby="difference-heading">
            {isTwoStateMode ? <figure className="pixel-inspector__single-crop"><canvas ref={differenceCropRef} aria-label={`Enhanced difference from ${differenceBeforeLabel} to ${differenceAfterLabel} for the same ${PIXEL_GRID_SIZE} by ${PIXEL_GRID_SIZE} Pixel region; selected pixel x ${selectedX}, y ${selectedY}`} /></figure> : <div className="pixel-inspector__difference-views" aria-label="Three Stage 3 Enhanced Difference comparisons">
              <figure><figcaption><strong>1. Original ↔ {currentStateLabel}</strong><span>Changes introduced by the attack</span></figcaption><canvas ref={attackDifferenceRef} aria-label={`Enhanced difference from Original to ${currentStateLabel} for the same ${PIXEL_GRID_SIZE} by ${PIXEL_GRID_SIZE} Pixel region; selected pixel x ${selectedX}, y ${selectedY}`} /></figure>
              <figure><figcaption><strong>2. {currentStateLabel} ↔ Adjusted</strong><span>Changes made during this repair</span></figcaption><canvas ref={differenceCropRef} aria-label={`Enhanced difference from ${currentStateLabel} to Adjusted for the same ${PIXEL_GRID_SIZE} by ${PIXEL_GRID_SIZE} Pixel region; selected pixel x ${selectedX}, y ${selectedY}`} /></figure>
              <figure><figcaption><strong>3. Original ↔ Adjusted</strong><span>Difference remaining after repair</span></figcaption><canvas ref={remainingDifferenceRef} aria-label={`Enhanced difference from Original to Adjusted for the same ${PIXEL_GRID_SIZE} by ${PIXEL_GRID_SIZE} Pixel region; selected pixel x ${selectedX}, y ${selectedY}`} /></figure>
            </div>}
            <div className="pixel-inspector__difference-copy">
              <strong id="difference-heading">Enhanced Difference · Same {PIXEL_GRID_SIZE}×{PIXEL_GRID_SIZE} Region</strong>
              {isTwoStateMode ? <p><strong>Comparison:</strong> {differenceBeforeLabel} → {differenceAfterLabel}. This matches the two RGB grids above.</p> : <p>All three helper views use the same {PIXEL_GRID_SIZE}×{PIXEL_GRID_SIZE} coordinates as the RGB grids above. Together they separate the changes introduced by the attack, the changes made during repair, and the difference that remains from Original.</p>}
              <p>This view shows the same {PIXEL_GRID_SIZE}×{PIXEL_GRID_SIZE} region as the RGB grids above. Each square corresponds to the same pixel coordinate, so you can compare its RGB values with the enhanced difference. The blue outline marks the pixel currently selected in the RGB grids.</p>
              <EnhancedDifferenceExplanation />
              <details><summary>How is this helper view calculated?</summary>{isTwoStateMode ? <p className="pixel-inspector__difference-intro">For each pixel, the view calculates the absolute change in each colour channel: <strong>|{differenceAfterLabel} − {differenceBeforeLabel}| × {DIFFERENCE_ENHANCEMENT}</strong>. A change of 3 is displayed more brightly than a change of 1, while +3 and −3 have the same brightness. The resulting colour reflects the relative magnitudes of the R, G and B differences.</p> : <div className="pixel-inspector__difference-intro"><p><strong>1.</strong> |{currentStateLabel} − Original| × {DIFFERENCE_ENHANCEMENT}</p><p><strong>2.</strong> |Adjusted − {currentStateLabel}| × {DIFFERENCE_ENHANCEMENT}</p><p><strong>3.</strong> |Adjusted − Original| × {DIFFERENCE_ENHANCEMENT}</p><p>A change of 3 is displayed more brightly than a change of 1, while +3 and −3 have the same brightness.</p></div>}</details>
              <p className="difference-notice">This view shows RGB change magnitude. It does not prove that any displayed pixel is the unique cause of the classification result.</p>
            </div>
          </section>
          </> : null}
        </> : null}
    </section>
  )
}

export function FixedPixelRegionImage({ title, imageUrl, alt, details, cropSize = DEFAULT_CROP_SIZE }: { title: string; imageUrl: string; alt: string; details: string; cropSize?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadImage(imageUrl, 0).then((image) => {
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvasContext(canvas)
      context.drawImage(image, 0, 0)
      const region = clampCropOrigin(image.naturalWidth / 2, image.naturalHeight / 2, image.naturalWidth, image.naturalHeight, cropSize)
      context.strokeStyle = '#ff8f4d'
      context.lineWidth = Math.max(2, Math.round(image.naturalWidth / 180))
      context.strokeRect(region.x, region.y, cropSize, cropSize)
      setError(null)
    }).catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : 'The fixed Pixel region could not be displayed.')
    })
    return () => { cancelled = true }
  }, [cropSize, imageUrl])

  return <figure className="image-preview-card fixed-pixel-region-card"><div className="card-heading"><strong>{title}</strong></div><canvas ref={canvasRef} role="img" aria-label={alt} hidden={error !== null} />{error ? <div className="fixed-pixel-region-card__error" role="alert">{error}</div> : null}<figcaption><span>{details}</span><span>Orange frame: fixed {cropSize}×{cropSize} region</span></figcaption></figure>
}
