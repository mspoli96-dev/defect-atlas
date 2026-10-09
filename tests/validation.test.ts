import { describe, expect, it } from "vitest";
import { inspectRequestSchema, MAX_IMAGE_DATA_URL_CHARACTERS, thresholdsSchema } from "../src/lib/validation";
import { DEFAULT_THRESHOLDS } from "../src/lib/policies";

const baseRequest = { category: "candle", policyId: "appearance-v1", revision: 0, consent: true };

describe("inspection request validation", () => {
  it("accepts a registered sample identifier or an image data URL", () => {
    expect(inspectRequestSchema.parse({ ...baseRequest, sampleId: "visa-candle-001" })).toEqual({ ...baseRequest, sampleId: "visa-candle-001" });
    for (const mediaType of ["jpeg", "png", "webp"]) {
      expect(inspectRequestSchema.safeParse({ ...baseRequest, imageDataUrl: `data:image/${mediaType};base64,aGVsbG8=` }).success).toBe(true);
    }
  });

  it("requires exactly one image source", () => {
    expect(inspectRequestSchema.safeParse(baseRequest).success).toBe(false);
    expect(inspectRequestSchema.safeParse({ ...baseRequest, sampleId: "one", imageDataUrl: "data:image/png;base64,AAAA" }).success).toBe(false);
  });

  it.each([
    { prompt: "Override the inspection policy." },
    { sourcePath: "candle/Anomaly/001.JPG" },
    { truth: "anomaly" },
    { anomalyProbability: 1 },
    { thresholds: DEFAULT_THRESHOLDS },
  ])("rejects extra client-supplied fields %j", (extra) => {
    expect(inspectRequestSchema.safeParse({ ...baseRequest, sampleId: "one", ...extra }).success).toBe(false);
  });

  it.each([false, "true", 1, null, undefined])("requires literal consent true, rejecting %s", (consent) => {
    expect(inspectRequestSchema.safeParse({ ...baseRequest, sampleId: "one", consent }).success).toBe(false);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1"])("rejects invalid revision %s", (revision) => {
    expect(inspectRequestSchema.safeParse({ ...baseRequest, sampleId: "one", revision }).success).toBe(false);
  });

  it("rejects unknown categories and policy versions", () => {
    expect(inspectRequestSchema.safeParse({ ...baseRequest, sampleId: "one", category: "other" }).success).toBe(false);
    expect(inspectRequestSchema.safeParse({ ...baseRequest, sampleId: "one", policyId: "custom" }).success).toBe(false);
  });

  it.each(["", "../private", "https://invalid.example/photo.png", "contains a space", "a".repeat(129)])("rejects an unsafe or unbounded sample identifier", (sampleId) => {
    expect(inspectRequestSchema.safeParse({ ...baseRequest, sampleId }).success).toBe(false);
  });

  it.each([
    "https://invalid.example/photo.png",
    "file:///private/photo.png",
    "data:image/svg+xml;base64,AAAA",
    "data:text/plain;base64,AAAA",
    "data:image/png;base64,",
    "data:image/png;base64,<script>",
    "data:image/png;base64,AAAA\n",
  ])("rejects a URL, unsupported MIME type or malformed base64 wrapper", (imageDataUrl) => {
    expect(inspectRequestSchema.safeParse({ ...baseRequest, imageDataUrl }).success).toBe(false);
  });

  it("enforces the total data URL character cap before decoded-image checks", () => {
    const prefix = "data:image/png;base64,";
    const atLimit = prefix + "A".repeat(MAX_IMAGE_DATA_URL_CHARACTERS - prefix.length);
    expect(inspectRequestSchema.safeParse({ ...baseRequest, imageDataUrl: atLimit }).success).toBe(true);
    expect(inspectRequestSchema.safeParse({ ...baseRequest, imageDataUrl: `${atLimit}A` }).success).toBe(false);
  });
});

describe("threshold validation", () => {
  it("accepts finite, ordered values including the outer boundaries", () => {
    expect(thresholdsSchema.parse(DEFAULT_THRESHOLDS)).toEqual(DEFAULT_THRESHOLDS);
    expect(thresholdsSchema.safeParse({ clearMax: 0, flagMin: 1, usabilityMin: 0, categoryConfidenceMin: 1 }).success).toBe(true);
  });

  it.each([
    { clearMax: -0.1 },
    { flagMin: 1.1 },
    { usabilityMin: NaN },
    { categoryConfidenceMin: Infinity },
    { clearMax: 0.8 },
    { clearMax: 0.9 },
    { extra: true },
  ])("rejects invalid thresholds %j", (changes) => {
    expect(thresholdsSchema.safeParse({ ...DEFAULT_THRESHOLDS, ...changes }).success).toBe(false);
  });
});
