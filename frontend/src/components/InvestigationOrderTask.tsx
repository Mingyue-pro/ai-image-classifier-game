import { useState } from 'react'
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react'

export type InvestigationStepId = 'observe' | 'predict' | 'manipulate' | 'reclassify' | 'compare'
export type InvestigationOrderResult = {
  initial_order: InvestigationStepId[]
  final_order: InvestigationStepId[]
  order_attempts: number
  correct_on_first_try: boolean
}

const CORRECT_ORDER: InvestigationStepId[] = ['observe', 'predict', 'manipulate', 'reclassify', 'compare']
const INITIAL_ORDER: InvestigationStepId[] = ['compare', 'observe', 'reclassify', 'predict', 'manipulate']
const LABELS: Record<InvestigationStepId, string> = {
  observe: 'Observe the image and current classification',
  predict: 'Predict a repair direction',
  manipulate: 'Change one repair setting',
  reclassify: 'Reclassify the modified image',
  compare: 'Compare the new result with the previous result',
}

function isCorrect(order: InvestigationStepId[]): boolean {
  return order.every((step, index) => step === CORRECT_ORDER[index])
}

export function InvestigationOrderTask({ onComplete }: { onComplete: (result: InvestigationOrderResult) => void }) {
  const [order, setOrder] = useState<InvestigationStepId[]>(INITIAL_ORDER)
  const [firstSubmittedOrder, setFirstSubmittedOrder] = useState<InvestigationStepId[] | null>(null)
  const [attempts, setAttempts] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [draggedStep, setDraggedStep] = useState<InvestigationStepId | null>(null)
  const [complete, setComplete] = useState(false)

  function move(index: number, offset: -1 | 1) {
    const destination = index + offset
    if (complete || destination < 0 || destination >= order.length) return
    setOrder((current) => {
      const next = [...current]
      ;[next[index], next[destination]] = [next[destination], next[index]]
      return next
    })
    setMessage(null)
  }

  function drop(target: InvestigationStepId) {
    if (complete || !draggedStep || draggedStep === target) return
    setOrder((current) => {
      const next = [...current]
      const from = next.indexOf(draggedStep)
      const to = next.indexOf(target)
      next.splice(from, 1)
      next.splice(to, 0, draggedStep)
      return next
    })
    setDraggedStep(null)
    setMessage(null)
  }

  function checkOrder() {
    if (complete) return
    const nextAttempts = attempts + 1
    const initialOrder = firstSubmittedOrder ?? [...order]
    setAttempts(nextAttempts)
    if (!firstSubmittedOrder) setFirstSubmittedOrder(initialOrder)
    if (!isCorrect(order)) {
      setMessage('Some steps are out of order. Think about what you need to know before changing the image, and what must happen before you can compare results.')
      return
    }
    setComplete(true)
    setMessage('Correct. This process helps you test a repair direction against the classifier’s actual result.')
    onComplete({ initial_order: initialOrder, final_order: [...order], order_attempts: nextAttempts, correct_on_first_try: nextAttempts === 1 })
  }

  return <section className="investigation-order-task" aria-labelledby="investigation-order-title">
    <div><p className="step-label">Reflection · 1 of 2</p><h3 id="investigation-order-title">Put the investigation steps in the order you would use them.</h3></div>
    <ol className="investigation-order-list">{order.map((step, index) => <li key={step} draggable={!complete} onDragStart={() => setDraggedStep(step)} onDragOver={(event) => event.preventDefault()} onDrop={() => drop(step)}>
      <span className="order-position">{index + 1}</span><GripVertical aria-hidden="true" size={18} /><strong>{LABELS[step]}</strong>
      <span className="order-controls"><button type="button" aria-label={`Move ${LABELS[step]} up`} disabled={complete || index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button><button type="button" aria-label={`Move ${LABELS[step]} down`} disabled={complete || index === order.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button></span>
    </li>)}</ol>
    {message ? <p className={`prediction-feedback ${complete ? 'prediction-feedback--match' : ''}`} role="status">{message}</p> : null}
    <button className="primary-button" type="button" disabled={complete} onClick={checkOrder}>{complete ? 'Order confirmed' : 'Check order'}</button>
  </section>
}
