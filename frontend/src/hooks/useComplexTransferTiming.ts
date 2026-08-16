import { useEffect, useRef } from 'react'


export type ComplexTransferPage = 'observe' | 'plan' | 'manipulate' | 'reclassify' | 'compare' | 'decide' | 'summary' | 'reflection' | 'complete'
export type TimedTransferFactor = 'patch' | 'pixel' | 'blur' | null

export type ComplexTransferTimingEvent = {
  eventType: 'complex_transfer_page_visit' | 'complex_transfer_page_visibility' | 'complex_transfer_factor_duration'
  eventData: Record<string, unknown>
}

type TrackingContext = {
  page: ComplexTransferPage
  factor: TimedTransferFactor
  attemptIndex: number
}

type Visit = TrackingContext & {
  visitId: string
  enteredAt: number
  activeStartedAt: number | null
  activeDurationMs: number
  enteredFrom: ComplexTransferPage | null
  entryReason: 'initial' | 'forward' | 'back' | 'return'
}

const PAGE_ORDER: Record<ComplexTransferPage, number> = {
  observe: 0,
  plan: 1,
  manipulate: 2,
  reclassify: 3,
  compare: 4,
  decide: 5,
  summary: 6,
  reflection: 7,
  complete: 8,
}

function navigationDirection(from: ComplexTransferPage, to: ComplexTransferPage | null): 'forward' | 'back' | 'exit' {
  if (to === null) return 'exit'
  return PAGE_ORDER[to] < PAGE_ORDER[from] ? 'back' : 'forward'
}

export function useComplexTransferTiming(
  context: TrackingContext,
  onTimingEvent?: (event: ComplexTransferTimingEvent) => void,
) {
  const priorPageRef = useRef<ComplexTransferPage | null>(null)
  const returnPendingRef = useRef(false)

  useEffect(() => {
    let visit: Visit | null = null
    function startVisit() {
      if (!onTimingEvent || visit !== null) return
      const now = Date.now()
      const previousPage = priorPageRef.current
      const direction = previousPage === null ? 'initial' : navigationDirection(previousPage, context.page)
      visit = {
        ...context,
        visitId: crypto.randomUUID(),
        enteredAt: now,
        activeStartedAt: document.hidden ? null : performance.now(),
        activeDurationMs: 0,
        enteredFrom: previousPage,
        entryReason: returnPendingRef.current ? 'return' : direction === 'back' ? 'back' : direction === 'forward' ? 'forward' : 'initial',
      }
      returnPendingRef.current = false
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        if (visit?.activeStartedAt !== null && visit?.activeStartedAt !== undefined) {
          visit.activeDurationMs += performance.now() - visit.activeStartedAt
          visit.activeStartedAt = null
        }
        returnPendingRef.current = true
      } else if (visit && visit.activeStartedAt === null) {
        visit.activeStartedAt = performance.now()
      }
      if (visit) {
        onTimingEvent?.({
          eventType: 'complex_transfer_page_visibility',
          eventData: {
            visit_id: visit.visitId,
            page_key: visit.page,
            factor: visit.factor,
            attempt_index: visit.attemptIndex,
            visibility: document.hidden ? 'hidden' : 'visible',
            timestamp_client: new Date().toISOString(),
          },
        })
      }
    }

    // The short delay prevents React StrictMode's development-only probe mount
    // from creating a false zero-duration visit.
    const timer = window.setTimeout(startVisit, 0)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (!visit || !onTimingEvent) return
      if (visit.activeStartedAt !== null) visit.activeDurationMs += performance.now() - visit.activeStartedAt
      const exitedAt = Date.now()
      const eventData = {
        visit_id: visit.visitId,
        page_key: visit.page,
        factor: visit.factor,
        attempt_index: visit.attemptIndex,
        entered_at_client: new Date(visit.enteredAt).toISOString(),
        exited_at_client: new Date(exitedAt).toISOString(),
        elapsed_duration_ms: Math.max(0, exitedAt - visit.enteredAt),
        active_duration_ms: Math.max(0, Math.round(visit.activeDurationMs)),
        entered_from: visit.enteredFrom,
        entry_reason: visit.entryReason,
      }
      onTimingEvent({ eventType: 'complex_transfer_page_visit', eventData })
      if (visit.page === 'manipulate' && visit.factor !== null) {
        onTimingEvent({ eventType: 'complex_transfer_factor_duration', eventData: { ...eventData, duration_scope: 'manipulate_page' } })
      }
      priorPageRef.current = visit.page
    }
    // A page visit is intentionally bounded by a page/phase change. Factor and
    // attempt values are snapshots for that visit, not reasons to restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.page, onTimingEvent])
}
