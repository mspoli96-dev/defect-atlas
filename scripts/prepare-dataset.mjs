import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = path.resolve(process.argv[2] ?? "");
if (!process.argv[2] || cache === repository || cache.startsWith(`${repository}${path.sep}`)) {
  throw new Error("Provide an existing source cache outside the public repository.");
}
const selection = JSON.parse(await readFile(path.join(cache, "selection.json"), "utf8"));
const classes = {
  candle: { 1: "Chunk Of Wax Missing", 2: "Damaged Corner of Packaging", 3: "weird candle wick", 4: "Different Colour Spot", 5: "Extra Wax in Candle", 6: "Foreign Particals on Candle", 7: "Wax Melded out of the candle", 8: "Other" },
  pcb1: { 1: "Bent", 2: "Melt", 3: "Scratch", 4: "Missing" },
};
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");
const imageDirectory = path.join(repository, "public", "dataset", "images");
const annotationDirectory = path.join(repository, "public", "dataset", "annotations");
await mkdir(imageDirectory, { recursive: true });
await mkdir(annotationDirectory, { recursive: true });
await mkdir(path.join(repository, "src", "data"), { recursive: true });
const partialCategory = process.argv[3]?.replace(/^--category=/, "");
if (partialCategory && !Object.hasOwn(classes, partialCategory)) throw new Error("Unknown partial preparation category.");
const selected = partialCategory ? selection.selected.filter((row) => row.object === partialCategory) : selection.selected;
const samples = [];
const provenance = [];
for (const row of selected) {
  if (!/^(candle|pcb1)\/Data\/Images\/(Normal|Anomaly)\/\d+\.(JPG|jpg|png)$/.test(row.image)) {
    throw new Error("Unexpected source image path.");
  }
  if (!/^da-[a-f0-9]{12}$/.test(row.id)) throw new Error("Unexpected sample ID.");
  const original = await readFile(path.join(cache, "originals", ...row.image.split("/")));
  const originalMetadata = await sharp(original, { limitInputPixels: 30_000_000 }).metadata();
  if (originalMetadata.orientation && originalMetadata.orientation !== 1) {
    throw new Error("Review annotation alignment before accepting an EXIF-rotated source photograph.");
  }
  const { data: image, info } = await sharp(original, { limitInputPixels: 30_000_000 })
    .rotate()
    .resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb")
    .jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
    .toBuffer({ resolveWithObject: true });
  await writeFile(path.join(imageDirectory, `${row.id}.jpg`), image);
  let annotationSrc = null;
  let annotationProvenance = null;
  let defectLabels = [];
  if (row.mask) {
    if (!/^(candle|pcb1)\/Data\/Masks\/Anomaly\/\d+\.png$/.test(row.mask)) throw new Error("Unexpected source mask path.");
    const originalMask = await readFile(path.join(cache, "originals", ...row.mask.split("/")));
    const maskMetadata = await sharp(originalMask).metadata();
    if (maskMetadata.width !== originalMetadata.width || maskMetadata.height !== originalMetadata.height) {
      throw new Error("Annotation dimensions do not match the original photograph.");
    }
    const { data: rawMask, info: rawMaskInfo } = await sharp(originalMask).raw().toBuffer({ resolveWithObject: true });
    const classIds = new Set();
    for (let i = 0; i < rawMask.length; i += rawMaskInfo.channels) {
      if (rawMask[i] !== 0) classIds.add(rawMask[i]);
    }
    const sortedIds = [...classIds].sort((a, b) => a - b);
    if (!sortedIds.length || sortedIds.some((id) => !classes[row.object][id])) {
      throw new Error("Annotation contains unknown class IDs.");
    }
    defectLabels = sortedIds.map((id) => classes[row.object][id]);
    const rgba = Buffer.alloc(rawMaskInfo.width * rawMaskInfo.height * 4);
    for (let pixel = 0; pixel < rawMaskInfo.width * rawMaskInfo.height; pixel++) {
      if (rawMask[pixel * rawMaskInfo.channels] > 0) {
        rgba[pixel * 4] = 235;
        rgba[pixel * 4 + 1] = 97;
        rgba[pixel * 4 + 2] = 70;
        rgba[pixel * 4 + 3] = 160;
      }
    }
    const annotation = await sharp(rgba, { raw: { width: rawMaskInfo.width, height: rawMaskInfo.height, channels: 4 } })
      .resize(info.width, info.height, { kernel: "nearest" })
      .png()
      .toBuffer();
    await writeFile(path.join(annotationDirectory, `${row.id}.png`), annotation);
    annotationSrc = `/dataset/annotations/${row.id}.png`;
    annotationProvenance = { sourcePath: row.mask, originalSha256: hash(originalMask), processedSha256: hash(annotation), classIds: sortedIds };
  }
  samples.push({ id: row.id, category: row.object, split: row.demoSplit, imageSrc: `/dataset/images/${row.id}.jpg`, annotationSrc, truth: row.label, defectLabels, width: info.width, height: info.height, sourcePath: row.image, sha256: hash(image) });
  provenance.push({ sampleId: row.id, originalSha256: hash(original), processedSha256: hash(image), originalWidth: originalMetadata.width, originalHeight: originalMetadata.height, originalDatasetSplit: row.split, annotation: annotationProvenance });
}
if (samples.length !== (partialCategory ? 44 : 88) || new Set(provenance.map((item) => item.originalSha256)).size !== samples.length) {
  throw new Error("The selected dataset must have the expected number of distinct source photographs.");
}
const manifest = {
  version: selection.version,
  preparationStatus: partialCategory ? "partial" : "complete",
  selectionSeed: selection.seed,
  source: { repository: "https://github.com/amazon-science/spot-diff", commit: selection.sourceCommit, license: "CC-BY-4.0", attribution: "VisA by Yang Zou, Jongheon Jeong, Latha Pemula, Dongqing Zhang and Onkar Dabeer, Amazon Science (2022).", archive: selection.archive, metadata: selection.metadata },
  transformations: { image: "Auto-orient; resize inside 768 x 768 without enlargement; sRGB JPEG, quality 90, 4:4:4; strip metadata.", annotation: "Original nonzero class pixels recoloured coral with alpha 160; transparent background; nearest-neighbour resize to the processed photograph dimensions. Dataset ground truth, never an AI-generated heatmap." },
  samples,
  provenance,
};
await writeFile(path.join(repository, "src", "data", "dataset-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ samples: samples.length, annotations: samples.filter((sample) => sample.annotationSrc).length, manifestSha256: hash(Buffer.from(JSON.stringify(manifest, null, 2) + "\n")), imageBytes: (await Promise.all(samples.map((sample) => readFile(path.join(repository, "public", sample.imageSrc))))).reduce((sum, item) => sum + item.length, 0) }));
