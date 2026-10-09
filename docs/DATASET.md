# Dataset provenance and evaluation splits

Defect Atlas uses a small, fixed selection of real photographs from the Visual Anomaly (VisA) dataset by Yang Zou, Jongheon Jeong, Latha Pemula, Dongqing Zhang and Onkar Dabeer, Amazon Science (2022). Images and annotations are licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). The application code has its separate MIT license. Amazon does not sponsor or endorse this demonstration.

The authoritative sources are the [VisA repository](https://github.com/amazon-science/spot-diff), its [dataset license](https://github.com/amazon-science/spot-diff/blob/2a692ab575001cbde74d402d897a7286086c6199/LICENSE-DATASET), the [original image list](https://github.com/amazon-science/spot-diff/blob/2a692ab575001cbde74d402d897a7286086c6199/split_csv/1cls.csv), and the [annotation class map](https://github.com/amazon-science/spot-diff/blob/2a692ab575001cbde74d402d897a7286086c6199/utils/id2class.py). Source metadata is pinned to commit `2a692ab575001cbde74d402d897a7286086c6199`.

## Fixed selection

Dataset version: `visa-candle-pcb1-v1`. Selection seed: `defect-atlas-visa-v1`.

| Split | Candles | PCB1 circuit boards | Purpose |
| --- | --- | --- | --- |
| Reference | 4 normal | 4 normal | Normal-appearance examples for the reference policy |
| Calibration | 8 normal + 8 anomaly | 8 normal + 8 anomaly | Explore operating thresholds |
| Holdout | 12 normal + 12 anomaly | 12 normal + 12 anomaly | Separately evaluate a selected policy and thresholds |
| Total | 44 | 44 | 88 unique source photographs |

Within each category and binary source label, source image paths are ranked by SHA-256 of the UTF-8 string `seed + NUL + category + NUL + label + NUL + path`. The first four normal images become references, the next eight become calibration, and the next twelve become holdout. For anomalies, the first eight become calibration and the next twelve become holdout. Ranking is deterministic and happens before model evaluation. Within a split, displayed sample order follows opaque sample ID, not label order.

These are custom demonstration splits, not a reproduction of the published VisA paper protocol. The original source split is retained in the manifest for traceability. All three demonstration splits are disjoint at both source-path and original-content-hash level. References are normal photographs only. The app may use a fixed subset of the references in a particular policy; this is an instruction/reference change, not model training.

The 80 non-reference photographs are balanced by design. This ratio does not estimate defect prevalence in any factory. Accuracy and other metrics on this selection cannot establish industrial performance, generalization to unseen product families, or functional and safety certification. VisA is public, so this demonstration cannot establish whether a provider encountered its images during model training. Source ground truth records appearance anomalies from the dataset; it is not a new expert audit by Webytex. Changing policy or thresholds after inspecting holdout labels/results is exploratory and is no longer an untouched holdout evaluation.

## Image and annotation processing

Photographs are auto-oriented, resized to fit within 768 by 768 pixels without enlargement, converted to sRGB and saved as JPEG at quality 90 with 4:4:4 chroma subsampling. Original aspect ratios are preserved. Metadata is removed. The application displays this processed asset; the server re-encodes the corresponding photograph at JPEG quality 88 with the same maximum dimensions before inference. `Sample.sha256` identifies the displayed asset, not the re-encoded API payload. No defect is removed, painted in or generated. Resizing and JPEG compression can make tiny defects harder to see.

The separate annotation PNGs come from the original VisA masks. Nonzero class pixels are rendered coral with alpha 160 against a transparent background, then resized by nearest neighbour to align with the processed photograph. The mask class IDs and original mask hash remain in the manifest. The `defectLabels` array is derived from actual nonzero source mask class IDs using the official class map. Source wording is preserved, including spelling.

**These overlays are dataset ground truth, never AI heatmaps or model-generated localization.** They are revealed as reference annotations in the inspection view. Photographs from normal source rows have no annotation PNG. No source label, source filename, annotation, correction or holdout truth belongs in an inference request; use opaque sample IDs and image bytes. Reference inputs are restricted to the normal reference split.

## Hashes and reproducibility

`src/data/dataset-manifest.json` contains the source repository commit, archive URL/size/ETag, source metadata hashes, split assignments, source paths, dimensions and per-file provenance.

- `samples[].sha256` is the SHA-256 of the **processed JPEG** served by the application.
- `provenance[].originalSha256` is the SHA-256 of the original archive photograph.
- `provenance[].processedSha256` repeats the processed JPEG hash for explicit provenance.
- Annotation `originalSha256` hashes the original class mask; `processedSha256` hashes the display overlay PNG.
- The S3 archive ETag is retained as an object identity marker. Its multipart value is **not** claimed to be an archive SHA-256 checksum.

To reproduce the assets with Python 3.12+, Node.js 24 and the locked npm dependencies:

```powershell
npm ci
python scripts/prepare-dataset.py --cache "<absolute-private-cache-directory-outside-this-repository>"
npm test -- tests/dataset.test.ts
```

The script fetches metadata from the pinned official repository and checks the official archive headers before streaming. Exact category offsets are pinned to the accepted archive ETag and each start is validated against its TAR directory header. This skips unrelated categories. Category contents are read sequentially in bounded 2 MiB HTTP ranges, with up to eight ranges prefetched and three attempts for a failed read. Only the 88 selected originals, 40 selected source masks and available category CSVs are written to the supplied private cache. Each stream ends when its selected photos and masks have been found; the whole archive is never expanded. Only exact selected regular-file paths are accepted, destination paths are constrained to the cache, selected member sizes are bounded, and no archive symlinks are extracted. Existing selected cache files are reused; normalization retains original content hashes for review.

The preparation script uses no OpenAI API and creates no model scores. It generates only data assets, their manifest and the unchanged dataset license. The private cache, provider settings, credentials and model request logs do not belong in the public source repository.

## Citation

Yang Zou, Jongheon Jeong, Latha Pemula, Dongqing Zhang and Onkar Dabeer. *SPot-the-Difference Self-Supervised Pre-training for Anomaly Detection and Segmentation*. ECCV 2022. [Paper](https://arxiv.org/abs/2207.14315).

Photographs and annotations remain available under CC BY 4.0 and are provided without warranties. See [LICENSE-DATASET](../LICENSE-DATASET) and [THIRD-PARTY-NOTICES](../THIRD-PARTY-NOTICES) for the retained license and attribution.
