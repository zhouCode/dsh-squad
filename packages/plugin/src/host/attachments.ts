import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { join } from "node:path";
import {
  MAX_ATTACHMENT_BYTES,
  attachmentRefSchema,
  type AttachmentRef,
} from "../shared/contracts.ts";

export interface VerifiedAttachment {
  ref: AttachmentRef;
  localPath: string;
}

function publicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value)))
    return false;
  const [a = 0, b = 0] = octets;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

export function isPublicAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/gu, "");
  const family = isIP(normalized);
  if (family === 4) return publicIpv4(normalized);
  if (family !== 6) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(normalized)?.[1];
  if (mapped !== undefined) return publicIpv4(mapped);
  return !(
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

async function resolvePublic(
  url: URL,
): Promise<{ address: string; family: 4 | 6 }> {
  const hostname = url.hostname.replace(/^\[|\]$/gu, "");
  if (
    hostname.toLowerCase() === "localhost" ||
    hostname.toLowerCase().endsWith(".localhost")
  ) {
    throw new Error("attachment host is local");
  }
  if (isIP(hostname) !== 0) {
    if (!isPublicAddress(hostname))
      throw new Error("attachment address is not public");
    return { address: hostname, family: isIP(hostname) as 4 | 6 };
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some((entry) => !isPublicAddress(entry.address))
  ) {
    throw new Error(
      "attachment DNS result is empty or includes a non-public address",
    );
  }
  const selected = addresses[0];
  if (
    selected === undefined ||
    (selected.family !== 4 && selected.family !== 6)
  ) {
    throw new Error("attachment DNS result is unsupported");
  }
  return { address: selected.address, family: selected.family };
}

async function download(
  input: URL,
  expectedSize: number,
  redirects = 0,
): Promise<Buffer> {
  if (input.protocol !== "https:")
    throw new Error("attachment URL must use HTTPS");
  if (input.username || input.password)
    throw new Error("attachment URL must not contain credentials");
  const target = await resolvePublic(input);
  return new Promise<Buffer>((resolve, reject) => {
    const req = request(
      {
        protocol: "https:",
        hostname: target.address,
        family: target.family,
        port: input.port ? Number(input.port) : 443,
        path: `${input.pathname}${input.search}`,
        method: "GET",
        servername: input.hostname.replace(/^\[|\]$/gu, ""),
        headers: {
          host: input.host,
          accept: "application/octet-stream, text/plain;q=0.9, */*;q=0.1",
          "user-agent": "dsh-squad/0.2 attachment-verifier",
        },
        rejectUnauthorized: true,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (
          status >= 300 &&
          status < 400 &&
          response.headers.location !== undefined
        ) {
          response.resume();
          if (redirects >= 3) {
            reject(new Error("attachment redirect limit exceeded"));
            return;
          }
          void download(
            new URL(response.headers.location, input),
            expectedSize,
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(new Error(`attachment server returned HTTP ${status}`));
          return;
        }
        const declared = response.headers["content-length"];
        if (declared !== undefined && Number(declared) !== expectedSize) {
          response.destroy();
          reject(
            new Error(
              "attachment Content-Length does not match its signed reference",
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        response.on("data", (value: Buffer | string) => {
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
          received += chunk.byteLength;
          if (received > expectedSize || received > MAX_ATTACHMENT_BYTES) {
            response.destroy(
              new Error("attachment exceeded its declared size"),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          if (received !== expectedSize) {
            reject(
              new Error(
                "attachment byte size does not match its signed reference",
              ),
            );
            return;
          }
          resolve(Buffer.concat(chunks));
        });
      },
    );
    req.setTimeout(15_000, () =>
      req.destroy(new Error("attachment download timed out")),
    );
    req.on("error", reject);
    req.end();
  });
}

function digest(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export class AttachmentVerifier {
  constructor(private readonly cacheDir: string) {}

  pathFor(ref: AttachmentRef): string {
    return join(this.cacheDir, `${ref.sha256}.bin`);
  }

  private async cached(ref: AttachmentRef): Promise<boolean> {
    const path = this.pathFor(ref);
    try {
      if ((await stat(path)).size !== ref.size) return false;
      return digest(await readFile(path)) === ref.sha256;
    } catch {
      return false;
    }
  }

  async verify(candidate: AttachmentRef): Promise<VerifiedAttachment> {
    const ref = attachmentRefSchema.parse(candidate);
    await mkdir(this.cacheDir, { recursive: true, mode: 0o700 });
    const localPath = this.pathFor(ref);
    if (!(await this.cached(ref))) {
      const value = await download(new URL(ref.url), ref.size);
      if (digest(value) !== ref.sha256) {
        throw new Error(`attachment ${ref.name} failed SHA-256 verification`);
      }
      const temporary = join(
        this.cacheDir,
        `.${ref.sha256}-${randomUUID()}.tmp`,
      );
      await writeFile(temporary, value, { flag: "wx", mode: 0o600 });
      await rename(temporary, localPath);
      await chmod(localPath, 0o600);
    }
    return { ref, localPath };
  }

  async verifyAll(refs: AttachmentRef[]): Promise<VerifiedAttachment[]> {
    const unique = new Map(refs.map((ref) => [ref.sha256, ref]));
    return Promise.all([...unique.values()].map((ref) => this.verify(ref)));
  }
}
