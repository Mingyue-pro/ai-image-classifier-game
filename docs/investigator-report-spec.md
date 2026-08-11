# Investigator Report v1 — Locked specification

Status: locked for the formative-evaluation MVP on 2026-08-04.

## 1. Purpose and scope

The report is a learning-process record, not a prediction leaderboard or a diagnostic assessment. It is generated after Transfer from the anonymous Session, StageRun, Attempt and Response records already stored by the application.

The report must:

- show what the participant tested and what the classifier returned;
- distinguish predictions, observed evidence and participant reflections;
- reinforce conditional reasoning and appropriate uncertainty;
- avoid automatically grading open responses;
- avoid a single combined score.

The participant code, Session ID, database IDs, local file paths, inference duration and raw event log are not displayed in the participant-facing report.

## 2. Report sections and fields

### A. Header

| Display field | Source | Rule |
|---|---|---|
| Title | fixed | `Investigator Report` |
| Subtitle | fixed | `A learning-process report — not just a prediction score.` |
| Completion status | `ResearchSession.completion_status` | Show `Investigation complete` only when the Session is completed; otherwise show `Incomplete learning record` |
| Completed date | `ResearchSession.completed_at` | Render in the browser's local date/time; omit when absent |
| Game version | `ResearchSession.game_version` | Show as a small footer field, not a performance metric |

### B. Learning overview

| Display field | Calculation |
|---|---|
| Stages completed | Number of distinct stages with at least one `StageRun.completion_status = completed`, displayed as `N/4` for Stage 1, Stage 2, Stage 3 and Transfer |
| Evidence records | Count all Attempt rows, but show autonomous attempts and verified fallback records separately |
| Predictions recorded | Count non-fallback Attempts whose `predicted_outcome` is present, displayed over all non-fallback Attempts |
| Prediction matches | Count matching decisive predictions over all decisive predictions; exclude `uncertain`, missing predictions and fallback records from the denominator |
| Uncertain predictions | Count Attempts whose `predicted_outcome = uncertain`; display neutrally, never as a penalty |
| Correct class restored | Count non-fallback Attempts with `classification_restored = true`; separately state how many methods required fallback |

Prediction matching is determined by stage:

- Stage 1 and Stage 2: `classification_changes` matches when `classification_changed = true`; `classification_stays_same` matches when it is false.
- Stage 3 and Transfer: `restored` matches when `classification_restored = true`; `still_incorrect` matches when it is false.
- `uncertain`, missing predictions and any `verified_fallback*` value produce `not scored`, not `incorrect`.

The report must not display an overall percentage or a combined Transfer score.

### C. Investigation-process profile

Use status labels, not points.

| Profile item | Display rule |
|---|---|
| Predictions recorded | Display the number of recorded non-fallback predictions as a factual process record; do not treat it as an individual performance difference because the interface requires prediction before reclassification |
| Controlled adjustments | Display the number of non-fallback Attempt records; do not claim that one setting caused the outcome |
| Evidence comparison | `Completed` when all completed StageRuns contain their required Attempt records and the related stage reflection Response exists |
| Hypothesis reflection | Display the participant's Stage 3 `stage3_initial_repair_evaluation` choices and `stage3_reconsideration` text; do not automatically label the prose correct or incorrect |
| Appropriate uncertainty | `Recognised in Transfer` only when `transfer_evidence_conclusion = conditional_evidence`; otherwise `Review recommended` |
| Fallback use | `Not used`, or list Patch/Pixel methods whose StageRun has `fallback_shown = true` |

### D. Complete evidence record

Display four separate tables in learning order: Tutorial, Condition Investigation, Repair Investigation and Transfer. Each table contains one row per Attempt, ordered by case and attempt number.

| Column | Source/calculation |
|---|---|
| Method | `StageRun.attack_type` mapped to Patch or Pixel |
| Attempt | `Attempt.attempt_number`; add a `Verified fallback` badge when applicable |
| Parameters before | Friendly values from `parameters_before`; Patch uses position and percentage size, Pixel uses `N/255` |
| Classification before | `Attempt.top1_before` |
| Parameters after | Friendly values from `parameters_after` |
| Classification after | `Attempt.top1_after` |
| Prediction | Friendly label from `predicted_outcome`; show `Not sure` neutrally |
| Prediction result | `Matched`, `Did not match` or `Not scored` using section B rules |

Confidence and correct-class rank remain available in the research export but are not shown in the participant-facing report. They are not required to understand the before-and-after classification evidence and may be mistaken for measures of model certainty or participant performance.

Prediction reasons may be shown in an expandable row. Output image paths and internal IDs must never be shown.

### E. Transfer evidence

| Display field | Source/rule |
|---|---|
| Investigation strategy | Display `transfer_next_step_strategy`, its immediate evidence feedback, and the learner's `transfer_next_step_reason` |
| Patch repair direction | Display the single choice and reason from `transfer_patch_repair_direction` and `transfer_patch_repair_reason` |
| Pixel repair direction | Display the single choice and reason from `transfer_pixel_repair_direction` and `transfer_pixel_repair_reason` |
| Repair reason | Display `transfer_repair_reason` verbatim and mark `Your response — not automatically graded` |
| Patch and Pixel results | Summarise their non-fallback attempts, restoration result and fallback use independently |
| Evidence conclusion | `transfer_evidence_conclusion` |
| Conclusion feedback | `Conditional conclusion supported` only for `conditional_evidence`; otherwise `Review recommended` |
| Evidence explanation | Display `transfer_evidence_explanation` verbatim and mark `Your response — not automatically graded` |

Transfer does not receive a numerical score. The two objective choices are reported independently so one answer cannot hide the other.

### F. Concept summary

Always display these evidence boundaries:

1. An image modification does not necessarily change the classification.
2. The same modification can produce different results under different parameters.
3. Reducing or moving a modification does not guarantee restoration of the correct class.
4. A result from one image does not establish a rule for every image or model.
5. A useful investigation records a prediction, changes one variable, reclassifies and compares the evidence.

### G. Personalised educational feedback

Feedback is deterministic and transparent. Multiple applicable messages may be shown.

| Condition | Feedback rule |
|---|---|
| One or more uncertain predictions | State that uncertainty can be appropriate when evidence is limited |
| No uncertain predictions | Do not praise certainty; suggest using `Not sure` when evidence is genuinely insufficient |
| Any prediction mismatch | State that a mismatch is useful evidence for revising a hypothesis |
| Any fallback used | State which method needed a verified fallback; do not describe it as participant success |
Transfer repair hypotheses and conclusion feedback are shown beside the corresponding original answers in `Transfer review`; they are not repeated in personalised feedback.

No feedback rule may infer ability, intelligence, mastery or correctness from open-response length or wording.

### H. Further investigation

Show static examples only; they are not part of the Transfer result:

- crop or framing;
- blur or loss of detail;
- occlusion;
- lighting or colour changes;
- background changes;
- rotation or viewpoint.

Required boundary text:

`These examples were not tested during this activity. They are possible directions for further investigation.`

### I. Actions

- `Print / save report` uses the browser print dialog and print-specific CSS.
- `Return home` returns to the home page without deleting research data.
- `Start a new investigation` requires explicit confirmation before creating a new anonymous Session.

## 3. Missing-data rules

- Never divide by zero. Display `No decisive predictions recorded` instead of `0%`.
- Never substitute a missing value with zero.
- An incomplete Session produces an `Incomplete learning record` banner and only displays recorded evidence.
- Duplicate Responses with the same question key use the latest `created_at` value in the participant-facing report; raw exports retain every row.
- A missing Top-5 list produces `Unavailable` confidence and rank.
- Fallback Attempts remain in the evidence table but are excluded from autonomous prediction and restoration metrics.

## 4. Acceptance criteria

The MVP report is accepted when:

1. every displayed value is derived from Session, StageRun, Attempt, Response or fixed educational copy;
2. the evidence table matches the anonymous JSON export for the same Session;
3. fallback and autonomous attempts are visually distinguishable;
4. uncertain predictions are excluded from prediction-match scoring;
5. open text is displayed but never automatically graded;
6. no internal identifiers or local paths appear;
7. incomplete and missing-data states render without errors;
8. desktop, narrow-screen and print layouts are readable;
9. automated tests cover the calculation rules and privacy exclusions.

## 5. Deferred beyond MVP

- PDF generation on the server;
- AI-generated evaluation of open responses;
- comparison between participants;
- badges, leaderboard or a combined mastery score;
- interactive Transfer attacks beyond Patch and Pixel.
