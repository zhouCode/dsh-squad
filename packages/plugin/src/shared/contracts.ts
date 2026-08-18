import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;
export const ORGANIZATION_PROTOCOL_VERSION = 2 as const;
export const MAX_ENVELOPE_BYTES = 256 * 1024;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export const idSchema = z.string().uuid();
export const nodeIdSchema = z
  .string()
  .regex(/^node_[A-Za-z0-9_-]{43}$/, "invalid node fingerprint");
export const timestampSchema = z.string().datetime({ offset: true });
export const signatureSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{86}$/, "invalid Ed25519 signature");

export const attachmentRefSchema = z.strictObject({
  url: z
    .string()
    .url()
    .refine((value) => value.startsWith("https://"), {
      message: "attachment URL must use HTTPS",
    }),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().nonnegative().max(MAX_ATTACHMENT_BYTES),
  name: z.string().trim().min(1).max(240),
});
export type AttachmentRef = z.infer<typeof attachmentRefSchema>;

export const delegationRequestSchema = z.strictObject({
  delegationId: idSchema,
  parentDelegationId: idSchema.optional(),
  objective: z.string().trim().min(1).max(20_000),
  context: z.string().max(100_000).optional(),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(2_000)).max(20),
  attachmentRefs: z.array(attachmentRefSchema).max(10),
  delegationDepth: z.number().int().nonnegative().max(32).default(0),
});
export type DelegationRequest = z.infer<typeof delegationRequestSchema>;

export const delegationUpdateSchema = z.strictObject({
  delegationId: idSchema,
  status: z.enum(["QUEUED", "RUNNING", "WAITING_HUMAN"]),
  shareableSummary: z.string().max(10_000).optional(),
  revision: z.number().int().positive(),
  updatedAt: timestampSchema,
});
export type DelegationUpdate = z.infer<typeof delegationUpdateSchema>;

export const resultOutputSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("text"),
    content: z.string().max(100_000),
  }),
  z.strictObject({
    type: z.literal("link"),
    name: z.string().trim().min(1).max(240),
    url: z
      .string()
      .url()
      .refine((value) => value.startsWith("https://"), {
        message: "result link must use HTTPS",
      }),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
]);
export type ResultOutput = z.infer<typeof resultOutputSchema>;

export const delegationResultSchema = z.strictObject({
  delegationId: idSchema,
  status: z.enum(["COMPLETED", "REJECTED", "FAILED", "CANCELED"]),
  summary: z.string().max(20_000),
  outputs: z.array(resultOutputSchema).max(20),
  errorCode: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{0,63}$/)
    .optional(),
  revision: z.number().int().positive(),
  completedAt: timestampSchema,
});
export type DelegationResult = z.infer<typeof delegationResultSchema>;

export const messagePayloadSchema = z.strictObject({
  messageId: idSchema,
  text: z.string().trim().min(1).max(20_000),
});

export const delegationCancelRequestSchema = z.strictObject({
  delegationId: idSchema,
  reason: z.string().max(2_000).optional(),
  requestedAt: timestampSchema,
});

const envelopeHeader = {
  protocolVersion: z.union([
    z.literal(PROTOCOL_VERSION),
    z.literal(ORGANIZATION_PROTOCOL_VERSION),
  ]),
  envelopeId: idSchema,
  senderNodeId: nodeIdSchema,
  recipientNodeId: nodeIdSchema,
  correlationId: idSchema,
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
  organizationId: idSchema.optional(),
  senderMembershipId: idSchema.optional(),
  recipientMembershipId: idSchema.optional(),
  signature: signatureSchema,
};

export const envelopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...envelopeHeader,
    kind: z.literal("MESSAGE"),
    payload: messagePayloadSchema,
  }),
  z.strictObject({
    ...envelopeHeader,
    kind: z.literal("DELEGATION_REQUEST"),
    payload: delegationRequestSchema,
  }),
  z.strictObject({
    ...envelopeHeader,
    kind: z.literal("DELEGATION_UPDATE"),
    payload: delegationUpdateSchema,
  }),
  z.strictObject({
    ...envelopeHeader,
    kind: z.literal("DELEGATION_RESULT"),
    payload: delegationResultSchema,
  }),
  z.strictObject({
    ...envelopeHeader,
    kind: z.literal("DELEGATION_CANCEL_REQUEST"),
    payload: delegationCancelRequestSchema,
  }),
]);
export type Envelope = z.infer<typeof envelopeSchema>;
export type EnvelopeKind = Envelope["kind"];
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
export type UnsignedEnvelope = DistributiveOmit<Envelope, "signature">;

export const peerPolicySchema = z.strictObject({
  canMessage: z.boolean().default(false),
  canDelegate: z.boolean().default(false),
  autoExecute: z.enum(["NEVER", "SAFE", "TRUSTED"]).default("NEVER"),
  maxConcurrent: z.number().int().min(1).max(32).default(1),
  maxDelegationDepth: z.number().int().min(0).max(16).default(1),
  maxRuntimeMinutes: z.number().int().min(1).max(1_440).default(30),
  maxTokens: z.number().int().min(256).max(1_000_000).optional(),
});
export type PeerPolicy = z.infer<typeof peerPolicySchema>;

export const humanTodoSchema = z.strictObject({
  id: idSchema,
  delegationId: idSchema,
  title: z.string().trim().min(1).max(240),
  instructions: z.string().max(20_000).optional(),
  blockingReason: z.string().trim().min(1).max(2_000),
  status: z.enum(["OPEN", "DONE", "DISMISSED"]),
  humanResponse: z.string().max(50_000).optional(),
  attachmentRefs: z.array(attachmentRefSchema).max(10).default([]),
  createdAt: timestampSchema,
  resolvedAt: timestampSchema.optional(),
});
export type HumanTodo = z.infer<typeof humanTodoSchema>;

export const humanInputSchema = z
  .strictObject({
    todoIds: z.array(idSchema).min(1).max(20),
    response: z.string().max(50_000).optional(),
    attachmentRefs: z.array(attachmentRefSchema).max(10).default([]),
  })
  .superRefine((value, context) => {
    if (
      (value.response?.trim().length ?? 0) === 0 &&
      value.attachmentRefs.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "human input requires a response or an attachment reference",
      });
    }
    if (new Set(value.todoIds).size !== value.todoIds.length) {
      context.addIssue({ code: "custom", message: "todoIds must be unique" });
    }
  });
export type HumanInput = z.infer<typeof humanInputSchema>;

export const createDelegationInputSchema = z.strictObject({
  to: z.string().trim().min(1).max(128),
  objective: delegationRequestSchema.shape.objective,
  context: delegationRequestSchema.shape.context,
  acceptanceCriteria:
    delegationRequestSchema.shape.acceptanceCriteria.optional(),
  parentDelegationId: idSchema.optional(),
  attachmentRefs: delegationRequestSchema.shape.attachmentRefs.optional(),
});
export type CreateDelegationInput = z.infer<typeof createDelegationInputSchema>;

export const teamPlanStatusSchema = z.enum([
  "DRAFT",
  "DISPATCHING",
  "DISPATCHED",
  "PARTIAL",
  "CANCELED",
]);
export type TeamPlanStatus = z.infer<typeof teamPlanStatusSchema>;

export const teamPlanItemStatusSchema = z.enum([
  "DRAFT",
  "DISPATCHED",
  "FAILED",
  "CANCELED",
]);
export type TeamPlanItemStatus = z.infer<typeof teamPlanItemStatusSchema>;

export const teamPlanItemInputSchema = z.strictObject({
  to: createDelegationInputSchema.shape.to,
  objective: createDelegationInputSchema.shape.objective,
  context: createDelegationInputSchema.shape.context,
  acceptanceCriteria: createDelegationInputSchema.shape.acceptanceCriteria,
  attachmentRefs: createDelegationInputSchema.shape.attachmentRefs,
});
export type TeamPlanItemInput = z.infer<typeof teamPlanItemInputSchema>;

export const createTeamPlanInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(240),
  sourceSummary: z.string().max(50_000).optional(),
  items: z.array(teamPlanItemInputSchema).min(1).max(32),
});
export type CreateTeamPlanInput = z.infer<typeof createTeamPlanInputSchema>;

export interface TeamPlanItem {
  id: string;
  planId: string;
  position: number;
  peerNodeId: string;
  peerDisplayName: string;
  membershipId?: string;
  objective: string;
  context?: string;
  acceptanceCriteria: string[];
  attachmentRefs: AttachmentRef[];
  status: TeamPlanItemStatus;
  delegationId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamPlan {
  id: string;
  organizationId?: string;
  title: string;
  sourceSummary?: string;
  status: TeamPlanStatus;
  revision: number;
  approvedAt?: string;
  canceledAt?: string;
  createdAt: string;
  updatedAt: string;
  items: TeamPlanItem[];
}

export const structuredOutcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("COMPLETE"),
    summary: z.string().trim().min(1).max(20_000),
    outputs: z.array(resultOutputSchema).max(20).default([]),
  }),
  z.strictObject({
    kind: z.literal("HANDOFF"),
    completedSummary: z.string().max(20_000),
    todos: z
      .array(
        z.strictObject({
          title: z.string().trim().min(1).max(240),
          instructions: z.string().max(20_000).optional(),
          blockingReason: z.string().trim().min(1).max(2_000),
        }),
      )
      .min(1)
      .max(20),
  }),
  z.strictObject({
    kind: z.literal("UNSUPPORTED"),
    reason: z.string().trim().min(1).max(20_000),
  }),
]);
export type StructuredOutcome = z.infer<typeof structuredOutcomeSchema>;

export function envelopeDelegationId(envelope: Envelope): string | undefined {
  if (envelope.kind === "MESSAGE") return undefined;
  return envelope.payload.delegationId;
}

export function assertEnvelopeSemantics(
  envelope: Envelope,
  now = Date.now(),
): void {
  const createdAt = Date.parse(envelope.createdAt);
  const expiresAt = Date.parse(envelope.expiresAt);
  if (createdAt > now + 5 * 60_000) {
    throw new Error("envelope creation time is too far in the future");
  }
  if (expiresAt <= createdAt) {
    throw new Error("envelope expiry must be later than creation time");
  }
  const organizationFields = [
    envelope.organizationId,
    envelope.senderMembershipId,
    envelope.recipientMembershipId,
  ];
  if (envelope.protocolVersion === ORGANIZATION_PROTOCOL_VERSION) {
    if (organizationFields.some((value) => value === undefined)) {
      throw new Error(
        "organization envelopes require organization and membership routing",
      );
    }
  } else if (organizationFields.some((value) => value !== undefined)) {
    throw new Error("direct peer envelopes cannot carry organization routing");
  }
  const delegationId = envelopeDelegationId(envelope);
  if (delegationId !== undefined && delegationId !== envelope.correlationId) {
    throw new Error("envelope correlationId does not match delegationId");
  }
  if (
    envelope.kind === "MESSAGE" &&
    envelope.payload.messageId !== envelope.correlationId
  ) {
    throw new Error("message correlationId does not match messageId");
  }
}

export function envelopePayloadBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
