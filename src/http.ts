export class HttpError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function fail(status: number, message: string, code?: string): never {
  throw new HttpError(status, message, code);
}

export async function readJson(req: Request, limit = 1_000_000): Promise<Record<string, any>> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) fail(415, "Requests must be sent as application/json.");
  const text = await req.text();
  if (text.length > limit) fail(413, "Request body too large.");
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    if (v === null || typeof v !== "object" || Array.isArray(v)) fail(400, "Expected a JSON object.");
    return v as Record<string, any>;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return fail(400, "Invalid JSON.");
  }
}

// ---- tiny validators -------------------------------------------------------

export function str(v: unknown, field: string, max = 200, required = true): string {
  if (v === undefined || v === null || v === "") {
    if (required) fail(400, `${field} is required.`);
    return "";
  }
  if (typeof v !== "string") fail(400, `${field} must be text.`);
  const t = (v as string).trim();
  if (required && !t) fail(400, `${field} is required.`);
  if (t.length > max) fail(400, `${field} is too long (max ${max} characters).`);
  return t;
}

export function int(v: unknown, field: string, min = -Infinity, max = Infinity): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || Math.floor(n) !== n) fail(400, `${field} must be a whole number.`);
  if ((n as number) < min || (n as number) > max) fail(400, `${field} must be between ${min} and ${max}.`);
  return n as number;
}

export function num(v: unknown, field: string, min = -Infinity, max = Infinity): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) fail(400, `${field} must be a number.`);
  if ((n as number) < min || (n as number) > max) fail(400, `${field} must be between ${min} and ${max}.`);
  return n as number;
}

export function bool(v: unknown): boolean {
  return v === true || v === 1 || v === "true" || v === "1";
}
