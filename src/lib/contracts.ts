export type CategoryId = "candle" | "pcb1";
export type SampleSplit = "reference" | "calibration" | "holdout";
export type Truth = "normal" | "anomaly";
export type PolicyId = "appearance-v1" | "reference-v2";
export type Route = "clear" | "flag" | "review";

export interface Sample {
  id: string;
  category: CategoryId;
  split: SampleSplit;
  imageSrc: string;
  annotationSrc: string | null;
  truth: Truth;
  defectLabels: string[];
  width: number;
  height: number;
  sourcePath: string;
  sha256: string;
}

export interface Policy {
  id: PolicyId;
  name: string;
  version: string;
  description: string;
  usesReferences: boolean;
}

export interface Thresholds {
  clearMax: number;
  flagMin: number;
  usabilityMin: number;
  categoryConfidenceMin: number;
}

export interface InspectionResult {
  id: string;
  sampleId: string;
  category: CategoryId;
  policyId: PolicyId;
  status: "evaluated" | "refused" | "failed";
  anomalyProbability: number | null;
  usableProbability: number | null;
  categoryChoice: CategoryId | "other" | null;
  categoryConfidence: number | null;
  severityScore: number | null;
  severityProbabilities: number[];
  refusalReason: string | null;
  model: string;
  latencyMs: number;
  inputTokens: number;
  capturedAt: string;
  source: "recorded" | "live";
}

export interface RoutingDecision {
  route: Route;
  reason: string;
}

export interface ReviewDecision {
  resultId: string;
  label: "normal" | "anomaly" | "unclear";
  reviewedAt: string;
}

export interface Evaluation {
  total: number;
  clear: number;
  flag: number;
  review: number;
  trueClear: number;
  missedAnomalies: number;
  trueFlags: number;
  falseAlarms: number;
  reviewNormal: number;
  reviewAnomaly: number;
  coverage: number | null;
  flagPrecision: number | null;
  automatedDefectRecall: number | null;
  selectiveAccuracy: number | null;
}

export interface RecordedRun {
  id: string;
  datasetVersion: string;
  policyId: PolicyId;
  model: string;
  capturedAt: string;
  results: InspectionResult[];
  notes: string[];
}

export interface InspectionRequest {
  category: CategoryId;
  policyId: PolicyId;
  revision: number;
  consent: true;
  sampleId?: string;
  imageDataUrl?: string;
}

export interface InspectionResponse {
  result: InspectionResult;
  revision: number;
}

export interface LiveConfig {
  liveEnabled: boolean;
  model: string;
  unavailableReason: string | null;
}
