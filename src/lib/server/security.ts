import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { VISITOR_COOKIE } from "./config";

export class PublicError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "PublicError";
  }
}

function signature(value: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new PublicError("Live inspections are not configured.", 503);
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function visitorFromRequest(request: Request, now = Date.now()): string | null {
  const cookie = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${VISITOR_COOKIE}=`))?.slice(VISITOR_COOKIE.length + 1);
  if (!cookie) return null;
  const [id, expires, provided, ...extra] = cookie.split(".");
  if (extra.length || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id ?? "") || !/^\d{13}$/.test(expires ?? "") || !/^[a-f0-9]{64}$/.test(provided ?? "") || Number(expires) <= now || Number(expires) > now + 86_400_000) return null;
  const expected = signature(`${id}.${expires}`);
  return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex")) ? id : null;
}

export function newVisitor(request: Request, now = Date.now()): { id: string; cookie: string } {
  const id = randomUUID();
  const value = `${id}.${now + 86_400_000}`;
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return { id, cookie: `${VISITOR_COOKIE}=${value}.${signature(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${secure}` };
}

export function assertOrigin(request: Request): void {
  if (!process.env.APP_ORIGIN || request.headers.get("origin") !== process.env.APP_ORIGIN) throw new PublicError("Request inspections from the Defect Atlas page.", 403);
}

export async function readBoundedJson(request: Request, limit = 8_192): Promise<unknown> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) throw new PublicError("This request must contain JSON.", 415);
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new PublicError("The request is too large.", 413);
  if (!request.body) throw new PublicError("The request is empty.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new PublicError("The request timed out.", 408)); }, 10_000); });
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) { void reader.cancel().catch(() => {}); throw new PublicError("The request is too large.", 413); }
      chunks.push(part.value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new PublicError("The request could not be read.", 400); }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
