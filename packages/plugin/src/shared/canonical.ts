import { createHash } from "node:crypto";
import type { Envelope, UnsignedEnvelope } from "./contracts.ts";

function encode(value: unknown, at: string): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${at} contains a non-finite number`);
    }
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => encode(item, `${at}[${index}]`)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => {
        const item = record[key];
        if (item === undefined) {
          throw new TypeError(`${at}.${key} is undefined`);
        }
        return `${JSON.stringify(key)}:${encode(item, `${at}.${key}`)}`;
      })
      .join(",")}}`;
  }
  throw new TypeError(`${at} contains unsupported ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return encode(value, "$");
}

export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalJson(value), "utf8");
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function unsignedEnvelope(envelope: Envelope): UnsignedEnvelope {
  const { signature: _signature, ...unsigned } = envelope;
  return unsigned as UnsignedEnvelope;
}

export function envelopeDigest(envelope: Envelope): string {
  return sha256Hex(canonicalBytes(envelope));
}
