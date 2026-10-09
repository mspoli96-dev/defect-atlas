import type { Evaluation, InspectionResult, RoutingDecision, Sample, Thresholds } from "./contracts";
import { DEFAULT_THRESHOLDS, getPolicy } from "./policies";
import { validateThresholds } from "./validation";

function isProbability(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function routeWithValidatedThresholds(result: InspectionResult, thresholds: Thresholds): RoutingDecision {
  if (result.status !== "evaluated") {
    return { route: "review", reason: result.status === "refused" ? "The model declined this inspection." : "This inspection did not complete." };
  }
  if (!isProbability(result.anomalyProbability) || !isProbability(result.usableProbability) || !isProbability(result.categoryConfidence)) {
    return { route: "review", reason: "A required probability is missing or invalid." };
  }
  if ((result.category !== "candle" && result.category !== "pcb1") || result.categoryChoice !== result.category) {
    return { route: "review", reason: "The detected object does not match the requested product category." };
  }
  if (result.categoryConfidence < thresholds.categoryConfidenceMin) {
    return { route: "review", reason: "The product category is uncertain." };
  }
  if (result.usableProbability < thresholds.usabilityMin) {
    return { route: "review", reason: "The photograph may not be usable for visual inspection." };
  }
  if (result.anomalyProbability <= thresholds.clearMax) {
    return { route: "clear", reason: "The estimated anomaly probability is at or below the clear threshold." };
  }
  if (result.anomalyProbability >= thresholds.flagMin) {
    return { route: "flag", reason: "The estimated anomaly probability is at or above the flag threshold." };
  }
  return { route: "review", reason: "The estimated anomaly probability is between the automation thresholds." };
}

export function routeInspection(result: InspectionResult, thresholds: Thresholds): RoutingDecision {
  return routeWithValidatedThresholds(result, validateThresholds(thresholds));
}

export function validateEvaluationInputs(samples: Sample[], results: InspectionResult[]): Map<string, InspectionResult> {
  const sampleById = new Map<string, Sample>();
  for (const sample of samples) {
    if (sampleById.has(sample.id)) throw new Error(`Duplicate sample ID: ${sample.id}`);
    if (sample.category !== "candle" && sample.category !== "pcb1") throw new Error("Unsupported sample category.");
    if (sample.truth !== "normal" && sample.truth !== "anomaly") throw new Error("Invalid dataset truth.");
    if (!["reference", "calibration", "holdout"].includes(sample.split)) throw new Error("Invalid dataset split.");
    sampleById.set(sample.id, sample);
  }

  const resultBySample = new Map<string, InspectionResult>();
  const resultIds = new Set<string>();
  const policyIds = new Set<string>();
  for (const result of results) {
    if (resultIds.has(result.id)) throw new Error(`Duplicate result ID: ${result.id}`);
    if (resultBySample.has(result.sampleId)) throw new Error(`Multiple results for sample: ${result.sampleId}`);
    const sample = sampleById.get(result.sampleId);
    if (!sample) throw new Error(`Result does not belong to the supplied samples: ${result.sampleId}`);
    if (sample.category !== result.category) throw new Error(`Result category does not match sample: ${sample.id}`);
    getPolicy(result.policyId);
    policyIds.add(result.policyId);
    if (policyIds.size > 1) throw new Error("Evaluate one policy at a time.");
    resultIds.add(result.id);
    resultBySample.set(result.sampleId, result);
  }
  return resultBySample;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function evaluate(samples: Sample[], results: InspectionResult[], thresholds: Thresholds): Evaluation {
  const checkedThresholds = validateThresholds(thresholds);
  const resultBySample = validateEvaluationInputs(samples, results);
  const evaluation: Evaluation = {
    total: 0,
    clear: 0,
    flag: 0,
    review: 0,
    trueClear: 0,
    missedAnomalies: 0,
    trueFlags: 0,
    falseAlarms: 0,
    reviewNormal: 0,
    reviewAnomaly: 0,
    coverage: null,
    flagPrecision: null,
    automatedDefectRecall: null,
    selectiveAccuracy: null,
  };

  for (const sample of samples) {
    if (sample.split === "reference") continue;
    evaluation.total += 1;
    const result = resultBySample.get(sample.id);
    const route = result ? routeWithValidatedThresholds(result, checkedThresholds).route : "review";
    evaluation[route] += 1;
    if (route === "clear") evaluation[sample.truth === "normal" ? "trueClear" : "missedAnomalies"] += 1;
    if (route === "flag") evaluation[sample.truth === "anomaly" ? "trueFlags" : "falseAlarms"] += 1;
    if (route === "review") evaluation[sample.truth === "normal" ? "reviewNormal" : "reviewAnomaly"] += 1;
  }

  const automated = evaluation.clear + evaluation.flag;
  const anomalies = evaluation.trueFlags + evaluation.missedAnomalies + evaluation.reviewAnomaly;
  evaluation.coverage = ratio(automated, evaluation.total);
  evaluation.flagPrecision = ratio(evaluation.trueFlags, evaluation.flag);
  evaluation.automatedDefectRecall = ratio(evaluation.trueFlags, anomalies);
  evaluation.selectiveAccuracy = ratio(evaluation.trueClear + evaluation.trueFlags, automated);
  return evaluation;
}

export interface ThresholdSweepPoint extends Evaluation {
  thresholds: Thresholds;
}

export function thresholdSweep(samples: Sample[], results: InspectionResult[]): ThresholdSweepPoint[] {
  return [70, 75, 80, 85, 90, 95].map((percent) => {
    const thresholds = { ...DEFAULT_THRESHOLDS, flagMin: percent / 100, clearMax: (100 - percent) / 100 };
    return { thresholds, ...evaluate(samples, results, thresholds) };
  });
}
