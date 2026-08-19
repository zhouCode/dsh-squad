import { z } from "zod";
import {
  idSchema,
  nodeIdSchema,
  signatureSchema,
  timestampSchema,
} from "./contracts.ts";

export const JOIN_PACKAGE_VERSION = 1 as const;
const JOIN_PACKAGE_PREFIX = "squad-join-v1.";

export const unsignedJoinPackageSchema = z.strictObject({
  version: z.literal(JOIN_PACKAGE_VERSION),
  relayUrl: z.string().url().max(2_048),
  organizationId: idSchema,
  organizationName: z.string().trim().min(1).max(120),
  enrollmentInvitation: z.string().min(16).max(512),
  organizationInvitation: z.string().min(48).max(512),
  issuer: z.strictObject({
    nodeId: nodeIdSchema,
    displayName: z.string().trim().min(1).max(120),
    publicKey: z.string().min(1).max(10_000),
  }),
  issuedAt: timestampSchema,
  expiresAt: timestampSchema,
});
export type UnsignedJoinPackage = z.infer<typeof unsignedJoinPackageSchema>;

export const joinPackageSchema = unsignedJoinPackageSchema
  .extend({ signature: signatureSchema })
  .strict();
export type JoinPackage = z.infer<typeof joinPackageSchema>;

export const importJoinPackageSchema = z.strictObject({
  bundle: z
    .string()
    .trim()
    .min(32)
    .max(32 * 1024),
  displayName: z.string().trim().min(1).max(120).optional(),
});
export type ImportJoinPackage = z.infer<typeof importJoinPackageSchema>;

export function unsignedJoinPackage(bundle: JoinPackage): UnsignedJoinPackage {
  const { signature: _signature, ...unsigned } = bundle;
  return unsigned;
}

export function encodeJoinPackage(bundle: JoinPackage): string {
  const parsed = joinPackageSchema.parse(bundle);
  return `${JOIN_PACKAGE_PREFIX}${Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url")}`;
}

export function decodeJoinPackage(value: string): JoinPackage {
  const text = value.trim();
  if (!text.startsWith(JOIN_PACKAGE_PREFIX) || text.length > 32 * 1024) {
    throw new Error("invalid Squad join package");
  }
  try {
    return joinPackageSchema.parse(
      JSON.parse(
        Buffer.from(
          text.slice(JOIN_PACKAGE_PREFIX.length),
          "base64url",
        ).toString("utf8"),
      ) as unknown,
    );
  } catch (error) {
    throw new Error("invalid Squad join package", { cause: error });
  }
}
