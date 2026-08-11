import { useEffect, useRef, useState } from 'react'
import { Crosshair, ScanSearch } from 'lucide-react'

import { computeEnhancedDifference } from './pixelDifference'


const DEFAULT_CROP_SIZE = 32
const DEFAULT_MAGNIFICATION = 10
const DIFFERENCE_ENHANCEMENT = 32

type LoadedImages = {
  original: HTMLImageElement
  modified: HTMLImageElement
}

type CropOrigin = { x: number; y: number }

type PixelInspectorProps = {
  originalUrl: string
  modifiedUrl: string
  subject: string
  strength: number
  cropSize?: number
  magnification?: number
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

export function PixelInspector({
  originalUrl,
  modifiedUrl,
  subject,
  strength,
  cropSize = DEFAULT_CROP_SIZE,
  magnification = DEFAULT_MAGNIFICATION,
}: PixelInspectorProps) {
  const overviewRef = useRef<HTMLCanvasElement>(null)
  const originalCropRef = useRef<HTMLCanvasElement>(null)
  const modifiedCropRef = useRef<HTMLCanvasElement>(null)
  const differenceCropRef = useRef<HTMLCanvasElement>(null)
  const [images, setImages] = useState<LoadedImages | null>(null)
  const [origin, setOrigin] = useState<CropOrigin>({ x: 0, y: 0 })
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([loadImage(originalUrl, reloadToken), loadImage(modifiedUrl, reloadToken)])
      .then(([original, modified]) => {
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
        setImages({ original, modified })
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
      const modifiedTarget = modifiedCropRef.current
      const differenceTarget = differenceCropRef.current
      if (!overview || !originalTarget || !modifiedTarget || !differenceTarget) {
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
      drawPixelatedImage(modifiedCrop, modifiedTarget, magnification)
      drawPixelatedImage(differenceCrop, differenceTarget, magnification)
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

  return (
    <section className="pixel-inspector" aria-label={`Pixel Inspector for ${subject}`}>
      <div className="pixel-inspector__heading">
        <div><ScanSearch size={20} /><strong>Pixel Inspector</strong></div>
        <dl>
          <div><dt>Strength</dt><dd>{strength}/255</dd></div>
          <div><dt>Crop</dt><dd>{cropSize}×{cropSize} px</dd></div>
          <div><dt>Position</dt><dd>x={origin.x}, y={origin.y}</dd></div>
        </dl>
      </div>
      {error ? <div className="pixel-inspector__error" role="alert"><span>{error}</span><button type="button" onClick={retryImages}>Retry images</button></div> : (
        <>
          <figure className="pixel-inspector__overview">
            <canvas ref={overviewRef} onClick={selectRegion} aria-label={`Select Pixel inspection region for ${subject}`} />
            <figcaption><Crosshair size={16} />Click the full image to inspect another {cropSize}×{cropSize} region. Edge selections are kept inside the image.</figcaption>
          </figure>
          {!images ? <p className="pixel-inspector__loading" role="status">Loading Original and Modified images…</p> : null}
          <div className="pixel-inspector__crops">
            <figure><strong>Original</strong><canvas ref={originalCropRef} aria-label={`Original ${cropSize} by ${cropSize} Pixel crop`} /></figure>
            <figure><strong>Modified</strong><canvas ref={modifiedCropRef} aria-label={`Modified ${cropSize} by ${cropSize} Pixel crop`} /></figure>
            <figure><strong>Enhanced difference</strong><canvas ref={differenceCropRef} aria-label={`Enhanced difference ${cropSize} by ${cropSize} Pixel crop`} /></figure>
          </div>
          <ul className="pixel-inspector__difference-legend" aria-label="Enhanced difference colour guide">
            <li><strong>Black:</strong> No visible pixel difference.</li>
            <li><strong>Dark grey:</strong> A small pixel difference.</li>
            <li><strong>Bright grey or colour:</strong> A larger pixel difference, or different amounts of change across the red, green and blue (RGB) channels.</li>
          </ul>
          <p className="difference-notice">Enhanced difference shows |Modified − Original| × {DIFFERENCE_ENHANCEMENT}, clamped to 0–255, for visual inspection only. The actual attack strength remains {strength}/255 and is not changed.</p>
        </>
      )}
    </section>
  )
}
