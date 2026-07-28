# Seamful Image Classifier Investigation Game

An educational game for investigating how image modifications affect image classifier predictions under different conditions.

## Project Status

Current phase: Project setup complete; model integration beginning.

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

## Local Development

### Backend

```bash
conda env create -f environment.yml
conda activate ai-image-game
python -m uvicorn backend.app.main:app --reload
```

If the Conda environment already exists, install or refresh the backend packages
from the repository root:

```bash
python -m pip install -r backend/requirements.txt
```

Backend URL:
```text
http://127.0.0.1:8000
```

API documentation:

```text
http://127.0.0.1:8000/docs
```

The first real classification downloads the official TorchVision
`ResNet34_Weights.DEFAULT` weights into the local PyTorch cache. Later requests
reuse both the cached weight file and one model instance per backend process.

### Classify an Image

With the backend running, upload one JPEG, PNG, or WebP image:

```bash
curl -X POST http://127.0.0.1:8000/classify \
  -F "file=@/absolute/path/to/image.jpg"
```

Alternatively, run a single classification directly from the repository root:

```bash
python -m scripts.classify_image /absolute/path/to/image.jpg
```

Both methods return the model and weights names together with Top-1 and Top-5
ImageNet labels, probabilities, and class indices.

### Frontend
```bash
cd frontend
npm install
npm run dev
```


Frontend URL:
```text
http://localhost:5173
```


### Tests

Backend:
```bash
python -m pytest
```

Frontend:

```bash
cd frontend
npm run build
npm run lint
```
