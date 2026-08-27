# Seamful Image Classifier Investigation Game

An educational game for investigating how image modifications affect image classifier predictions under different conditions.

## Project Status

Current release: Final v3.0 evaluation version. The formal image stimuli are frozen in a separately versioned Final asset bundle.

## Core Research Focus

The project investigates whether the following interaction process helps non-expert young adults understand when image modifications cause image classifier misclassification:

Observe → Predict → Manipulate → Reclassify → Compare → Reflect

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
- [Final Evaluation Asset Bundle](docs/final-assets.md)

## Current Milestone

Final v3.0 resource freeze, terminology review, full-flow self-test, and research-data audit before the Final evaluation.

## Development Principle

The core research scope is fixed. Detailed interaction and game features will be refined after the core technical and learning flow is operational.

## Local Development

### Required Final Assets

A clean clone does not include the Final research images, generated case images, Patch assets, FGSM tensors, class examples, or runtime case matrix. Obtain the separately versioned Final v3.0 asset bundle before running the full study flow.

Check the downloaded archive:

```bash
shasum -a 256 -c ai-image-classifier-game-final-assets-v3.0.tar.gz.sha256
```

Install and verify it from the repository root:

```bash
python -m scripts.final_assets install \
  /absolute/path/ai-image-classifier-game-final-assets-v3.0.tar.gz

python -m scripts.final_assets verify
```

See the [Final Evaluation Asset Bundle](docs/final-assets.md) document for the frozen filename and SHA256, bundle contents, recovery procedure, backup policy, and distribution boundary.

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
