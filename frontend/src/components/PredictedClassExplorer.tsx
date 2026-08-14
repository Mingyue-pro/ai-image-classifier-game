import { useState } from 'react'
import { ChevronDown, Images } from 'lucide-react'

import { getPredictedClassExamples, resolveApiUrl } from '../api'
import type { PredictedClassExamples } from '../types'


type LoadState = 'idle' | 'loading' | 'loaded' | 'error'

type ComparisonExamples = {
  expected: PredictedClassExamples
  predicted: PredictedClassExamples
}

function ExampleGroup({ title, result }: { title: string; result: PredictedClassExamples }) {
  return (
    <section className="predicted-class-example-group" aria-label={`${title}: ${result.label}`}>
      <div className="predicted-class-example-group__heading">
        <span>{title}</span>
        <strong>{result.label}</strong>
      </div>
      {result.examples.length === 0 ? <p>No local representative examples are available for this class.</p> : (
        <div className="predicted-class-example-grid">
          {result.examples.map((example) => (
            <figure key={example.image_url}>
              <img src={resolveApiUrl(example.image_url)} alt={example.alt} />
              <figcaption>
                <span>{example.alt}</span>
                <small>Source: {example.source}</small>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  )
}

export function PredictedClassExplorer({ expectedLabel, predictedLabel }: { expectedLabel: string; predictedLabel: string }) {
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [results, setResults] = useState<ComparisonExamples | null>(null)

  async function loadExamples() {
    if (loadState !== 'idle') return
    setLoadState('loading')
    try {
      const [expected, predicted] = await Promise.all([
        getPredictedClassExamples(expectedLabel),
        getPredictedClassExamples(predictedLabel),
      ])
      setResults({ expected, predicted })
      setLoadState('loaded')
    } catch {
      setLoadState('error')
    }
  }

  return (
    <details
      className="predicted-class-explorer"
      onToggle={(event) => {
        if (event.currentTarget.open) void loadExamples()
      }}
    >
      <summary aria-label={`Explore classification evidence for ${expectedLabel} and ${predictedLabel}`}>
        <span><Images size={20} />Explore the classification evidence</span>
        <ChevronDown size={20} />
      </summary>
      <div className="predicted-class-explorer__content">
        <p>Compare representative examples of the expected and predicted ImageNet classes. They may support a visual hypothesis, but they do not prove which training images or features caused this prediction.</p>
        {loadState === 'loading' ? <p role="status">Loading representative examples…</p> : null}
        {loadState === 'error' ? <p role="alert">Representative examples could not be loaded.</p> : null}
        {loadState === 'loaded' && results ? (
          <div className="predicted-class-comparison">
            <ExampleGroup title="Expected class" result={results.expected} />
            <ExampleGroup title="Model predicted" result={results.predicted} />
          </div>
        ) : null}
      </div>
    </details>
  )
}
