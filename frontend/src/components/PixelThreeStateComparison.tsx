import { useEffect, useRef, useState } from 'react'

import type { Prediction } from '../types'
import { ClassificationResultCard, ImagePreviewCard } from './GameUi'
import { EnhancedDifferenceExplanation } from './PixelLearning'
import { computeEnhancedDifference } from './pixelDifference'

const CROP_SIZE = 32
const GRID_SIZE = 8
const SCALE = 8
const DIFFERENCE_SCALE = 32

type Rgb = { red: number; green: number; blue: number }
type Loaded = { original: HTMLImageElement; attacked: HTMLImageElement; repaired: HTMLImageElement }
type GridData = { originX: number; originY: number; original: Rgb[]; attacked: Rgb[]; repaired: Rgb[] }
type CropOrigin = { x: number; y: number }

type Props = {
  originalUrl: string
  attackedUrl: string
  repairedUrl: string
  attackedStrength: number
  repairedStrength: number
  attackedPrediction: Prediction
  repairedPrediction: Prediction
  correctLabel: string
  subject: string
  classificationRestored: boolean
  revealOriginalStrength: boolean
  cropSelectionSource?: 'original' | 'attacked'
  cropSelectionLabel?: string
  showConfidenceExplanation?: boolean
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    let attempt = 0
    const load = () => {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.onload = () => resolve(image)
      image.onerror = () => {
        if (attempt < 1) {
          attempt += 1
          load()
          return
        }
        reject(new Error(`Could not load image: ${url}`))
      }
      const separator = url.includes('?') ? '&' : '?'
      image.src = `${url}${separator}pixel_compare=${Date.now()}-${attempt}`
    }
    load()
  })
}

function context(canvas: HTMLCanvasElement) {
  const result = canvas.getContext('2d', { willReadFrequently: true })
  if (!result) throw new Error('Canvas drawing is unavailable.')
  return result
}

function crop(image: HTMLImageElement, x: number, y: number, size: number) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = context(canvas)
  ctx.drawImage(image, x, y, size, size, 0, 0, size, size)
  return ctx.getImageData(0, 0, size, size)
}

function draw(data: ImageData, target: HTMLCanvasElement) {
  const source = document.createElement('canvas')
  source.width = data.width
  source.height = data.height
  context(source).putImageData(data, 0, 0)
  target.width = data.width * SCALE
  target.height = data.height * SCALE
  const ctx = context(target)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(source, 0, 0, target.width, target.height)
}

function outlineGridArea(target: HTMLCanvasElement) {
  const inset = Math.floor((CROP_SIZE - GRID_SIZE) / 2) * SCALE
  const size = GRID_SIZE * SCALE
  const ctx = context(target)
  ctx.strokeStyle = '#25a7c4'
  ctx.lineWidth = 2
  ctx.strokeRect(inset + 1, inset + 1, size - 2, size - 2)
}

function outlineSelectedPixel(target: HTMLCanvasElement, selected: number) {
  const x = (selected % GRID_SIZE) * SCALE
  const y = Math.floor(selected / GRID_SIZE) * SCALE
  const ctx = context(target)
  ctx.strokeStyle = '#25a7c4'
  ctx.lineWidth = 2
  ctx.strokeRect(x + 1, y + 1, SCALE - 2, SCALE - 2)
}

function difference(first: ImageData, second: ImageData) {
  return new ImageData(new Uint8ClampedArray(computeEnhancedDifference(first.data, second.data, DIFFERENCE_SCALE)), first.width, first.height)
}

function pixels(data: ImageData): Rgb[] {
  const result: Rgb[] = []
  for (let index = 0; index < data.data.length; index += 4) result.push({ red: data.data[index], green: data.data[index + 1], blue: data.data[index + 2] })
  return result
}

function OriginalClassification({ correctLabel }: { correctLabel: string }) {
  return <section className="classification-card" aria-label="Original classification"><div className="card-heading"><strong>Original classification</strong><span className="status-badge status-badge--success">Correct</span></div><p className="result-label">{correctLabel}</p><dl><div><dt>True class</dt><dd>{correctLabel}</dd></div><div><dt>AI's current main classification judgement</dt><dd>Matches true class before attack</dd></div></dl></section>
}

export function PixelThreeStateComparison(props: Props) {
  const overviewRef = useRef<HTMLCanvasElement>(null)
  const originalCropRef = useRef<HTMLCanvasElement>(null)
  const attackedCropRef = useRef<HTMLCanvasElement>(null)
  const repairedCropRef = useRef<HTMLCanvasElement>(null)
  const attackDifferenceRef = useRef<HTMLCanvasElement>(null)
  const remainingDifferenceRef = useRef<HTMLCanvasElement>(null)
  const repairDifferenceRef = useRef<HTMLCanvasElement>(null)
  const [grid, setGrid] = useState<GridData | null>(null)
  const [selected, setSelected] = useState(0)
  const [cropOrigin, setCropOrigin] = useState<CropOrigin | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([loadImage(props.originalUrl), loadImage(props.attackedUrl), loadImage(props.repairedUrl)]).then(([original, attacked, repaired]: HTMLImageElement[]) => {
      if (cancelled) return
      const loaded: Loaded = { original, attacked, repaired }
      const width = Math.min(original.naturalWidth, attacked.naturalWidth, repaired.naturalWidth)
      const height = Math.min(original.naturalHeight, attacked.naturalHeight, repaired.naturalHeight)
      const centred = { x: Math.max(0, Math.floor((width - CROP_SIZE) / 2)), y: Math.max(0, Math.floor((height - CROP_SIZE) / 2)) }
      const x = Math.max(0, Math.min(width - CROP_SIZE, cropOrigin?.x ?? centred.x))
      const y = Math.max(0, Math.min(height - CROP_SIZE, cropOrigin?.y ?? centred.y))
      if (!cropOrigin) setCropOrigin({ x, y })
      const overview = overviewRef.current
      if (overview) {
        overview.width = width
        overview.height = height
        const overviewContext = context(overview)
        overviewContext.drawImage(props.cropSelectionSource === 'attacked' ? attacked : original, 0, 0, width, height)
        overviewContext.strokeStyle = '#ff8f4d'
        overviewContext.lineWidth = Math.max(2, Math.round(width / 250))
        overviewContext.strokeRect(x, y, CROP_SIZE, CROP_SIZE)
      }
      const crops = [crop(loaded.original, x, y, CROP_SIZE), crop(loaded.attacked, x, y, CROP_SIZE), crop(loaded.repaired, x, y, CROP_SIZE)]
      const cropTargets = [originalCropRef.current, attackedCropRef.current, repairedCropRef.current]
      cropTargets.forEach((target, index) => { if (target) { draw(crops[index], target); outlineGridArea(target) } })
      const gridX = x + Math.floor((CROP_SIZE - GRID_SIZE) / 2)
      const gridY = y + Math.floor((CROP_SIZE - GRID_SIZE) / 2)
      const gridCrops = [crop(loaded.original, gridX, gridY, GRID_SIZE), crop(loaded.attacked, gridX, gridY, GRID_SIZE), crop(loaded.repaired, gridX, gridY, GRID_SIZE)]
      const differences = [difference(gridCrops[0], gridCrops[1]), difference(gridCrops[0], gridCrops[2]), difference(gridCrops[1], gridCrops[2])]
      const differenceTargets = [attackDifferenceRef.current, remainingDifferenceRef.current, repairDifferenceRef.current]
      differenceTargets.forEach((target, index) => { if (target) { draw(differences[index], target); outlineSelectedPixel(target, selected) } })
      setGrid({ originX: gridX, originY: gridY, original: pixels(gridCrops[0]), attacked: pixels(gridCrops[1]), repaired: pixels(gridCrops[2]) })
      setError(null)
    }).catch((caught: unknown) => { if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load comparison images.') })
    return () => { cancelled = true }
  }, [cropOrigin, props.originalUrl, props.attackedUrl, props.repairedUrl, props.cropSelectionSource, selected])

  function selectCrop(event: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget
    const bounds = canvas.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    const centreX = (event.clientX - bounds.left) * canvas.width / bounds.width
    const centreY = (event.clientY - bounds.top) * canvas.height / bounds.height
    setCropOrigin({
      x: Math.max(0, Math.min(canvas.width - CROP_SIZE, Math.round(centreX - CROP_SIZE / 2))),
      y: Math.max(0, Math.min(canvas.height - CROP_SIZE, Math.round(centreY - CROP_SIZE / 2))),
    })
    setSelected(0)
  }

  const selectedValues = grid ? [grid.original[selected], grid.attacked[selected], grid.repaired[selected]] : null
  const selectedX = grid ? grid.originX + selected % GRID_SIZE : 0
  const selectedY = grid ? grid.originY + Math.floor(selected / GRID_SIZE) : 0
  const cropSelectionLabel = props.cropSelectionLabel ?? 'Original'

  function pixelGrid(values: Rgb[], label: string) {
    return <figure><figcaption>{label}</figcaption><div className="pixel-inspector__pixel-grid" role="grid" aria-label={`${label} 8 by 8 Pixel Grid`}>{values.map((value, index) => <button key={index} type="button" role="gridcell" aria-selected={selected === index} className={selected === index ? 'is-selected' : ''} aria-label={`${label} pixel ${index}`} style={{ backgroundColor: `rgb(${value.red} ${value.green} ${value.blue})` }} onClick={() => setSelected(index)} />)}</div></figure>
  }

  return <section className="pixel-three-state" aria-label="Original attacked and repaired Pixel comparison">
    <div className="pixel-three-state__full-images">
      <div><ImagePreviewCard title="Original · Correct reference" imageUrl={props.originalUrl} alt={`Original unmodified ${props.subject} image`} details={props.revealOriginalStrength ? <span>Strength: 0/255</span> : <span>Correctly classified reference image</span>} /><OriginalClassification correctLabel={props.correctLabel} /></div>
      <div><ImagePreviewCard title="Initial (attacked)" imageUrl={props.attackedUrl} alt={`Initial attacked ${props.subject} image`} details={<span>Strength: {props.attackedStrength}/255</span>} /><ClassificationResultCard title="Initial classification" prediction={props.attackedPrediction} correctLabel={props.correctLabel} showConfidenceExplanation={props.showConfidenceExplanation} /></div>
      <div><ImagePreviewCard title="Repaired / Modified" imageUrl={props.repairedUrl} alt={`Repaired modified ${props.subject} image`} details={<span>Strength: {props.repairedStrength}/255</span>} /><ClassificationResultCard title="Repaired classification" prediction={props.repairedPrediction} correctLabel={props.correctLabel} showConfidenceExplanation={props.showConfidenceExplanation} /></div>
    </div>
    <p className="pixel-three-state__sequence-note">Original → Initial (attacked) → Adjusted shows how the attack and this repair adjustment were associated with the model’s classifications. {props.classificationRestored ? "In this case, the model's original classification returned." : 'In this case, the original classification did not return, so lower strength is not a guaranteed fix.'}</p>
    {error ? <p role="alert" className="pixel-inspector__error">{error}</p> : null}
    <section className="pixel-three-state__layer"><h3>Pixel Inspector · Select a 32×32 Region</h3><p>Click the {cropSelectionLabel} image below to select a 32×32 region. The same coordinates are then used for Original, Initial (attacked) and Adjusted.</p><figure className="pixel-three-state__crop-selector"><canvas ref={overviewRef} onClick={selectCrop} aria-label={`Select a 32 by 32 comparison region from the ${cropSelectionLabel} image`} /><figcaption>{cropOrigin ? `Selected 32×32 region: x=${cropOrigin.x}–${cropOrigin.x + CROP_SIZE - 1}, y=${cropOrigin.y}–${cropOrigin.y + CROP_SIZE - 1}` : 'Loading region selector…'}</figcaption></figure><p>The blue outlined 8×8 area in each region is enlarged into the Pixel Grids below. All three outlines refer to exactly the same coordinates.</p><div className="pixel-three-state__triplet"><figure><figcaption>Original</figcaption><canvas ref={originalCropRef} aria-label="Original 32 by 32 region" /></figure><figure><figcaption>Initial (attacked)</figcaption><canvas ref={attackedCropRef} aria-label="Initial attacked 32 by 32 region" /></figure><figure><figcaption>Adjusted</figcaption><canvas ref={repairedCropRef} aria-label="Adjusted 32 by 32 region" /></figure></div></section>
    <section className="pixel-three-state__layer pixel-three-state__difference-layer"><h3>Enhanced Difference · Same 8×8 Region</h3><p>These views show the same 8×8 coordinates as the RGB grids above. Each square corresponds to the same pixel coordinate, and the blue outline marks the pixel selected in the RGB grids.</p><EnhancedDifferenceExplanation /><div className="pixel-inspector__difference-views" aria-label="Three Stage 3 Enhanced Difference comparisons"><figure><figcaption><strong>1. Original ↔ Initial (attacked)</strong><span>Changes introduced by the attack</span></figcaption><canvas ref={attackDifferenceRef} aria-label="Original to Initial attacked Enhanced Difference for the same 8 by 8 region" /></figure><figure><figcaption><strong>2. Initial (attacked) ↔ Adjusted</strong><span>Changes made during this repair</span></figcaption><canvas ref={repairDifferenceRef} aria-label="Initial attacked to Adjusted Enhanced Difference for the same 8 by 8 region" /></figure><figure><figcaption><strong>3. Original ↔ Adjusted</strong><span>Difference remaining after repair</span></figcaption><canvas ref={remainingDifferenceRef} aria-label="Original to Adjusted Enhanced Difference for the same 8 by 8 region" /></figure></div><details><summary>How is this helper view calculated?</summary><div className="pixel-inspector__difference-intro"><p><strong>1.</strong> |Initial (attacked) − Original| × {DIFFERENCE_SCALE}</p><p><strong>2.</strong> |Adjusted − Initial (attacked)| × {DIFFERENCE_SCALE}</p><p><strong>3.</strong> |Adjusted − Original| × {DIFFERENCE_SCALE}</p><p>A change of 3 is displayed more brightly than a change of 1, while +3 and −3 have the same brightness.</p></div></details><p className="difference-notice">These views show RGB change magnitude. They do not prove that any displayed pixel is the unique cause of the classification result.</p></section>
    {grid && selectedValues ? <section className="pixel-three-state__layer"><div className="pixel-inspector__micro-heading"><div><h3>8×8 real Pixel Grid</h3><span>Each grid enlarges the blue-outlined central 8×8 coordinates from its selected 32×32 region.</span></div><span>Selected pixel coordinate: ({selectedX}, {selectedY})</span></div><div className="pixel-three-state__triplet pixel-three-state__grids">{pixelGrid(grid.original, 'Original')}{pixelGrid(grid.attacked, 'Initial (attacked)')}{pixelGrid(grid.repaired, 'Adjusted')}</div><div className="pixel-three-state__rgb-sequence">{['Original RGB', 'Initial (attacked) RGB', 'Adjusted RGB'].map((label, index) => <div key={label}><small>{label}</small><strong>R{selectedValues[index].red} G{selectedValues[index].green} B{selectedValues[index].blue}</strong></div>)}</div><figure className="pixel-three-state__chart"><figcaption>Selected pixel RGB values: Original → Initial (attacked) → Adjusted</figcaption><svg viewBox="0 0 620 230" role="img" aria-label="Three-state RGB chart">{([['R', 'red', '#d95b4f'], ['G', 'green', '#438b62'], ['B', 'blue', '#4777b8']] as const).map(([label, key, colour], row) => { const points = selectedValues.map((value, index) => `${130 + index * 170},${180 - value[key] / 255 * 140}`).join(' '); return <g key={label}><polyline points={points} fill="none" stroke={colour} strokeWidth="4" />{selectedValues.map((value, index) => <circle key={index} cx={130 + index * 170} cy={180 - value[key] / 255 * 140} r="6" fill={colour} />)}<text x="520" y={35 + row * 22} fill={colour}>{label}: {selectedValues.map((value) => value[key]).join(' → ')}</text></g> })}<text x="98" y="215">Original</text><text x="260" y="215">Initial</text><text x="438" y="215">Adjusted</text></svg></figure><p className="pixel-three-state__conclusion">The attack introduced small RGB changes across many pixels. After repair, the image became closer to the original input{props.classificationRestored ? ' and the correct classification was restored.' : ', but the correct classification was not restored in this attempt.'}</p></section> : null}
  </section>
}
