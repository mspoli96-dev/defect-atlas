import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifest from "../src/data/dataset-manifest.json";
import { CATEGORIES, DATASET_VERSION, getReferences, getSample, getSamples, SAMPLES } from "../src/lib/dataset";

const sha256 = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
const publicFile = (source: string) => path.join(process.cwd(), "public", source);

describe("the fixed VisA selection", () => {
  it("keeps the agreed category, split and class denominators", () => {
    expect(DATASET_VERSION).toBe("visa-candle-pcb1-v1");
    expect(manifest.preparationStatus).toBe("complete");
    expect(SAMPLES).toHaveLength(88);
    expect(CATEGORIES.map((category) => category.id)).toEqual(["candle", "pcb1"]);
    for (const { id } of CATEGORIES) {
      const reference = getReferences(id);
      expect(reference).toHaveLength(4);
      expect(reference.every((sample) => sample.truth === "normal")).toBe(true);
      for (const [split, eachClass] of [["calibration", 8], ["holdout", 12]] as const) {
        const samples = getSamples(id, split);
        expect(samples).toHaveLength(eachClass * 2);
        expect(samples.filter((sample) => sample.truth === "normal")).toHaveLength(eachClass);
        expect(samples.filter((sample) => sample.truth === "anomaly")).toHaveLength(eachClass);
      }
    }
  });

  it("has no cross-split source-path or image-content duplicates", () => {
    expect(new Set(SAMPLES.map((sample) => sample.id)).size).toBe(88);
    expect(new Set(SAMPLES.map((sample) => sample.sourcePath)).size).toBe(88);
    expect(new Set(SAMPLES.map((sample) => sample.sha256)).size).toBe(88);
    expect(new Set(manifest.provenance.map((sample) => sample.originalSha256)).size).toBe(88);
    expect(manifest.provenance.map((sample) => sample.sampleId)).toEqual(SAMPLES.map((sample) => sample.id));
  });

  it("retains deterministic ranking and opaque IDs independent of model results", () => {
    const rank = (sample: (typeof SAMPLES)[number]) => sha256(Buffer.from(`${manifest.selectionSeed}\0${sample.category}\0${sample.truth}\0${sample.sourcePath}`));
    for (const { id } of CATEGORIES) {
      for (const truth of ["normal", "anomaly"] as const) {
        const ordered = SAMPLES.filter((sample) => sample.category === id && sample.truth === truth)
          .sort((a, b) => rank(a).localeCompare(rank(b)));
        const expected = [
          ...(truth === "normal" ? Array<string>(4).fill("reference") : []),
          ...Array<string>(8).fill("calibration"),
          ...Array<string>(12).fill("holdout"),
        ];
        expect(ordered.map((sample) => sample.split)).toEqual(expected);
      }
    }
    for (const sample of SAMPLES) {
      expect(sample.id).toBe(`da-${sha256(Buffer.from(`opaque\0${sample.sourcePath}`)).slice(0, 12)}`);
    }
  });

  it("serves opaque image paths without truth or original filenames", () => {
    for (const sample of SAMPLES) {
      expect(sample.id).toMatch(/^da-[a-f0-9]{12}$/);
      expect(sample.imageSrc).toBe(`/dataset/images/${sample.id}.jpg`);
      expect(sample.imageSrc).not.toMatch(/normal|anomaly|holdout|calibration/i);
      expect(sample.sourcePath).toMatch(/^(candle|pcb1)\/Data\/Images\/(Normal|Anomaly)\/\d+\.JPG$/);
      expect(sample.sourcePath.includes("/Normal/")).toBe(sample.truth === "normal");
      expect(getSample(sample.id)).toBe(sample);
    }
    expect(getSample("unknown")).toBeUndefined();
  });

  it("preserves separate dataset licensing and pinned source metadata hashes", async () => {
    expect(manifest.source.license).toBe("CC-BY-4.0");
    expect(manifest.source.commit).toBe("2a692ab575001cbde74d402d897a7286086c6199");
    const license = await readFile(path.join(process.cwd(), "LICENSE-DATASET"));
    expect(sha256(license)).toBe(manifest.source.metadata["LICENSE-DATASET"].sha256);
    expect(manifest.source.archive.byteLength).toBe(1_929_840_640);
    expect(manifest.source.archive.url).toBe("https://amazon-visual-anomaly.s3.us-west-2.amazonaws.com/VisA_20220922.tar");
    for (const value of Object.values(manifest.source.metadata)) expect(value.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("matches served JPEG content hashes and dimensions without embedded metadata", async () => {
    for (const sample of SAMPLES) {
      const image = await readFile(publicFile(sample.imageSrc));
      expect(sha256(image), sample.id).toBe(sample.sha256);
      const metadata = await sharp(image).metadata();
      expect(metadata.format).toBe("jpeg");
      expect(metadata.width).toBe(sample.width);
      expect(metadata.height).toBe(sample.height);
      expect(Math.max(sample.width, sample.height)).toBeLessThanOrEqual(768);
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
    }
  });

  it("aligns real anomaly masks and class labels without annotating normal images", async () => {
    for (const sample of SAMPLES) {
      const provenance = manifest.provenance.find((entry) => entry.sampleId === sample.id)!;
      expect(provenance.processedSha256).toBe(sample.sha256);
      if (sample.truth === "normal") {
        expect(sample.annotationSrc).toBeNull();
        expect(sample.defectLabels).toEqual([]);
        expect(provenance.annotation).toBeNull();
        continue;
      }
      expect(sample.annotationSrc).toBe(`/dataset/annotations/${sample.id}.png`);
      expect(sample.defectLabels.length).toBeGreaterThan(0);
      const annotation = await readFile(publicFile(sample.annotationSrc!));
      expect(sha256(annotation)).toBe(provenance.annotation!.processedSha256);
      const metadata = await sharp(annotation).metadata();
      expect(metadata.format).toBe("png");
      expect(metadata.width).toBe(sample.width);
      expect(metadata.height).toBe(sample.height);
      expect(metadata.hasAlpha).toBe(true);
      expect(provenance.annotation!.classIds.every((id) => id > 0 && id <= (sample.category === "candle" ? 8 : 4))).toBe(true);
    }
  });
});
