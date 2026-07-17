# Technical Architecture

## Frontend

- React
- Vite
- TypeScript
- Tailwind CSS or the confirmed project CSS approach
- React Testing Library for important interaction tests

## Backend

- Python
- FastAPI
- Pydantic request and response models
- Pytest for backend testing

## Machine Learning

- PyTorch
- TorchVision
- ImageNet-pretrained ResNet-34
- Official model preprocessing and ImageNet labels

## Image Processing

- Pillow
- NumPy
- PyTorch tensors

## Adversarial Patch Workflow

### Offline

- Generate, obtain, and validate adversarial patch assets.
- Test candidate images, patch positions, sizes, and removal conditions.
- Save stable cases and parameters.

### Runtime

- Apply the selected patch position, size, or local removal.
- Construct the current modified image.
- Send the modified image to ResNet-34.
- Return real classifier predictions.

## Pixel-level Perturbation Workflow

### Offline

- Generate real perturbations using FGSM.
- Use PGD only when needed as an alternative.
- Test perturbation strength and retained proportion.
- Save the perturbation tensor or delta and case parameters.

### Runtime

- Adjust perturbation strength or retained proportion.
- Construct the current modified image.
- Send the modified image to ResNet-34.
- Return real classifier predictions.

## Data Storage

- SQLite for application and study records.
- CSV export for analysis.
- Participant data must not be committed to GitHub.

## Experimental Development

- Jupyter Notebook for exploration.
- Stable code must be moved into `scripts` or `backend`.
- Candidate image and modification testing must be reproducible.

## Planned System Flow

React interface  
→ FastAPI request  
→ image manipulation  
→ ResNet-34 inference  
→ prediction response  
→ before-and-after comparison  
→ explanation and data recording

## Engineering Principles

- Configuration is separated from code.
- Every case has a stable ID and recorded parameters.
- Important functions have tests.
- Runtime errors are logged.
- Research versions are marked using Git tags.
- Formal study data is stored separately from source code.