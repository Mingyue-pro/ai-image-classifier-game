# Final evaluation asset bundle

The Final game uses a small, versioned asset bundle instead of committing research images, generated images, Patch files, FGSM tensors, or model weights to Git.

## Official frozen release

The following release is the authoritative asset set for the Final evaluation:

| Field | Frozen value |
|---|---|
| Bundle ID | `ai-image-classifier-game-final-assets-v3.0` |
| Filename | `ai-image-classifier-game-final-assets-v3.0.tar.gz` |
| SHA256 | `0d8ab36d6fec61ceb91179a7f72087eb74c7bac9432b3c7468427156d49a3333` |
| Frozen date | 27 August 2026 |
| Game version | `v3.0` |
| Study phase | `final_evaluation` |
| Formal assets | 45 |
| Case matrix | 8 cases / 22 states |
| Uncompressed asset size | 83,821,871 bytes |

The `.tar.gz` archive and its `.tar.gz.sha256` file must be stored and transferred together. A bundle with a different SHA256 is not the frozen Final v3.0 release, even if it has the same filename.

## What is included

`config/final_asset_inventory.json` is the authoritative list. It contains only:

- four formal source images: banana, pizza, traffic light, and mailbox;
- fixed images displayed by Stage 1 and the initial states of Stages 2–3;
- the universal toaster Patch and the mailbox-specific toaster Patch;
- four FGSM direction tensors used to reconstruct selectable Pixel Strengths;
- the validated runtime case matrix and its audit CSV;
- the twelve optional class-example images and their manifest.

The bundle does not contain candidate images, exploratory outputs, participant databases, runtime images, exports, caches, or ResNet model weights.

## Relationship between code and assets

A complete runnable Final system requires:

```text
Git code repository
+ Final v3.0 asset bundle
+ Python and Node dependencies
+ TorchVision ResNet-34 weights
+ a separately configured research database
```

The installed assets live under their required project-relative `data/...` paths, but remain ignored by Git. The `.tar.gz` file is the portable backup and distribution copy; it does not need to remain inside the repository after installation.

## Build the bundle on the preparation machine

First rebuild the case matrix and confirm that it still matches the selected Final cases:

```bash
python -m scripts.build_case_matrix config/case_selection.json \
  --output-json data/results/case-matrix.json \
  --output-csv data/results/case-matrix.csv \
  --project-root .
```

Then build the external bundle:

```bash
python -m scripts.final_assets build \
  --output /absolute/safe/path/ai-image-classifier-game-final-assets-v3.0.tar.gz
```

The archive contains the required files at their project-relative paths and a generated `data/final-assets-manifest.json`. The generated manifest records every file's role, byte size, and SHA256 hash.

Store the archive outside Git in a backed-up, access-controlled location. Do not place participant databases in the same archive.

After creating the frozen archive, generate its external checksum file from the directory containing the archive:

```bash
shasum -a 256 \
  ai-image-classifier-game-final-assets-v3.0.tar.gz \
  > ai-image-classifier-game-final-assets-v3.0.tar.gz.sha256
```

Confirm the archive before storing or transferring it:

```bash
shasum -a 256 -c \
  ai-image-classifier-game-final-assets-v3.0.tar.gz.sha256
```

The expected result is:

```text
ai-image-classifier-game-final-assets-v3.0.tar.gz: OK
```

## Install after cloning or on a server

From the repository root:

```bash
python -m scripts.final_assets install \
  /absolute/path/ai-image-classifier-game-final-assets-v3.0.tar.gz
```

Installation refuses to overwrite a different existing file. Use `--replace` only when intentionally replacing an older asset installation.

## Complete recovery procedure

Use this order for a clean clone, a replacement computer, or a server:

1. Clone the code repository and check out the required code version.
2. Create or activate the Python environment and install the backend dependencies.
3. Install the frontend Node dependencies.
4. Obtain both the official `.tar.gz` archive and its `.sha256` file.
5. Run the external SHA256 check and require an `OK` result.
6. Install the Final asset bundle from the repository root.
7. Verify all installed assets.
8. Ensure the official TorchVision ResNet-34 weights are available.
9. Configure a new database appropriate to the run. Never reuse the frozen V2 evaluation database.
10. Start the backend and frontend only after the resource check succeeds.

## Verify before every Final session or deployment

```bash
python -m scripts.final_assets verify
```

Successful verification reports the asset count and total bytes. A missing, changed, or damaged file causes a non-zero exit and identifies the affected path. Start the backend only after this command succeeds.

The official TorchVision `ResNet34_Weights.DEFAULT` model is a software/model dependency rather than a study stimulus. It remains outside this bundle and outside Git. Ensure it is already present in the server's PyTorch cache or allow the first model initialization to download it before participant sessions begin.

## Backup policy

- Keep the `.tar.gz` archive and `.tar.gz.sha256` file together.
- Maintain at least two physically independent copies; the current Mac must not be the only copy.
- A suitable minimum is one local archival copy and one copy on an external drive.
- A long-term personal cloud account or a private, access-controlled release can be an additional copy, but cloud storage is not required.
- Do not rely on an institutional account that will be withdrawn after graduation.
- Do not commit the archive to normal Git history. If GitHub is used, prefer a private Release attachment and confirm that redistribution is permitted.
- Store participant databases and research exports separately from the asset bundle and apply their own access controls and backup policy.

## Distribution and licensing boundary

The bundle is intended to reproduce and run this research project. It contains image materials selected from local ImageNet/Kaggle-derived research assets. The relevant dataset and image redistribution terms must be checked before making the bundle public or deploying it for unrestricted public access.

Until those permissions have been confirmed, keep the bundle private or access-controlled. The bundle contains no participant database or participant responses. ResNet-34 weights are also excluded and remain subject to their own upstream distribution terms.

## When a new bundle is required

Documentation-only or application-code changes do not require rebuilding the frozen archive. A new bundle and a new SHA256 are required if any included source image, fixed case image, Patch PNG, FGSM tensor, class-example image, class-example manifest, or case-matrix file changes. Such a replacement should receive a new asset release identifier rather than silently reusing this frozen release.
