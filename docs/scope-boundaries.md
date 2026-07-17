# Scope Boundaries

## Must-have

- One real pretrained image classifier.
- ImageNet-pretrained ResNet-34.
- One adversarial patch case.
- One difficult-to-notice pixel-level perturbation case.
- Prediction before manipulation.
- Initial hypothesis before manipulation.
- Controlled image manipulation.
- Real runtime reclassification.
- Before-and-after comparison.
- Final evidence-based explanation.
- Supported, weakened, or revised hypothesis judgement.
- Understanding check and feedback.
- At least one previously unseen transfer case.
- Experimental interaction data recording.

## Optional

- Additional images and cases.
- Additional patch controls.
- PGD as an alternative to FGSM.
- Confidence visualisation.
- Information-insufficient cases.
- Cases where no image modification is present.
- Additional game narrative.
- Scores, badges, maps, or progress indicators.
- Additional usability features identified during evaluation.

## Not Included in the Core MVP

- Training a new image classification model from scratch.
- Multiple classifier comparison as a formal evaluation requirement.
- Real-time optimisation or training of adversarial patches during gameplay.
- Free upload of arbitrary user images.
- Open-ended image editing software.
- Multiplayer gameplay.
- Leaderboards.
- Teaching users to identify formal attack names.
- Claiming that every classification error is caused by image modification.
- Providing a universal method for repairing classification errors.

## Change Control

The Aim, Research Questions, Learning Outcomes, core process, modification types, and Must-have requirements are considered locked.

They should only be changed when:

1. The supervisor gives explicit feedback requiring a change.
2. Technical investigation demonstrates that a requirement is not feasible.
3. Pilot evaluation identifies a serious validity or usability problem.

Any change must be recorded in `research-decisions.md`.