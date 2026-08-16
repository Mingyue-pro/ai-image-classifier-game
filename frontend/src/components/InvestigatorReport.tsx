import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { CircleHelp, Printer, RotateCcw, Trophy } from 'lucide-react'

import { getInvestigatorReport } from '../api'
import type { ComplexTransferReport as ComplexTransferReportData, InvestigatorReport as Report, ReportEvidence } from '../types'


type Props = { sessionId: string; onHome: () => void }

const CONCEPTS = [
  'An image modification does not necessarily change the classification.',
  'The same modification can produce different results under different parameters.',
  'Reducing or moving a modification does not guarantee restoration of the correct class.',
  'A result from one image does not establish a rule for every image or model.',
  'Useful evidence comes from predicting, changing one variable, reclassifying and comparing.',
]

const REPAIR_LABELS: Record<string, string> = {
  move_patch: 'Move the Patch',
  reduce_patch: 'Reduce the Patch size',
  move_and_resize_patch: 'Change both Patch position and size',
  reduce_pixel_strength: 'Reduce the Pixel attack strength',
}

const STRATEGY_LABELS: Record<string, string> = {
  controlled_investigation: 'Make a specific prediction, change one variable, reclassify the image, and compare the result.',
  change_several: 'Change several settings at the same time and see whether anything improves.',
  remove_everything: 'Remove every modification immediately so that the image becomes correct.',
  assume_cause: 'Assume that the image modification caused the error without testing it.',
  not_sure: 'I am not sure.',
}

const CONCLUSION_LABELS: Record<string, string> = {
  always_errors: 'Image modifications always cause classification errors.',
  reducing_always_restores: 'Reducing a modification always restores the correct classification.',
  conditional_evidence: 'The effect depends on the image, the modification and its parameters; one result may not establish the complete cause.',
  one_failure_rules_out: 'If one adjustment fails, the modification cannot be related to the error.',
}

function MetricHelp({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return <span className="metric-help report-screen-only"><button type="button" aria-label={`Explain ${label}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}><CircleHelp size={16} /></button>{open ? <p role="note">{children}</p> : null}</span>
}

function MetricLabel({ children, help }: { children: string; help: string }) {
  return <span className="metric-label"><small>{children}</small><MetricHelp label={children}>{help}</MetricHelp></span>
}

function parameters(values: Record<string, unknown> | null): string {
  if (!values) return 'Not recorded'
  if (typeof values.epsilon_pixels === 'number') return `Strength ${values.epsilon_pixels}/255`
  const visibleValues = Object.entries(values).filter(([key]) => !key.endsWith('_path') && !['patch_path', 'delta_path', 'image_path', 'source_image_path'].includes(key))
  if (!visibleValues.length) return 'Not recorded'
  return visibleValues.map(([key, value]) => {
    if (key === 'size_fraction') return Number(value) === 0 ? 'Patch removed' : `Size ${Math.round(Number(value) * 100)}%`
    if (key === 'position_x') return `X ${Number(value).toFixed(2)}`
    if (key === 'position_y') return `Y ${Number(value).toFixed(2)}`
    return `${key}: ${String(value)}`
  }).join(' · ')
}

function predictionStatus(row: ReportEvidence): string {
  if (row.prediction_match === null) return 'Not scored'
  return row.prediction_match ? 'Matched' : 'Did not match'
}

function predictionLabel(value: string | null): string {
  const labels: Record<string, string> = {
    classification_changes: "The AI's main judgement will change",
    classification_stays_same: "The AI's main judgement will not change",
    restored: 'The correct classification will be restored',
    still_incorrect: 'The image will still be misclassified',
    uncertain: 'Not sure',
    verified_fallback: 'System-provided fallback',
    verified_fallback_will_restore: 'System-provided fallback',
    restore_correct: 'The AI may return to the correct category',
    change_uncertain: 'The AI may change category, but it may still be incorrect',
    stay_same: 'The AI may stay the same',
    not_sure: 'Not sure',
  }
  return value ? labels[value] ?? value.replaceAll('_', ' ') : 'Not recorded'
}

function complexParameterRows(values: Record<string, unknown> | null) {
  if (!values) return [{ label: 'Parameters', value: 'Not recorded' }]
  const size = Number(values.patch_size_fraction ?? 0)
  const enabled = typeof values.patch_enabled === 'boolean' ? values.patch_enabled : size > 0
  const x = Number(values.patch_position_x ?? 0)
  const y = Number(values.patch_position_y ?? 0)
  return [
    { label: 'Patch', value: `${enabled ? 'Enabled' : 'Removed'} · Size ${Math.round(size * 100)}% · X ${x.toFixed(2)} · Y ${y.toFixed(2)}` },
    { label: 'Pixel strength', value: `${Number(values.epsilon_pixels ?? 0)}/255` },
    { label: 'Blur', value: `${String(values.blur_level ?? 'Not recorded')} · radius ${Number(values.blur_radius ?? 0)}` },
  ]
}

function ComplexStateCard({ title, parameters: values, classification, classificationLabel }: { title: string; parameters: Record<string, unknown> | null; classification: string | null; classificationLabel: string }) {
  return <article className="report-complex-state"><h3>{title}</h3><dl>{complexParameterRows(values).map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}<div><dt>{classificationLabel}</dt><dd>{classification ?? 'Not recorded'}</dd></div></dl></article>
}

function ComplexTransferReportSection({ transfer }: { transfer: ComplexTransferReportData }) {
  return <section className="report-card report-complex-transfer" aria-labelledby="complex-transfer-report-title">
    <div className="card-heading"><div><p className="step-label">Unified StageRun</p><h2 id="complex-transfer-report-title">Complex Transfer</h2></div><span>{transfer.attempts_used} attempts</span></div>
    <section className="report-complex-outcomes" aria-label="Complex Transfer outcomes">
      <div><small>Completion status</small><strong>{transfer.completion_status}</strong></div>
      <div><small>Operational success</small><strong>{transfer.operational_success ? 'Yes' : 'No'}</strong></div>
      <div><small>Autonomous success</small><strong>{transfer.autonomous_success ? 'Yes' : 'No'}</strong></div>
      <div><small>Fallback used</small><strong>{transfer.fallback_used ? 'Yes' : 'No'}</strong></div>
      <div><small>Classification restored</small><strong>{transfer.classification_restored ? 'Yes' : 'No'}</strong></div>
    </section>
    <div className="report-complex-state-pair">
      <ComplexStateCard title="Initial state" parameters={transfer.initial_parameters} classification={transfer.initial_classification} classificationLabel="Initial classification" />
      <ComplexStateCard title="Final investigation state" parameters={transfer.final_parameters} classification={transfer.final_classification} classificationLabel="Final classification" />
    </div>
    <section className="report-complex-timeline" aria-labelledby="complex-transfer-timeline-title"><h3 id="complex-transfer-timeline-title">Attempt timeline</h3><ol>{transfer.attempts.map((attempt) => <li key={attempt.attempt_number}><div className="card-heading"><strong>Attempt {attempt.attempt_number} · {attempt.selected_factor}</strong><span>{attempt.classification_restored ? 'Classification restored' : 'Classification not restored'}</span></div><div className="report-complex-attempt-prediction"><div><small>Prediction</small><p>{predictionLabel(attempt.prediction)}</p></div>{attempt.prediction_reason ? <div><small>Prediction reason</small><p>{attempt.prediction_reason}</p></div> : null}</div><div className="report-complex-attempt-states"><ComplexStateCard title="Before" parameters={attempt.parameters_before} classification={attempt.classification_before} classificationLabel="Classification before" /><ComplexStateCard title="After" parameters={attempt.parameters_after} classification={attempt.classification_after} classificationLabel="Classification after" /></div></li>)}</ol></section>
    {!transfer.operational_success && transfer.verified_reference ? <section className="report-complex-reference" aria-labelledby="complex-transfer-reference-title"><h3 id="complex-transfer-reference-title">Your final state vs one verified reference</h3><p>One verified reference is a parameter configuration that produced the correct classification for this case. Other parameter combinations may also produce different results.</p><div className="report-complex-state-pair"><ComplexStateCard title="Your final investigation state" parameters={transfer.final_parameters} classification={transfer.final_classification} classificationLabel="Final state classification" /><ComplexStateCard title="One verified configuration for this case" parameters={transfer.verified_reference.parameters} classification={transfer.verified_reference.classification} classificationLabel="Verified classification" /></div></section> : null}
    <section className="report-complex-reflection" aria-labelledby="complex-transfer-reflection-title"><h3 id="complex-transfer-reflection-title">Transfer Reflection</h3><article><strong>What did you learn from the results of your different attempts?</strong><p>{transfer.reflection.learning_reflection ?? 'Not recorded'}</p></article><article><strong>If you encountered a new AI image-classification error and did not know the cause, how would you investigate it?</strong><p>{transfer.reflection.new_error_strategy ?? 'Not recorded'}</p></article></section>
  </section>
}

export function InvestigatorReport({ sessionId, onHome }: Props) {
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    getInvestigatorReport(sessionId).then((value) => { if (active) setReport(value) }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : 'The report could not be loaded.')
    })
    return () => { active = false }
  }, [sessionId])

  if (error) return <section className="report-page"><p className="error-message" role="alert">{error}</p><button className="secondary-button" type="button" onClick={onHome}>Return home</button></section>
  if (!report) return <section className="report-page"><p className="loading-message">Preparing your Investigator Report…</p></section>

  const overview = report.overview
  const stageTables = [
    ['stage1', 'Tutorial'],
    ['stage2', 'Condition Investigation'],
    ['stage3', 'Repair Investigation'],
    ...(report.complex_transfer ? [] : [['transfer', 'Transfer']]),
  ].map(([stage, title]) => ({ stage, title, rows: report.evidence.filter((row) => row.stage === stage) }))
  return <section className="report-page" aria-labelledby="report-title">
    <header className="report-hero"><Trophy size={38} /><p className="step-label">{report.session.completion_status === 'completed' ? 'Investigation complete' : 'Incomplete learning record'}</p><h1 id="report-title">Investigator Report</h1><p>A learning-process report — not just a prediction score.</p></header>
    <section className="report-card report-metrics" aria-label="Learning overview">
      <div><MetricLabel help="The number of learning stages completed: Tutorial, Condition Training, Repair Investigation and Transfer.">Stages completed</MetricLabel><strong>{overview.stages_completed}/{overview.stages_total}</strong></div>
      <div><MetricLabel help="Every modification followed by a classifier result creates one evidence record, including fixed tests, autonomous attempts and verified fallback results.">Classification checks</MetricLabel><strong>{overview.evidence_records}</strong></div>
      <div><MetricLabel help="The number of clear predictions that matched the observed result. ‘Not sure’ answers and verified fallbacks are excluded.">Predictions matching results</MetricLabel><strong>{overview.decisive_predictions ? `${overview.prediction_matches}/${overview.decisive_predictions}` : 'No decisive predictions'}</strong></div>
      <div><MetricLabel help="How many times ‘Not sure’ was selected. These answers are recorded but are not counted as correct or incorrect.">“Not sure” selections</MetricLabel><strong>{overview.uncertain_predictions}</strong></div>
    </section>
    <section className="report-card"><h2>Investigation overview</h2><div className="report-profile-grid">
      <article><MetricLabel help="The number of modification attempts made before any system-provided fallback. This includes the fixed learning checks recorded earlier in the activity.">Modifications tested</MetricLabel><strong>{report.process_profile.controlled_adjustments} records</strong></article>
      <article><MetricLabel help="A verified fallback is a system-provided result shown after the allowed autonomous attempts are exhausted. It is not counted as an autonomous repair.">Verified fallback</MetricLabel><strong>{overview.fallback_methods.length ? overview.fallback_methods.join(', ') : 'Not used'}</strong></article>
    </div></section>
    {report.complex_transfer ? <ComplexTransferReportSection transfer={report.complex_transfer} /> : <section className="report-card"><h2>Transfer review</h2><div className="transfer-review-grid"><article><div className="review-question-title"><h3>Investigation strategy</h3><MetricHelp label="Investigation strategy">The next step you selected once, before applying it to both Transfer sub-cases.</MetricHelp></div><p className="review-answer">{report.transfer.strategy ? STRATEGY_LABELS[report.transfer.strategy] : 'Not recorded'}</p><p className={`review-feedback ${report.transfer.strategy === 'controlled_investigation' ? 'is-supported' : ''}`}>{report.transfer.strategy === 'controlled_investigation' ? 'This strategy records an expectation, changes one variable and checks the result.' : 'Changing one variable and recording an expected result would make the evidence easier to compare.'}</p><div className="review-open-response"><strong>Your reason</strong><p>{report.transfer.strategy_reason ?? 'Not recorded'}</p><small>Your response — not automatically graded.</small></div></article>{(['Patch', 'Pixel'] as const).map((method) => { const repair = report.transfer.repairs[method]; return <article key={method}><div className="review-question-title"><h3>{method} repair direction</h3><MetricHelp label={`${method} repair direction`}>The controlled repair direction chosen for the separate {method} Transfer sub-case.</MetricHelp></div><p className="review-answer">{repair.direction ? REPAIR_LABELS[repair.direction] ?? repair.direction.replaceAll('_', ' ') : 'Not recorded'}</p><div className="review-open-response"><strong>Your reason</strong><p>{repair.reason ?? 'Not recorded'}</p><small>Your response — not automatically graded.</small></div></article> })}<article><div className="review-question-title"><h3>Evidence conclusion</h3><MetricHelp label="Evidence conclusion">Your final Transfer choice about which conclusion was best supported across both sub-cases.</MetricHelp></div><p className="review-answer">{report.transfer.evidence_conclusion ? CONCLUSION_LABELS[report.transfer.evidence_conclusion] : 'Not recorded'}</p><p className={`review-feedback ${report.process_profile.transfer_conclusion_status === 'supported' ? 'is-supported' : ''}`}>{report.process_profile.transfer_conclusion_status === 'supported' ? 'This conclusion keeps the evidence conditional on the image, modification and parameters.' : 'One result cannot establish a universal cause or repair rule for every image.'}</p><div className="review-open-response"><strong>Your explanation</strong><p>{report.transfer.evidence_explanation ?? 'Not recorded'}</p><small>Your response — not automatically graded.</small></div></article></div></section>}
    <section className="report-card report-evidence-section"><div className="card-heading"><h2>Complete evidence record</h2><span>{overview.evidence_records} records</span></div><div className="stage-evidence-tables">{stageTables.map(({ stage, title, rows }) => <section className="stage-evidence-table" key={stage}><div className="stage-evidence-heading"><h3>{title}</h3><span>{rows.length} records</span></div>{rows.length ? <div className="report-table-scroll"><table><thead><tr><th>Method</th><th>Parameters before</th><th>Classification before</th><th>Parameters after</th><th>Classification after</th><th>Prediction</th><th>Prediction result</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.case_id}-${row.attempt_number}`}><td><strong>{row.method}</strong><small>{row.fallback ? 'Verified fallback' : `Attempt ${row.attempt_number}`}</small></td><td>{parameters(row.parameters_before)}</td><td>{row.top1_before ?? 'Not recorded'}</td><td>{parameters(row.parameters_after)}</td><td>{row.top1_after}</td><td>{predictionLabel(row.prediction)}</td><td>{predictionStatus(row)}</td></tr>)}</tbody></table></div> : <p className="empty-stage-record">No evidence was recorded for this stage.</p>}</section>)}</div></section>
    <section className="report-card"><h2>Personalised educational feedback</h2><ul className="report-feedback">{report.feedback.map((item) => <li key={item}>{item}</li>)}</ul></section>
    <section className="report-card"><h2>What the evidence can show</h2><ol className="report-concepts">{CONCEPTS.map((item) => <li key={item}>{item}</li>)}</ol></section>
    <section className="report-card"><h2>Further investigation</h2><p>Crop or framing, blur, occlusion, lighting or colour, background, rotation and viewpoint may also be investigated.</p><small>These examples were not tested during this activity. They are possible directions for further investigation.</small></section>
    <footer className="report-actions"><button className="secondary-button" type="button" onClick={() => window.print()}><Printer size={18} /> Print / save report</button><button className="primary-button" type="button" onClick={onHome}><RotateCcw size={18} /> Return home</button><small>Game version {report.session.game_version}</small></footer>
  </section>
}
