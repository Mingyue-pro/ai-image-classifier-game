# Seamful Image Classifier Investigation Game

An educational game for investigating how image modifications affect image classifier predictions under different conditions.

## Project Status

Current phase: Scope locked and engineering setup beginning.

## Core Research Focus

The project investigates whether the following interaction process helps non-expert young adults understand when image modifications cause image classifier misclassification:

Predict → Manipulate → Reclassify → Compare → Explain

## Core Technologies

- React
- Vite
- TypeScript
- FastAPI
- PyTorch
- TorchVision
- ImageNet-pretrained ResNet-34
- Pillow
- NumPy
- SQLite
- CSV
- Pytest
- React Testing Library

## Project Structure

```text
frontend/     React application
backend/      FastAPI, classifier, image processing and database
notebooks/    Image and adversarial case exploration
scripts/      Reproducible case generation and validation scripts
tests/        Frontend and backend tests
data/         Local research assets and metadata
config/       Application, model and case configuration
docs/         Research scope, architecture and decision records
```

## Important Documents

- [MVP Scope](docs/mvp-scope.md)
- [Scope Boundaries](docs/scope-boundaries.md)
- [Technical Architecture](docs/architecture.md)
- [Research Decision Log](docs/research-decisions.md)

## Current Milestone

Core Flow Demonstrator for supervisor review on 21 July 2026.

## Development Principle

The core research scope is fixed. Detailed interaction and game features will be refined after the core technical and learning flow is operational.