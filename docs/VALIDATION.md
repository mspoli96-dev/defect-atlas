# Validation

This document separates deterministic checks, recorded model evidence and deployment/browser verification. Source code and passing mocked tests do not establish live provider behaviour or production accuracy.

## Deterministic checks

The test suite covers these boundaries:

- Routing at exact clear/flag thresholds, uncertainty, refusals, failure, invalid probabilities, family mismatch and unusable photographs.
- Metric denominators, abstention, missing results, undefined rates, duplicate/foreign results and exclusion of references.
- JSON/CSV exports, provenance, independent human labels and spreadsheet-formula escaping.
- Strict request contracts, image limits and decoding, exact origin, signed-cookie integrity, provider schema and distribution validation, BotID handling and failed admission.
- The fixed dataset's category/split counts, deterministic selection, opaque paths, source/content uniqueness, licenses, image hashes, dimensions and annotation alignment.

Run the local verification without paid inference:

```powershell
npm run typecheck
npm test
npm run build
```

The final command outcome and hosted QA are recorded in the release checkpoint below. Test count is not a claim that every browser, visual condition or threat has been covered.

## Benchmark method

The selected VisA subset contains 88 unique photographs: four normal references, eight normal plus eight anomalous calibration images, and twelve normal plus twelve anomalous holdout images per category. The categories are candles and PCB1 circuit boards. Policies v1 and v2 use the same model and appearance criteria; v2 adds two separate normal references per category.

The target is appearance, not electrical function, hidden damage or safety. Inputs exclude source labels, filenames and dataset masks. Policy fingerprints, selected reference IDs, timestamps and model information accompany saved results. See [dataset provenance](DATASET.md) and [architecture](ARCHITECTURE.md).

The calibration view supports choosing thresholds. Holdout results are revealed against a frozen threshold snapshot, and later tuning is marked exploratory. The UI guard supports evaluation discipline; the public data and recorded outputs are inspectable in the repository. Public VisA images may have appeared in model training, which this demo cannot determine.

Do not report a single overall accuracy figure as industrial performance. The subset is deliberately balanced, small and selected from two product families. Changes in cameras, lighting, products and real defect prevalence can change results. Resizing and compression may obscure tiny flaws. Model probabilities are not established as calibrated confidence.

## Reporting rules

- Count missing, refused and failed inspections as human review. Keep them in coverage and anomaly-recall denominators.
- Report missed anomalies, false alarms and review counts alongside automated coverage.
- Use explicit numerators and denominators. JSON rates are fractions, not percentages; undefined rates are `null`.
- Keep each policy, category and split identifiable. Do not mix calibration scores into a holdout headline.
- Keep human review labels separate from benchmark truth. Corrections do not imply automatic model training.
- Identify annotation overlays as dataset human annotations, never AI localization.
- Treat recorded outputs as dated API evidence. Replay is not a fresh inference, and future calls need not match.

## Recorded run

The full recording contains 160 evaluated results: 80 non-reference photographs under each policy, with no failed or refused results in that recording. This includes four initial pilot results retained during resume; those were development checks, not an additional independent benchmark. The fixed policy text was not changed after recording began.

The provider reported 107,600 input tokens for appearance v1 and 189,280 for reference v2, or 296,880 combined. At the input-token rate used for the recording, the calculated model-input estimate is USD 0.029688. This is not a billing receipt, an all-in operating cost, or the cost of developing the application. A complete response is not evidence of a correct classification; routing metrics must be evaluated separately.

### Holdout results at the default thresholds

These figures use the preconfigured thresholds: clear ≤ 0.20, flag ≥ 0.80, minimum usability 0.70 and minimum family confidence 0.75. Each category contains 24 holdout images, evenly split between 12 source-labelled normal images and 12 anomalies. They are not threshold-optimized results.

| Category and policy | Clear | Flag | Review | Missed anomalies | False alarms | Automated coverage | Flag precision | Automated defect recall |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| Candles, appearance v1 | 17 | 3 | 4 | 5 | 0 | 20/24 | 3/3 | 3/12 |
| Candles, reference v2 | 9 | 7 | 8 | 0 | 0 | 16/24 | 7/7 | 7/12 |
| PCB1, appearance v1 | 15 | 2 | 7 | 3 | 0 | 17/24 | 2/2 | 2/12 |
| PCB1, reference v2 | 10 | 11 | 3 | 0 | 1 | 21/24 | 10/11 | 10/12 |

Across the same 48 holdout photographs, both policies routed 37 images automatically and 11 to review. Appearance v1 automatically cleared eight source-labelled anomalies. Reference v2 cleared none of those anomalies but produced one false alarm. In the candle category, the reduction in missed anomalies came with an increase from four to eight review cases; the circuit-board category behaved differently.

Zero observed misses in this selection is not zero risk. Reference v2 still sent seven of the 24 source-labelled holdout anomalies to review rather than automatically flagging them. The subset is too small and controlled to establish production performance or calibrated probabilities. References changed the observed operating trade-off; they did not establish a generally superior or safe inspection system.

## Release checkpoint

Final local checks and hosted browser QA remain pending in this checkpoint. No accuracy or latency claim is inferred from completion of the recording.

The LinkedIn article is a draft for review. Article publication is a separate action and is not established by deployment or a repository release.
