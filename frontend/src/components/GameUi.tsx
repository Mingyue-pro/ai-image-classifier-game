import type { ReactNode } from 'react'
import { Check, Home, Leaf, ShieldCheck } from 'lucide-react'

import type { Prediction } from '../types'

export function AppHeader({ onHome }: { onHome: () => void }) {
  return (
    <header className="app-header">
      <button className="brand brand-button" type="button" onClick={onHome} aria-label="AI Image Classification Garden home">
        <span className="brand-mark" aria-hidden="true"><Leaf size={20} /></span>
        <span>AI Image Classification Garden</span>
      </button>
      <nav className="header-actions" aria-label="Application navigation">
        <button className="home-link" type="button" onClick={onHome}><Home size={16} /> Home</button>
      </nav>
    </header>
  )
}

export function MissionHeader({ stage, title, subtitle }: { stage: string; title: string; subtitle: string }) {
  return (
    <header className="mission-header">
      <div><p className="eyebrow">{stage}</p><h1>{title}</h1><p>{subtitle}</p></div>
    </header>
  )
}

export function StepProgress({ steps, currentIndex }: { steps: readonly string[]; currentIndex: number }) {
  return (
    <ol className="stage-stepper" aria-label="Learning activity steps">
      {steps.map((step, index) => (
        <li key={step} className={index === currentIndex ? 'is-current' : index < currentIndex ? 'is-complete' : ''}>
          <span>{index < currentIndex ? <Check size={14} /> : index + 1}</span>{step}
        </li>
      ))}
    </ol>
  )
}

export function PanelTitle({ label, title, description, className = '' }: { label: string; title: string; description: ReactNode; className?: string }) {
  return <div className={`panel-title ${className}`.trim()}><p>{label}{label === 'Manipulate' ? ' · This round’s repair direction' : ''}</p><h2>{title}</h2><span>{description}</span></div>
}

export function StatusBadge({ tone, children }: { tone: 'neutral' | 'success' | 'warning'; children: ReactNode }) {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>
}

export function ImagePreviewCard({ title, imageUrl, alt, details }: { title: string; imageUrl: string; alt: string; details?: ReactNode }) {
  return <figure className="image-preview-card"><div className="card-heading"><strong>{title}</strong></div><img src={imageUrl} alt={alt} />{details ? <figcaption>{details}</figcaption> : null}</figure>
}

export function ClassificationResultCard({ title, prediction, correctLabel, reveal = true, details, showConfidenceExplanation = true }: { title: string; prediction?: Prediction; correctLabel: string; reveal?: boolean; details?: ReactNode; showConfidenceExplanation?: boolean }) {
  const correct = prediction?.label === correctLabel
  return (
    <section className="classification-card" aria-label={title}>
      <div className="card-heading"><strong>{title}</strong>{reveal && prediction ? <StatusBadge tone={correct ? 'success' : 'warning'}>{correct ? 'Correct' : 'Changed'}</StatusBadge> : null}</div>
      {reveal && prediction ? <><p className="result-label">{prediction.label}</p><p className="confidence"><strong>Classification confidence:</strong> {(prediction.probability * 100).toFixed(1)}%</p>{showConfidenceExplanation ? <p className="confidence-explanation">This shows how strongly the model favours its current classification. A higher score means a stronger preference for that category, but it does not mean the result is correct.</p> : null}<dl><div><dt>True class</dt><dd>{correctLabel}</dd></div><div><dt>Classification Status</dt><dd>{correct ? 'Matches true class' : 'Does not match true class'}</dd></div>{details}</dl></> : <div className="hidden-result"><ShieldCheck size={24} /><strong>Result hidden</strong><span>Reclassify to reveal the verified result.</span></div>}
    </section>
  )
}

export function SimulationNotice({ children = 'Stage 1 uses fixed modifications to test classification results.' }: { children?: ReactNode }) {
  return <p className="simulation-notice"><ShieldCheck size={16} /> {children}</p>
}
