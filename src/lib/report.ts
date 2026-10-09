import type { InspectionResult, ReviewDecision, Sample, Thresholds } from "./contracts";
import { evaluate, routeInspection, validateEvaluationInputs } from "./evaluation";
import { getPolicy } from "./policies";
import { validateThresholds } from "./validation";

function reviewIndex(results: InspectionResult[], reviews: ReviewDecision[]): Map<string, ReviewDecision> {
  const knownResultIds = new Set(results.map((result) => result.id));
  const index = new Map<string, ReviewDecision>();
  for (const review of reviews) {
    if (!knownResultIds.has(review.resultId)) throw new Error(`Review does not belong to the supplied results: ${review.resultId}`);
    if (index.has(review.resultId)) throw new Error(`Multiple current reviews for result: ${review.resultId}`);
    if (!["normal", "anomaly", "unclear"].includes(review.label)) throw new Error("Invalid review label.");
    index.set(review.resultId, review);
  }
  return index;
}

export function buildReportJson(samples: Sample[], results: InspectionResult[], thresholds: Thresholds, reviews: ReviewDecision[]) {
  const checkedThresholds = validateThresholds(thresholds);
  const resultBySample = validateEvaluationInputs(samples, results);
  const reviewByResult = reviewIndex(results, reviews);
  const policy = results.length ? getPolicy(results[0].policyId) : null;

  return {
    formatVersion: "defect-atlas-report-v1",
    generatedAt: new Date().toISOString(),
    policy: policy ? { ...policy } : null,
    thresholds: checkedThresholds,
    provenance: {
      dataset: "Selected VisA photographs, Amazon Science",
      datasetLicense: "CC BY 4.0",
      source: "https://github.com/amazon-science/spot-diff",
      models: [...new Set(results.map((result) => result.model))].sort(),
      resultSources: [...new Set(results.map((result) => result.source))].sort(),
      splits: [...new Set(samples.filter((sample) => sample.split !== "reference").map((sample) => sample.split))].sort(),
      metricRatesUnit: "fraction_0_to_1",
      referenceSamplesExcluded: samples.filter((sample) => sample.split === "reference").length,
      notes: [
        "Model probabilities are estimates, not calibrated industrial certainty.",
        "Metrics use dataset truth. Human review labels are separate and do not replace it.",
        "Missing, refused and failed inspections count as human review in coverage and recall denominators.",
        "Reference photographs are excluded from evaluation. Select thresholds on calibration data; tuning after viewing holdout is exploratory.",
        "Annotations are dataset ground truth, not model-generated localization.",
      ],
    },
    metrics: evaluate(samples, results, checkedThresholds),
    rows: samples.map((sample) => {
      const result = resultBySample.get(sample.id) ?? null;
      return {
        sampleId: sample.id,
        category: sample.category,
        split: sample.split,
        evaluatedInMetrics: sample.split !== "reference",
        datasetTruth: sample.truth,
        datasetDefectLabels: [...sample.defectLabels],
        imageSrc: sample.imageSrc,
        annotationSrc: sample.annotationSrc,
        sourcePath: sample.sourcePath,
        sha256: sample.sha256,
        result,
        routing: result ? routeInspection(result, checkedThresholds) : { route: "review" as const, reason: "No inspection result is available." },
        humanReview: result ? reviewByResult.get(result.id) ?? null : null,
      };
    }),
  };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function buildReportCsv(samples: Sample[], results: InspectionResult[], thresholds: Thresholds, reviews: ReviewDecision[]): string {
  const report = buildReportJson(samples, results, thresholds, reviews);
  const headers = [
    "reportFormat", "reportGeneratedAt", "policyId", "policyVersion", "clearMax", "flagMin", "usabilityMin", "categoryConfidenceMin",
    "sampleId", "category", "split", "evaluatedInMetrics", "datasetTruth", "datasetDefectLabels", "sourcePath", "sha256",
    "resultId", "resultStatus", "resultSource", "model", "capturedAt", "anomalyProbability", "usableProbability", "categoryChoice", "categoryConfidence",
    "severityScore", "severityProbabilities", "route", "routeReason", "refusalReason", "latencyMs", "inputTokens",
    "humanReviewLabel", "humanReviewedAt", "datasetLicense", "datasetSource", "metricRatesUnit",
  ];
  const rows = report.rows.map((row) => [
    report.formatVersion, report.generatedAt, report.policy?.id, report.policy?.version,
    report.thresholds.clearMax, report.thresholds.flagMin, report.thresholds.usabilityMin, report.thresholds.categoryConfidenceMin,
    row.sampleId, row.category, row.split, row.evaluatedInMetrics, row.datasetTruth, row.datasetDefectLabels, row.sourcePath, row.sha256,
    row.result?.id, row.result?.status ?? "missing", row.result?.source, row.result?.model, row.result?.capturedAt,
    row.result?.anomalyProbability, row.result?.usableProbability, row.result?.categoryChoice, row.result?.categoryConfidence,
    row.result?.severityScore, row.result?.severityProbabilities, row.routing.route, row.routing.reason, row.result?.refusalReason,
    row.result?.latencyMs, row.result?.inputTokens, row.humanReview?.label, row.humanReview?.reviewedAt,
    report.provenance.datasetLicense, report.provenance.source, report.provenance.metricRatesUnit,
  ]);
  return [headers.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\r\n");
}
