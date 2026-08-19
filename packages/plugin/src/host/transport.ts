import {
  nodeReceiptSchema,
  type Envelope,
  type NodeReceipt,
  type PeerTransport,
} from "../shared/contracts.ts";
import type { DeliveryStatus } from "./database.ts";
import { type NodeIdentity, verifySignature } from "./identity.ts";
import type { RelayClient } from "./relay-client.ts";

export interface TransportPeer {
  nodeId: string;
  publicKey: string;
  transport: PeerTransport;
  directUrl?: string;
}

type SuccessfulDeliveryStatus = Extract<
  DeliveryStatus,
  "STORED_BY_RELAY" | "RECEIVED_BY_NODE"
>;

export interface EnvelopeTransport {
  readonly kind: PeerTransport;
  submit(envelope: Envelope): Promise<SuccessfulDeliveryStatus>;
}

export class RelayEnvelopeTransport implements EnvelopeTransport {
  readonly kind = "RELAY" as const;

  constructor(private readonly client: RelayClient) {}

  async submit(envelope: Envelope): Promise<SuccessfulDeliveryStatus> {
    await this.client.submit(envelope);
    return "STORED_BY_RELAY";
  }
}

export class DirectTransportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new DirectTransportError(
      "DIRECT_INVALID_RESPONSE",
      `Direct peer returned invalid JSON (${response.status})`,
    );
  }
}

export class DirectEnvelopeTransport implements EnvelopeTransport {
  readonly kind = "DIRECT" as const;

  constructor(
    private readonly identity: NodeIdentity,
    private readonly resolvePeer: (nodeId: string) => TransportPeer | undefined,
  ) {}

  async submit(envelope: Envelope): Promise<SuccessfulDeliveryStatus> {
    const peer = this.resolvePeer(envelope.recipientNodeId);
    if (
      peer === undefined ||
      peer.transport !== "DIRECT" ||
      peer.directUrl === undefined
    ) {
      throw new DirectTransportError(
        "DIRECT_PEER_NOT_CONFIGURED",
        `Direct endpoint is not configured for ${envelope.recipientNodeId}`,
      );
    }
    let response: Response;
    try {
      response = await fetch(`${peer.directUrl}/squad/v1/direct/envelopes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new DirectTransportError(
        "DIRECT_PEER_UNREACHABLE",
        error instanceof Error ? error.message : "Direct peer is unreachable",
      );
    }
    const body = await responseBody(response);
    if (!response.ok) {
      const candidate = body as {
        error?: { code?: unknown; message?: unknown };
      };
      throw new DirectTransportError(
        typeof candidate.error?.code === "string"
          ? candidate.error.code
          : `DIRECT_HTTP_${response.status}`,
        typeof candidate.error?.message === "string"
          ? candidate.error.message
          : `Direct peer rejected the envelope (${response.status})`,
      );
    }
    const parsedReceipt = nodeReceiptSchema.safeParse(body);
    if (!parsedReceipt.success) {
      throw new DirectTransportError(
        "DIRECT_INVALID_RECEIPT",
        "Direct peer returned a malformed node receipt",
      );
    }
    const receipt = parsedReceipt.data as NodeReceipt;
    const { signature, ...unsigned } = receipt;
    if (
      receipt.envelopeId !== envelope.envelopeId ||
      receipt.senderNodeId !== envelope.recipientNodeId ||
      receipt.recipientNodeId !== this.identity.nodeId ||
      !verifySignature(unsigned, signature, peer.publicKey)
    ) {
      throw new DirectTransportError(
        "DIRECT_INVALID_RECEIPT",
        "Direct peer returned an invalid node receipt",
      );
    }
    return "RECEIVED_BY_NODE";
  }
}
