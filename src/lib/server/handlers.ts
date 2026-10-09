import { randomUUID } from "node:crypto";
import { checkBotId } from "botid/server";
import type { InspectionRequest, InspectionResult } from "../contracts";
import { inspectRequestSchema } from "../validation";
import { hostedEnvironment, publicConfig } from "./config";
import { candidateImage } from "./images";
import { inspectImage } from "./provider";
import { assertOrigin, newVisitor, PublicError, readBoundedJson, visitorFromRequest } from "./security";
import { createInspectionStore, type InspectionStore } from "./store";

const noStore = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export interface InspectionDependencies {
  store: () => InspectionStore;
  prepareImage: (request: InspectionRequest) => Promise<string>;
  inspect: (request: InspectionRequest, normalizedImage: string) => Promise<InspectionResult>;
  verifyBrowser: () => Promise<boolean>;
}
const dependencies: InspectionDependencies = {
  store: createInspectionStore,
  prepareImage: candidateImage,
  inspect: inspectImage,
  async verifyBrowser() {
    const result = await checkBotId({ advancedOptions: { checkLevel: "basic" }, developmentOptions: { isDevelopment: false } });
    return result?.isBot === false && result.bypassed === false;
  },
};
function errorResponse(error: unknown): Response {
  const known = error instanceof PublicError;
  return Response.json({ error: known ? error.message : "Live inspection is temporarily unavailable. The saved benchmark remains available." }, { status: known ? error.status : 503, headers: noStore });
}
export function configResponse(request: Request): Response {
  try {
    const config = publicConfig();
    const cookie = config.liveEnabled && !visitorFromRequest(request) ? newVisitor(request).cookie : undefined;
    return Response.json(config, { headers: { ...noStore, ...(cookie ? { "Set-Cookie": cookie } : {}) } });
  } catch (error) { return errorResponse(error); }
}
export async function inspectionResponse(request: Request, services: InspectionDependencies = dependencies): Promise<Response> {
  try {
    assertOrigin(request);
    const parsed = inspectRequestSchema.safeParse(await readBoundedJson(request, 3_000_000));
    if (!parsed.success) throw new PublicError("Choose a supported image, category and policy, and confirm AI processing.", 400);
    if (!publicConfig().liveEnabled) throw new PublicError("Live inspection is temporarily unavailable. Explore the saved benchmark instead.", 503);
    const visitor = visitorFromRequest(request);
    if (!visitor) throw new PublicError("Refresh Defect Atlas before requesting an inspection.", 403);
    if (hostedEnvironment()) {
      let verified = false;
      try { verified = await services.verifyBrowser(); } catch { throw new PublicError("Browser verification is temporarily unavailable.", 503); }
      if (!verified) throw new PublicError("Browser verification failed. Refresh the page and try again.", 403);
    }
    const normalizedImage = await services.prepareImage(parsed.data);
    const store = services.store();
    const reservation = randomUUID();
    await store.reserve(visitor, reservation);
    const result = await services.inspect(parsed.data, normalizedImage);
    try { await store.release(visitor, reservation); } catch {}
    return Response.json({ result, revision: parsed.data.revision }, { headers: noStore });
  } catch (error) { return errorResponse(error); }
}
