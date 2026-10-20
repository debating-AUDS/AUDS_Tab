// Admin sign-in: one shared password (a Wrangler secret) -> signed, HttpOnly session cookie.

import type { Env } from "./env.ts";
import { fail } from "./http.ts";

const COOKIE = "auds_admin";
const SESSION_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();

function b64url(bytes: ArrayBuffer): string {
  let s = "";
  const a = new Uint8Array(bytes);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function checkPassword(env: Env, attempt: string): Promise<boolean> {
  if (!env.ADMIN_PASSWORD) return false;
  // Compare digests so the comparison time doesn't depend on the password's length.
  const a = await sha256Hex("pw:" + attempt);
  const b = await sha256Hex("pw:" + env.ADMIN_PASSWORD);
  return timingSafeEqual(a, b);
}

export async function makeSessionCookie(env: Env, secure: boolean): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = `admin.${exp}`;
  const sig = await hmac(env.SESSION_SECRET, payload);
  return `${COOKIE}=${payload}.${sig}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}

export async function isAdmin(env: Env, req: Request): Promise<boolean> {
  if (!env.SESSION_SECRET) return false;
  const header = req.headers.get("cookie") ?? "";
  const m = header.split(";").map((s) => s.trim()).find((s) => s.startsWith(COOKIE + "="));
  if (!m) return false;
  const token = m.slice(COOKIE.length + 1);
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "admin") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmac(env.SESSION_SECRET, `admin.${parts[1]}`);
  return timingSafeEqual(expected, parts[2]);
}

export async function requireAdmin(env: Env, req: Request): Promise<void> {
  if (!(await isAdmin(env, req))) fail(401, "Please sign in as an admin.", "unauthorised");
}

/** Anonymous, salted fingerprint for rate limiting (never stores the raw IP). */
export async function fingerprint(env: Env, req: Request): Promise<string> {
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  const ua = req.headers.get("user-agent") ?? "";
  return (await sha256Hex(`${env.SESSION_SECRET ?? ""}|${ip}|${ua}`)).slice(0, 32);
}
