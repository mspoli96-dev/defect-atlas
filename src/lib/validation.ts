import { z } from "zod";
import type { InspectionRequest, Thresholds } from "./contracts";

export const MAX_IMAGE_DATA_URL_CHARACTERS = 2_800_000;

export const categorySchema = z.enum(["candle", "pcb1"]);
export const policyIdSchema = z.enum(["appearance-v1", "reference-v2"]);

export const thresholdsSchema = z.strictObject({
  clearMax: z.number().min(0).max(1),
  flagMin: z.number().min(0).max(1),
  usabilityMin: z.number().min(0).max(1),
  categoryConfidenceMin: z.number().min(0).max(1),
}).refine((value) => value.clearMax < value.flagMin, {
  message: "The clear threshold must be lower than the flag threshold.",
  path: ["flagMin"],
});

export function validateThresholds(value: Thresholds): Thresholds {
  return thresholdsSchema.parse(value);
}

const imageDataUrlSchema = z.string()
  .max(MAX_IMAGE_DATA_URL_CHARACTERS)
  .regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/, "Use a base64 JPEG, PNG or WebP image.");

const requestFields = {
  category: categorySchema,
  policyId: policyIdSchema,
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  consent: z.literal(true),
};

export const inspectRequestSchema: z.ZodType<InspectionRequest> = z.union([
  z.strictObject({
    ...requestFields,
    sampleId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  }),
  z.strictObject({
    ...requestFields,
    imageDataUrl: imageDataUrlSchema,
  }),
]);
