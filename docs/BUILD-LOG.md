# Build log

## 2026-10-09: Defect Atlas implementation

The project demonstrates a visual classifier that exposes its mistakes and its hand-off to a person. It belongs to Webytex's Business series, with gold identification, large photographs and readable type for operational buyers.

Implemented three connected stages: Inspect, Calibrate and Compare. Inspection separates recorded model outputs from fresh Decisions calls. Calibration makes the automation/review trade-off interactive. Compare freezes thresholds before revealing held-out results and identifies later tuning as exploratory. Human labels remain independent review records.

The dataset pipeline selected 88 real VisA photographs from candles and PCB1 circuit boards, preserving source identifiers, hashes, separate licenses and deterministic reference/calibration/holdout assignments. Display overlays derive from actual dataset masks and are identified as human annotations. Model payloads receive target image bytes and generic criteria, not source labels or masks.

The server uses OpenAI Decisions with `gpt-6-luna` to assess usability, product family, visible anomaly probability and severity. Two versioned policies compare appearance-only inspection with inspection using two separate normal reference photographs. Neither policy retrains a model. Four live pilot results validated the initial API path before the full recording.

Routing, metrics, report exports, provider validation and admission controls are implemented in code. Live uploads are processed in memory with bounded Sharp normalization. Paid requests require consent, exact origin, signed visitor identity, hosted BotID and shared Redis admission under a project-specific namespace. Automatic paid retries are disabled.

The implementation used AI coding assistance with human direction and review. No client source, images or confidential operational data were copied. No build-time, customer savings or industrial accuracy claim is made.

Full benchmark recording completed with 160 evaluated results across both policies, with no failures or refusals in the saved run. The recording retained its initial four pilot results rather than repeating them. This is evidence that the API path completed, not a claim that every classification was correct. The fixed policies and input-token totals are preserved for review.

At the default thresholds on the 48 selected holdout images, both policies routed 37 automatically and 11 to review. Appearance v1 missed eight source-labelled anomalies; reference v2 missed none and produced one false alarm. Category-level results differ: reference guidance increased human review for candles and reduced it for circuit boards. These observations describe this selected dataset and are not an industrial accuracy or safety guarantee. Exact denominators remain in the validation report.

Final local and browser/deployment checks are in progress at this checkpoint. See [VALIDATION.md](VALIDATION.md) for verification status. The article remains a review draft; deployment does not imply permission to publish it.
