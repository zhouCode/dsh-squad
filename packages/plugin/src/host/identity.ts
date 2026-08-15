import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { canonicalBytes } from "../shared/canonical.ts";
import {
  nodeIdSchema,
  signatureSchema,
  type Envelope,
  type UnsignedEnvelope,
} from "../shared/contracts.ts";

const identityFileSchema = z.strictObject({
  version: z.literal(1),
  nodeId: nodeIdSchema,
  publicKey: z.string().min(1),
  privateKey: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
});

export type IdentityFile = z.infer<typeof identityFileSchema>;

export function nodeIdFromPublicKey(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({
    type: "spki",
    format: "der",
  });
  return `node_${createHash("sha256").update(der).digest("base64url")}`;
}

function validateIdentity(identity: IdentityFile): void {
  if (nodeIdFromPublicKey(identity.publicKey) !== identity.nodeId) {
    throw new Error(
      "Squad identity public key fingerprint does not match nodeId",
    );
  }
  const probe = Buffer.from("dsh-squad-identity-probe", "utf8");
  const signature = cryptoSign(
    null,
    probe,
    createPrivateKey(identity.privateKey),
  );
  if (
    !cryptoVerify(null, probe, createPublicKey(identity.publicKey), signature)
  ) {
    throw new Error("Squad identity key pair does not match");
  }
}

function createIdentity(path: string): IdentityFile {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const privateKeyPem = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  const identity = identityFileSchema.parse({
    version: 1,
    nodeId: nodeIdFromPublicKey(publicKeyPem),
    publicKey: publicKeyPem,
    privateKey: privateKeyPem,
    createdAt: new Date().toISOString(),
  });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(identity, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
  return identity;
}

export class NodeIdentity {
  readonly nodeId: string;
  readonly publicKey: string;
  readonly createdAt: string;
  readonly #privateKey: string;

  private constructor(identity: IdentityFile) {
    this.nodeId = identity.nodeId;
    this.publicKey = identity.publicKey;
    this.createdAt = identity.createdAt;
    this.#privateKey = identity.privateKey;
  }

  static load(path: string, expectedNodeId?: string): NodeIdentity {
    let identity: IdentityFile;
    if (!existsSync(path)) {
      if (expectedNodeId !== undefined) {
        throw new Error(
          `Squad identity is missing at ${path}; refusing to silently replace ${expectedNodeId}`,
        );
      }
      identity = createIdentity(path);
    } else {
      const mode = statSync(path).mode & 0o777;
      if ((mode & 0o077) !== 0) {
        throw new Error(
          `Squad identity permissions must be 0600, found ${mode.toString(8)}`,
        );
      }
      identity = identityFileSchema.parse(
        JSON.parse(readFileSync(path, "utf8")) as unknown,
      );
    }
    validateIdentity(identity);
    if (expectedNodeId !== undefined && expectedNodeId !== identity.nodeId) {
      throw new Error(
        `Squad identity mismatch: database expects ${expectedNodeId}, file contains ${identity.nodeId}`,
      );
    }
    return new NodeIdentity(identity);
  }

  sign(value: unknown): string {
    return cryptoSign(
      null,
      canonicalBytes(value),
      createPrivateKey(this.#privateKey),
    ).toString("base64url");
  }

  signEnvelope<T extends UnsignedEnvelope>(
    unsigned: T,
  ): T & { signature: string } {
    return {
      ...unsigned,
      signature: this.sign(unsigned),
    };
  }
}

export function verifySignature(
  value: unknown,
  signature: string,
  publicKey: string,
): boolean {
  const parsed = signatureSchema.safeParse(signature);
  if (!parsed.success) return false;
  try {
    return cryptoVerify(
      null,
      canonicalBytes(value),
      createPublicKey(publicKey),
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}
