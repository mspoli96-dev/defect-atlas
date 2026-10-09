import { configResponse } from "../../../lib/server/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Response { return configResponse(request); }
