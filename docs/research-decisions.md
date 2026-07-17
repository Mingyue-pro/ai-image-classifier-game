# Research Decision Log

## Decision 001: Refine the Learning Focus

**Status:** Accepted  
**Date:** 17 July 2026

### Previous concern

Participants may already understand that AI can make mistakes and may already try changing an image, rerunning a classifier, or using another system.

A repair-centred design could also imply that:

- every image modification causes an error;
- reducing or removing a modification always restores the correct prediction.

### Decision

The project focuses on helping users understand the conditional relationship between image modifications and image classifier predictions.

### Resulting process

Predict → Manipulate → Reclassify → Compare → Explain

---

## Decision 002: Include Bidirectional Outcomes

**Status:** Accepted  
**Date:** 17 July 2026

### Decision

The case set will include:

- modifications that change a prediction;
- modifications that preserve a prediction;
- reduced or removed modifications that restore the correct prediction;
- reduced or removed modifications that leave the prediction incorrect.

### Reason

This avoids teaching an oversimplified rule.

---

## Decision 003: Use Two Modification Types

**Status:** Accepted  
**Date:** 17 July 2026

### Decision

The MVP will include:

- adversarial patches;
- difficult-to-notice pixel-level perturbations.

### Reason

These allow comparison between visible and less visible image modifications.

---

## Decision 004: Use Real Runtime Reclassification

**Status:** Accepted  
**Date:** 17 July 2026

### Decision

The system will use an ImageNet-pretrained ResNet-34 to reclassify the current manipulated image during runtime.

Patch assets and pixel perturbations may be generated and validated offline, but the result shown after user manipulation will come from real model inference.

---

## Decision 005: Defer Detailed Game Features

**Status:** Accepted  
**Date:** 17 July 2026

### Decision

Detailed narrative, scoring, visual metaphors, badges, maps, and additional interaction features will be refined after the core flow is operational and evaluated.

### Supervisor feedback

The basic direction is acceptable. Priority should be given to implementing the core design and testing many images and modifications to identify a suitable small case set.