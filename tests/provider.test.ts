import { describe, expect, it } from "vitest";
import type { Decision } from "openai/resources/decisions";
import sharp from "sharp";
import { buildDecisionRequest, parseDecision } from "../src/lib/server/provider";
import { candidateImage, normalizeImage, readDatasetImage } from "../src/lib/server/images";
import type { InspectionRequest } from "../src/lib/contracts";

const request: InspectionRequest = { sampleId: "opaque-sample", category: "candle", policyId: "appearance-v1", revision: 4, consent: true };
function decision(): Decision {
  return { model: "gpt-6-luna", answers: [
    { type: "predicate", name: "usable", probability: 0.95 },
    { type: "predicate", name: "visible_anomaly", probability: 0.85 },
    { type: "choice", name: "family", choice: "candle", confidence: 0.9, probabilities: [{ value: "candle", probability: 0.95 }, { value: "pcb1", probability: 0.02 }, { value: "other", probability: 0.03 }] },
    { type: "score", name: "severity", score: 1.2, confidence: 0.8, probabilities: [{ value: 0, label: "None", probability: 0.1 }, { value: 1, label: "Subtle", probability: 0.6 }, { value: 2, label: "Clear", probability: 0.3 }, { value: 3, label: "Extensive", probability: 0 }] },
  ], usage: { input_tokens: 1200, output_tokens: 0, total_tokens: 1200, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
}

describe("Decisions request and verified outputs", () => {
  it("sends only the selected image and fixed instructions for appearance policy", () => {
    const payload = buildDecisionRequest("candle", "appearance-v1", "data:image/jpeg;base64,TARGET");
    expect(payload.model).toBe("gpt-6-luna");
    const serialized = JSON.stringify(payload);
    expect(serialized.match(/input_image/g)).toHaveLength(1);
    for (const forbidden of ["truth", "defectLabels", "sourcePath", "holdout", "annotationSrc", "sampleId", "opaque-sample"]) expect(serialized).not.toContain(forbidden);
    expect(payload.questions.map(question=>question.name)).toEqual(["usable", "family", "visible_anomaly", "severity"]);
    expect(payload).not.toHaveProperty("tools"); expect(payload).not.toHaveProperty("store");
  });
  it("places two separate normal references before target without transmitting filenames or labels", () => {
    const payload = buildDecisionRequest("pcb1", "reference-v2", "TARGET", ["REFERENCE_A", "REFERENCE_B"]);
    const input = payload.input;
    if (typeof input === "string" || typeof input[0].content === "string") throw new Error("Expected image parts.");
    const images = input[0].content.filter(part=>part.type==="input_image");
    expect(images.map(image=>image.image_url)).toEqual(["REFERENCE_A", "REFERENCE_B", "TARGET"]);
    expect(()=>buildDecisionRequest("pcb1","reference-v2","TARGET",[])).toThrow(/Two normal/);
  });
  it("maps named answers regardless of order and preserves measured provenance", () => {
    const response = decision(); response.answers.reverse();
    const result = parseDecision(response, request, 123, "recorded");
    expect(result).toMatchObject({ sampleId: request.sampleId, status: "evaluated", source: "recorded", anomalyProbability: 0.85, usableProbability: 0.95, severityScore: 1.2, severityProbabilities: [0.1,0.6,0.3,0], inputTokens: 1200, latencyMs: 123 });
    expect(result.refusalReason).toBeNull();
  });
  it("routes any partial refusal to review without inventing missing scores", () => {
    const response = decision(); response.answers[0] = { type: "refusal", name: "usable" };
    expect(parseDecision(response,request,42)).toMatchObject({status:"refused",anomalyProbability:null,usableProbability:null,categoryConfidence:null});
  });
  it.each(["missing", "duplicate", "invalid-probability", "bad-score", "bad-distribution", "unknown-category", "wrong-model"])("rejects %s provider output", mode => {
    const response = decision();
    if(mode==="missing") response.answers.pop();
    if(mode==="duplicate") response.answers[0]=response.answers[1];
    if(mode==="invalid-probability" && response.answers[0].type==="predicate") response.answers[0].probability=NaN;
    if(mode==="bad-score" && response.answers[3].type==="score") response.answers[3].score=2.9;
    if(mode==="bad-distribution" && response.answers[2].type==="choice") response.answers[2].probabilities[0].probability=0.4;
    if(mode==="unknown-category" && response.answers[2].type==="choice") response.answers[2].choice="car";
    if(mode==="wrong-model") response.model="different-model";
    expect(()=>parseDecision(response,request,50)).toThrow();
  });
  it("assigns opaque upload IDs without storing upload data in results", () => {
    const result=parseDecision(decision(),{...request,sampleId:undefined,imageDataUrl:"data:image/jpeg;base64,TARGET"},1);
    expect(result.sampleId).toMatch(/^upload-/); expect(JSON.stringify(result)).not.toContain("TARGET");
  });
});

describe("image boundary", () => {
  it("normalizes pixel dimensions and strips source metadata", async () => {
    const original=await sharp({create:{width:1000,height:500,channels:3,background:"#ccc"}}).jpeg().withMetadata({orientation:1}).toBuffer();
    const data=await normalizeImage(original);
    const metadata=await sharp(Buffer.from(data.split(",")[1],"base64")).metadata();
    expect(metadata.width).toBe(768); expect(metadata.height).toBe(384); expect(metadata.exif).toBeUndefined();
  });
  it("rejects oversized files, unreadable content and SVG before calling the provider", async () => {
    await expect(normalizeImage(Buffer.alloc(2_097_153))).rejects.toMatchObject({status:413});
    await expect(normalizeImage(Buffer.from("not an image"))).rejects.toMatchObject({status:400});
    await expect(normalizeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"></svg>'))).rejects.toMatchObject({status:400});
  });
  it("rejects external URLs, traversal and unknown sample IDs", async () => {
    await expect(readDatasetImage("/dataset/../.env.local")).rejects.toMatchObject({status:400});
    await expect(candidateImage({...request,sampleId:"unknown"})).rejects.toMatchObject({status:400});
    await expect(candidateImage({...request,sampleId:undefined,imageDataUrl:"https://example.com/image.png"})).rejects.toMatchObject({status:400});
  });
});
