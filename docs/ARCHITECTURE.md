# Architecture

Defect Atlas separates model inference, deterministic routing, dataset truth and human review. The browser can explore a saved benchmark without credentials. A server route performs optional fresh inspections under bounded admission controls.

## Data and policy boundaries

`src/data/dataset-manifest.json` records the fixed `visa-candle-pcb1-v1` selection, opaque sample IDs, split assignments, source paths, dimensions and hashes. `src/lib/dataset.ts` exposes that manifest. The 88 photographs are split into eight references, 32 calibration samples and 48 holdout samples, disjoint by source path and content. The reference-guided policy takes the first two of four reference photographs in each category. [DATASET.md](DATASET.md) records selection and asset preparation.

The browser receives the public dataset and annotations. The holdout reveal is a methodological UI guard, not access control over confidential test data. The dataset is public and possible overlap with provider training data is unknown.

`src/lib/policies.ts` defines two versioned policies. `src/lib/server/provider.ts` constructs fixed category-specific instructions and the four Decisions questions. Appearance v1 receives one target photograph. Reference v2 receives two known-normal images followed by the target, with explicit reference/target markers. Reference guidance is the intended difference; the model and inspection criteria are shared. Neither policy is a trained classifier checkpoint.

Target source labels, original filenames, masks and human corrections never enter provider payloads. The expected family is intentional task context. Provider input consists of generic inspection text and normalized image bytes, not arbitrary external URLs. Content appearing inside an image is treated as untrusted visual evidence.

## Live request path

1. `GET /api/config` returns public availability and, when live mode is ready, issues a signed, one-day, HTTP-only visitor cookie. It returns no credentials.
2. `POST /api/inspect` verifies exact origin, bounded JSON and the strict request schema. The body identifies a supported sample or carries one base64 image, plus category, policy, client revision and explicit consent.
3. The route requires live configuration, a valid visitor cookie and hosted BotID verification. A sample must match its family and cannot come from the reference split.
4. Sharp validates a still JPEG, PNG or WebP of at most 2,097,152 bytes and 24 million pixels, with both dimensions at least 32 pixels. It auto-orients, bounds the longest side to 768 pixels, flattens transparency onto white and outputs JPEG in memory. Dataset inputs pass through this same server normalization, including JPEG re-encoding.
5. Atomic Redis admission reserves an allowance and concurrency slot before the paid request. Decisions runs once with a 25-second provider timeout and automatic SDK retries disabled.
6. The server validates the model identifier, answer names, types, probability ranges and distributions. The severity score must agree with its weighted 0–3 distribution. A refusal stays a refusal; invalid or incomplete responses do not become fabricated predictions.
7. The response includes its client revision. The browser accepts only the current revision. Changing source, family, policy or upload cancels the client operation. Cancellation does not promise cancellation or refund of a provider request already sent.

Live batches are sequential client requests for at most eight collection samples. Completed responses remain available if a later request fails. There are no automatic paid retries. Uploaded images and results remain in browser/server memory for this workflow; there is no application upload store.

## Routing and evaluation

`src/lib/evaluation.ts` computes all routes and metrics. Defaults are clear at anomaly probability ≤ 0.20, flag at ≥ 0.80, minimum usability 0.70 and minimum family confidence 0.75. Missing or invalid probabilities, refusal, failure, family mismatch, low family confidence and low usability route to review before anomaly thresholds are considered. Severity is an explanatory appearance score, not an additional routing rule.

Reference samples never enter metric denominators. Missing, refused and failed inspections remain review cases. For a selected category, split and policy:

| Measure | Numerator | Denominator |
| --- | --- | --- |
| Automated coverage | Clear + flag routes | All non-reference samples |
| Flag precision | Anomalies routed to flag | All flag routes |
| Automated defect recall | Anomalies routed to flag | All source-labelled anomalies, including review cases |
| Selective accuracy | Correct clear + correct flag routes | All automated routes |

Rates are fractions from zero to one in JSON. A zero denominator returns `null`, displayed as unavailable rather than a misleading zero. The routing matrix also shows missed anomalies, false alarms and normal/anomalous review cases. Selective accuracy alone can hide extensive abstention, so coverage is shown beside it.

The calibration view recomputes routes from saved probabilities; moving a threshold does not call the API. Compare snapshots the thresholds before revealing both policies on holdout data. Subsequent tuning or re-evaluation is labelled exploratory. Human reviews are separate session records and never silently replace dataset truth, affect benchmark scores or train a model.

## Saved runs and exports

`scripts/capture-benchmark.ts` records actual API outputs, model name, policy, input tokens, timestamps and latency into `src/data/recorded-runs.json`. It evaluates the 80 non-reference samples under both policies. Category-specific request fingerprints and selected reference IDs identify the instructions used. Fingerprints are based on request structure with image placeholders; image identity is separately grounded in the dataset manifest and reference IDs.

The tool resumes existing sample results and refuses incompatible policy fingerprints. Errors are saved as failed attempts and stop recording for review. Saved-run replay and fresh live inference are visibly distinct. The model alias is recorded; future calls are not promised bit-for-bit identical.

`src/lib/report.ts` produces CSV and JSON with policy/version, thresholds, source, dataset truth, hashes, model fields and separate human labels. CSV cells are escaped and protected against spreadsheet-formula prefixes. Exported source paths and labels are provenance, not inference inputs. The separate review-log download can include reviews from recorded and live results.

## Live admission and privacy

Redis keys use the isolated `defect-atlas:{admission}` namespace. The Lua admission operation checks global concurrency, one active request per visitor, 100 global requests per UTC day, 24 per visitor per UTC day, and a monthly application allowance. Each admitted image reserves USD 0.01 without refunding the allowance on failure. The default monthly allowance is USD 2 and can be lowered. Active slots expire after 90 seconds; successful responses release their active slot early.

These are application admission counters, not measured API billing. They do not cap unrelated calls made with the same credential. Provider spending controls and the deployment's edge rate-limit rule are separate operational settings. The `*_CONFIRMED` environment flags are operator assertions, not enforcement of those external settings. Missing configuration or Redis errors fail closed for live inference; recorded exploration remains available.

The app does not intentionally log image payloads or retain uploads. Redis contains admission identifiers and counters, not photographs or inspection content. API keys and the cookie signing secret are server-side only. The Decisions request does not use a `store:false` field; no zero-data-retention or provider-deletion claim is made. Default provider data controls and hosting policies apply.

This architecture demonstrates a review workflow. It does not provide tenant isolation, durable case management, factory connectivity, retraining, segmentation, safety certification or proof of production accuracy.
