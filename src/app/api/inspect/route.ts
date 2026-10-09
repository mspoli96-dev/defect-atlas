import { inspectionResponse } from "../../../lib/server/handlers";

export const runtime = "nodejs";
export const maxDuration = 40;

export function POST(request: Request): Promise<Response> { return inspectionResponse(request); }
