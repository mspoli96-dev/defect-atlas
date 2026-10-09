import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import sharp from "sharp";
import { getSample, getReferences } from "../dataset";
import type { CategoryId, InspectionRequest } from "../contracts";
import { MAX_IMAGE_BYTES } from "./config";
import { PublicError } from "./security";

export async function normalizeImage(bytes: Buffer): Promise<string> {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new PublicError("Choose a JPEG, PNG or WebP image no larger than 2 MB.", 413);
  try {
    const instance = sharp(bytes, { limitInputPixels: 24_000_000, animated: false, failOn: "error" });
    const metadata = await instance.metadata();
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format) || (metadata.pages ?? 1) > 1 || !metadata.width || !metadata.height || metadata.width < 32 || metadata.height < 32) throw new Error("Unsupported image.");
    const buffer = await instance.rotate().resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer();
    return `data:image/jpeg;base64,${buffer.toString("base64")}`;
  } catch {
    throw new PublicError("This image could not be inspected. Use a still JPEG, PNG or WebP with at most 24 million pixels.", 400);
  }
}

export async function readDatasetImage(imageSrc: string): Promise<string> {
  if (!/^\/dataset\/[a-zA-Z0-9/_-]+\.(?:jpg|jpeg|png|webp)$/.test(imageSrc)) throw new PublicError("The selected sample is unavailable.", 400);
  const base = resolve(process.cwd(), "public", "dataset");
  const target = resolve(process.cwd(), "public", `.${imageSrc}`);
  if (!target.startsWith(base + sep)) throw new PublicError("The selected sample is unavailable.", 400);
  return normalizeImage(await readFile(target));
}

export async function candidateImage(request: InspectionRequest): Promise<string> {
  if (request.sampleId) {
    const sample = getSample(request.sampleId);
    if (!sample || sample.category !== request.category || sample.split === "reference") throw new PublicError("Choose a supported inspection sample for this category.", 400);
    return readDatasetImage(sample.imageSrc);
  }
  const match = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(request.imageDataUrl ?? "");
  if (!match || match[1].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || match[1].length % 4 !== 0) throw new PublicError("Choose a supported image no larger than 2 MB.", 400);
  const buffer = Buffer.from(match[1], "base64");
  if (buffer.toString("base64") !== match[1]) throw new PublicError("The image encoding is invalid.", 400);
  return normalizeImage(buffer);
}

export async function referenceImages(category: CategoryId): Promise<string[]> {
  const samples = getReferences(category).slice(0, 2);
  if (samples.length !== 2) throw new PublicError("Reference images are temporarily unavailable.", 503);
  return Promise.all(samples.map(sample => readDatasetImage(sample.imageSrc)));
}
