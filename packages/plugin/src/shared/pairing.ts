import { z } from "zod";
import {
  nodeIdSchema,
  peerPolicySchema,
  peerTransportSchema,
  signatureSchema,
  timestampSchema,
} from "./contracts.ts";

export const PAIRING_BUNDLE_VERSION = 1 as const;
const PAIRING_PREFIX = "squad-peer-v1.";

export const unsignedPairingBundleSchema = z.strictObject({
  version: z.literal(PAIRING_BUNDLE_VERSION),
  nodeId: nodeIdSchema,
  displayName: z.string().trim().min(1).max(120),
  publicKey: z.string().min(1).max(10_000),
  relayUrl: z.string().url().max(2_048).optional(),
  directUrl: z.string().url().max(2_048).optional(),
  issuedAt: timestampSchema,
  expiresAt: timestampSchema,
});
export type UnsignedPairingBundle = z.infer<typeof unsignedPairingBundleSchema>;

export const pairingBundleSchema = unsignedPairingBundleSchema
  .extend({ signature: signatureSchema })
  .strict();
export type PairingBundle = z.infer<typeof pairingBundleSchema>;

export const importPairingBundleSchema = z.strictObject({
  bundle: z
    .string()
    .trim()
    .min(32)
    .max(32 * 1024),
  transport: peerTransportSchema.optional(),
  directUrl: z.string().trim().min(1).max(2_048).optional(),
  policy: peerPolicySchema.partial().optional(),
});
export type ImportPairingBundle = z.infer<typeof importPairingBundleSchema>;

export const updatePeerConnectionSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  transport: peerTransportSchema.optional(),
  directUrl: z
    .union([z.string().trim().min(1).max(2_048), z.null()])
    .optional(),
});
export type UpdatePeerConnection = z.infer<typeof updatePeerConnectionSchema>;

export function unsignedPairingBundle(
  bundle: PairingBundle,
): UnsignedPairingBundle {
  const { signature: _signature, ...unsigned } = bundle;
  return unsigned;
}

export function encodePairingBundle(bundle: PairingBundle): string {
  const parsed = pairingBundleSchema.parse(bundle);
  return `${PAIRING_PREFIX}${Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url")}`;
}

export function decodePairingBundle(value: string): PairingBundle {
  const text = value.trim();
  if (!text.startsWith(PAIRING_PREFIX) || text.length > 32 * 1024) {
    throw new Error("invalid Squad pairing bundle");
  }
  try {
    return pairingBundleSchema.parse(
      JSON.parse(
        Buffer.from(text.slice(PAIRING_PREFIX.length), "base64url").toString(
          "utf8",
        ),
      ) as unknown,
    );
  } catch (error) {
    throw new Error("invalid Squad pairing bundle", { cause: error });
  }
}
