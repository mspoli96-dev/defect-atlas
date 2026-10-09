import { describe, expect, it } from "vitest";
import type { InspectionResult, ReviewDecision, Sample } from "../src/lib/contracts";
import { evaluate, routeInspection, thresholdSweep } from "../src/lib/evaluation";
import { DEFAULT_THRESHOLDS, getPolicy } from "../src/lib/policies";
import { buildReportCsv, buildReportJson } from "../src/lib/report";

function sample(id: string, truth: Sample["truth"] = "normal", changes: Partial<Sample> = {}): Sample {
  return {
    id,
    category: "candle",
    split: "calibration",
    imageSrc: `/dataset/${id}.webp`,
    annotationSrc: truth === "anomaly" ? `/dataset/${id}-mask.png` : null,
    truth,
    defectLabels: truth === "anomaly" ? ["visible damage"] : [],
    width: 512,
    height: 512,
    sourcePath: `candle/${id}.JPG`,
    sha256: "a".repeat(64),
    ...changes,
  };
}

function result(sampleId: string, probability: number | null = 0.1, changes: Partial<InspectionResult> = {}): InspectionResult {
  return {
    id: `result-${sampleId}`,
    sampleId,
    category: "candle",
    policyId: "appearance-v1",
    status: "evaluated",
    anomalyProbability: probability,
    usableProbability: 0.95,
    categoryChoice: "candle",
    categoryConfidence: 0.95,
    severityScore: 0,
    severityProbabilities: [1, 0, 0, 0],
    refusalReason: null,
    model: "gpt-6-luna",
    latencyMs: 350,
    inputTokens: 800,
    capturedAt: "2026-10-09T12:00:00.000Z",
    source: "recorded",
    ...changes,
  };
}

describe("inspection routing", () => {
  it.each([
    [0, "clear"],
    [0.2, "clear"],
    [0.200001, "review"],
    [0.799999, "review"],
    [0.8, "flag"],
    [1, "flag"],
  ] as const)("routes probability %s at inclusive threshold boundaries to %s", (probability, route) => {
    expect(routeInspection(result("boundary", probability), DEFAULT_THRESHOLDS).route).toBe(route);
  });

  it.each([null, NaN, Infinity, -Infinity, -0.01, 1.01])("routes an invalid probability %s to review", (probability) => {
    for (const field of ["anomalyProbability", "usableProbability", "categoryConfidence"] as const) {
      expect(routeInspection(result("invalid", 0.9, { [field]: probability }), DEFAULT_THRESHOLDS).route).toBe("review");
    }
  });

  it.each(["refused", "failed"] as const)("routes %s to review even with a decisive numeric estimate", (status) => {
    expect(routeInspection(result("status", 0.99, { status }), DEFAULT_THRESHOLDS).route).toBe("review");
  });

  it.each(["pcb1", "other", null] as const)("routes category choice %s to review for a candle request", (categoryChoice) => {
    expect(routeInspection(result("category", 0.99, { categoryChoice }), DEFAULT_THRESHOLDS).route).toBe("review");
  });

  it("requires usable photographs and enough category confidence before automation", () => {
    expect(routeInspection(result("blur", 0.99, { usableProbability: 0.69999 }), DEFAULT_THRESHOLDS).route).toBe("review");
    expect(routeInspection(result("uncertain", 0.01, { categoryConfidence: 0.74999 }), DEFAULT_THRESHOLDS).route).toBe("review");
    expect(routeInspection(result("boundary", 0.99, { usableProbability: 0.7, categoryConfidence: 0.75 }), DEFAULT_THRESHOLDS).route).toBe("flag");
  });

  it("does not substitute a severity score for the anomaly probability", () => {
    expect(routeInspection(result("severity", 0.1, { severityScore: 3 }), DEFAULT_THRESHOLDS).route).toBe("clear");
    expect(routeInspection(result("severity", 0.9, { severityScore: 0 }), DEFAULT_THRESHOLDS).route).toBe("flag");
  });

  it("rejects invalid thresholds instead of silently automating", () => {
    for (const thresholds of [
      { ...DEFAULT_THRESHOLDS, clearMax: 0.8 },
      { ...DEFAULT_THRESHOLDS, flagMin: 0.1 },
      { ...DEFAULT_THRESHOLDS, usabilityMin: -1 },
      { ...DEFAULT_THRESHOLDS, categoryConfidenceMin: Infinity },
    ]) expect(() => routeInspection(result("thresholds"), thresholds)).toThrow();
  });
});

describe("benchmark evaluation", () => {
  const samples = [
    sample("true-clear"),
    sample("miss", "anomaly"),
    sample("true-flag", "anomaly"),
    sample("false-alarm"),
    sample("uncertain"),
    sample("refused", "anomaly"),
    sample("failed"),
    sample("missing", "anomaly"),
    sample("reference", "normal", { split: "reference" }),
  ];
  const results = [
    result("true-clear", 0.1),
    result("miss", 0.1),
    result("true-flag", 0.9),
    result("false-alarm", 0.9),
    result("uncertain", 0.5),
    result("refused", null, { status: "refused" }),
    result("failed", null, { status: "failed" }),
    result("reference", 0.99),
  ];

  it("matches a hand-counted confusion matrix including missing, refused and failed inspections", () => {
    expect(evaluate(samples, results, DEFAULT_THRESHOLDS)).toEqual({
      total: 8,
      clear: 2,
      flag: 2,
      review: 4,
      trueClear: 1,
      missedAnomalies: 1,
      trueFlags: 1,
      falseAlarms: 1,
      reviewNormal: 2,
      reviewAnomaly: 2,
      coverage: 0.5,
      flagPrecision: 0.5,
      automatedDefectRecall: 0.25,
      selectiveAccuracy: 0.5,
    });
  });

  it("includes every non-reference image even before any inference results exist", () => {
    const metrics = evaluate(samples, [], DEFAULT_THRESHOLDS);
    expect(metrics.total).toBe(8);
    expect(metrics.review).toBe(8);
    expect(metrics.coverage).toBe(0);
    expect(metrics.automatedDefectRecall).toBe(0);
    expect(metrics.selectiveAccuracy).toBeNull();
    expect(metrics.flagPrecision).toBeNull();
  });

  it("does not invent rates for datasets without relevant denominators", () => {
    const normalOnly = evaluate([sample("normal")], [result("normal")], DEFAULT_THRESHOLDS);
    expect(normalOnly.automatedDefectRecall).toBeNull();
    expect(normalOnly.flagPrecision).toBeNull();
    expect(normalOnly.selectiveAccuracy).toBe(1);
    const empty = evaluate([], [], DEFAULT_THRESHOLDS);
    expect(empty.total).toBe(0);
    expect(empty.coverage).toBeNull();
    expect(empty.automatedDefectRecall).toBeNull();
    expect(empty.selectiveAccuracy).toBeNull();
    expect(empty.flagPrecision).toBeNull();
  });

  it("treats a detected category mismatch as review, while rejecting a result mapped to the wrong requested category", () => {
    const target = sample("target");
    expect(evaluate([target], [result("target", 0.9, { categoryChoice: "pcb1" })], DEFAULT_THRESHOLDS).review).toBe(1);
    expect(() => evaluate([target], [result("target", 0.9, { category: "pcb1" })], DEFAULT_THRESHOLDS)).toThrow("category does not match");
  });

  it("rejects duplicate IDs, unknown sample mappings, and mixed-policy comparisons", () => {
    expect(() => evaluate([sample("one"), sample("one")], [], DEFAULT_THRESHOLDS)).toThrow("Duplicate sample ID");
    expect(() => evaluate([sample("one")], [result("unknown")], DEFAULT_THRESHOLDS)).toThrow("does not belong");
    expect(() => evaluate([sample("one")], [result("one"), result("one")], DEFAULT_THRESHOLDS)).toThrow("Duplicate result ID");
    expect(() => evaluate([sample("one")], [result("one"), result("one", 0.2, { id: "other-result" })], DEFAULT_THRESHOLDS)).toThrow("Multiple results");
    expect(() => evaluate([sample("one"), sample("two")], [result("one"), result("two", 0.9, { policyId: "reference-v2" })], DEFAULT_THRESHOLDS)).toThrow("one policy at a time");
  });

  it("sweeps stricter paired thresholds without changing usability or category confidence requirements", () => {
    const points = thresholdSweep(samples, results);
    expect(points.map((point) => point.thresholds.flagMin)).toEqual([0.7, 0.75, 0.8, 0.85, 0.9, 0.95]);
    expect(points.map((point) => point.thresholds.clearMax)).toEqual([0.3, 0.25, 0.2, 0.15, 0.1, 0.05]);
    expect(points.at(-1)?.coverage).toBe(0);
    for (let index = 1; index < points.length; index += 1) {
      const currentCoverage = points[index].coverage;
      const previousCoverage = points[index - 1].coverage;
      if (currentCoverage === null || previousCoverage === null) throw new Error("A nonempty dataset must have defined coverage.");
      expect(currentCoverage).toBeLessThanOrEqual(previousCoverage);
      expect(points[index].missedAnomalies).toBeLessThanOrEqual(points[index - 1].missedAnomalies);
      expect(points[index].falseAlarms).toBeLessThanOrEqual(points[index - 1].falseAlarms);
      expect(points[index].thresholds.usabilityMin).toBe(DEFAULT_THRESHOLDS.usabilityMin);
    }
  });
});

describe("inspection reports", () => {
  it("exports dataset truth, original results and human review separately without changing benchmark metrics", () => {
    const samples = [sample("miss", "anomaly")];
    const results = [result("miss", 0.1)];
    const reviews: ReviewDecision[] = [{ resultId: results[0].id, label: "normal", reviewedAt: "2026-10-09T13:00:00Z" }];
    const report = buildReportJson(samples, results, DEFAULT_THRESHOLDS, reviews);
    expect(report.metrics.missedAnomalies).toBe(1);
    expect(report.rows[0].datasetTruth).toBe("anomaly");
    expect(report.rows[0].humanReview?.label).toBe("normal");
    expect(report.rows[0].result?.anomalyProbability).toBe(0.1);
    expect(report.rows[0].routing.route).toBe("clear");
    expect(report.policy).toMatchObject({ id: "appearance-v1", version: "1.0.0" });
    expect(report.thresholds).toEqual(DEFAULT_THRESHOLDS);
    expect(report.provenance.metricRatesUnit).toBe("fraction_0_to_1");
    expect(report.rows[0].sha256).toBe(samples[0].sha256);
  });

  it("records missing images as review and preserves reference-exclusion provenance", () => {
    const report = buildReportJson([sample("missing"), sample("ref", "normal", { split: "reference" })], [], DEFAULT_THRESHOLDS, []);
    expect(report.policy).toBeNull();
    expect(report.metrics.total).toBe(1);
    expect(report.rows[0].result).toBeNull();
    expect(report.rows[0].routing.route).toBe("review");
    expect(report.rows[1].evaluatedInMetrics).toBe(false);
    expect(report.provenance.referenceSamplesExcluded).toBe(1);
  });

  it("includes threshold, source, policy and correction provenance in a safely quoted CSV", () => {
    const samples = [sample("one", "anomaly", { sourcePath: '=HYPERLINK("https://invalid.example")', defectLabels: ['damage, "large"'] })];
    const results = [result("one")];
    const csv = buildReportCsv(samples, results, DEFAULT_THRESHOLDS, [{ resultId: results[0].id, label: "unclear", reviewedAt: "2026-10-09T13:00:00Z" }]);
    expect(csv).toContain('"datasetTruth"');
    expect(csv).toContain('"humanReviewLabel"');
    expect(csv).toContain('"policyVersion"');
    expect(csv).toContain('"clearMax"');
    expect(csv).toContain('"recorded"');
    expect(csv).toContain('"CC BY 4.0"');
    expect(csv).toContain('"\'=HYPERLINK(""https://invalid.example"")"');
    expect(csv.split("\r\n")).toHaveLength(2);
  });

  it("rejects ambiguous or unrelated human reviews", () => {
    const samples = [sample("one")];
    const results = [result("one")];
    const review: ReviewDecision = { resultId: results[0].id, label: "normal", reviewedAt: "2026-10-09T13:00:00Z" };
    expect(() => buildReportJson(samples, results, DEFAULT_THRESHOLDS, [review, review])).toThrow("Multiple current reviews");
    expect(() => buildReportJson(samples, results, DEFAULT_THRESHOLDS, [{ ...review, resultId: "unrelated" }])).toThrow("does not belong");
  });

  it("keeps both policy definitions explicit without inferring an unknown policy", () => {
    expect(getPolicy("appearance-v1").usesReferences).toBe(false);
    expect(getPolicy("reference-v2").usesReferences).toBe(true);
    expect(() => getPolicy("unpublished-policy")).toThrow("Unknown inspection policy");
  });
});
