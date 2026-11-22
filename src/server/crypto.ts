import { createCipheriv, createDecipheriv, randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDataDir } from "./config";

let key: Buffer | undefined;

/** A per-install key that seals OAuth tokens at rest and signs sessions. */
function secretKey(): Buffer {
  if (key) return key;
  const p = join(ensureDataDir(), "secret.key");
  if (!existsSync(p)) writeFileSync(p, randomBytes(32), { mode: 0o600 });
  key = readFileSync(p);
  return key;
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", secretKey(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}

export function unseal(sealed: string): string {
  const buf = Buffer.from(sealed, "base64");
  const d = createDecipheriv("aes-256-gcm", secretKey(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

export function sign(value: string): string {
  const mac = createHmac("sha256", secretKey()).update(value).digest("base64url");
  return `${value}.${mac}`;
}

export function verify(signed: string | undefined): string | null {
  if (!signed) return null;
  const i = signed.lastIndexOf(".");
  if (i < 0) return null;
  const value = signed.slice(0, i);
  const want = Buffer.from(sign(value).slice(i + 1));
  const got = Buffer.from(signed.slice(i + 1));
  return want.length === got.length && timingSafeEqual(want, got) ? value : null;
}

export const randomId = (n = 16) => randomBytes(n).toString("base64url");
