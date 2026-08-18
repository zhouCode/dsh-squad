import { envelopeSchema, type Envelope } from "../shared/contracts.ts";
import {
  organizationDirectoryBundleSchema,
  type OrganizationDirectoryBundle,
  type OrganizationDocument,
  type OrganizationJoinRequest,
  type OrganizationMembershipCertificate,
} from "../shared/organizations.ts";
import type { NodeIdentity } from "./identity.ts";
import { signedRequest } from "./relay.ts";

export class RelayClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  let body: unknown;
  try {
    body = (await response.json()) as unknown;
  } catch {
    throw new RelayClientError(
      response.status,
      "INVALID_RESPONSE",
      "Relay returned invalid JSON",
    );
  }
  if (!response.ok) {
    const error = body as { error?: { code?: unknown; message?: unknown } };
    throw new RelayClientError(
      response.status,
      typeof error.error?.code === "string" ? error.error.code : "RELAY_ERROR",
      typeof error.error?.message === "string"
        ? error.error.message
        : "Relay request failed",
    );
  }
  return body;
}

export class RelayClient {
  constructor(
    readonly baseUrl: string,
    private readonly identity: NodeIdentity,
  ) {}

  private async request(
    method: string,
    path: string,
    value?: unknown,
  ): Promise<unknown> {
    const signed = signedRequest(this.identity, method, path, value);
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: signed.headers,
      ...(signed.body.byteLength === 0
        ? {}
        : { body: signed.body.toString("utf8") }),
      signal: AbortSignal.timeout(10_000),
    });
    return parseResponse(response);
  }

  async enroll(invitation: string, displayName: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/squad/v1/enrollment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        invitation,
        nodeId: this.identity.nodeId,
        displayName,
        publicKey: this.identity.publicKey,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    await parseResponse(response);
  }

  async submit(envelope: Envelope): Promise<void> {
    await this.request("POST", "/squad/v1/envelopes", envelope);
  }

  async mailbox(
    after: number,
    limit = 100,
  ): Promise<{
    cursor: number;
    items: Array<{ cursor: number; envelope: Envelope }>;
  }> {
    const path = `/squad/v1/mailbox?after=${after}&limit=${limit}`;
    const body = (await this.request("GET", path)) as {
      cursor?: unknown;
      items?: unknown;
    };
    if (!Number.isSafeInteger(body.cursor) || !Array.isArray(body.items)) {
      throw new RelayClientError(
        502,
        "INVALID_RESPONSE",
        "Relay mailbox response is invalid",
      );
    }
    return {
      cursor: body.cursor as number,
      items: body.items.map((item) => {
        const candidate = item as { cursor?: unknown; envelope?: unknown };
        if (!Number.isSafeInteger(candidate.cursor)) {
          throw new RelayClientError(
            502,
            "INVALID_RESPONSE",
            "Relay cursor is invalid",
          );
        }
        return {
          cursor: candidate.cursor as number,
          envelope: envelopeSchema.parse(candidate.envelope),
        };
      }),
    };
  }

  async acknowledge(envelopeId: string): Promise<void> {
    await this.request("POST", `/squad/v1/envelopes/${envelopeId}/ack`, {});
  }

  async createOrganization(
    document: OrganizationDocument,
    ownerCertificate: OrganizationMembershipCertificate,
  ): Promise<void> {
    await this.request("POST", "/squad/v1/organizations", {
      document,
      ownerCertificate,
    });
  }

  async organizations(): Promise<OrganizationDirectoryBundle[]> {
    const body = (await this.request("GET", "/squad/v1/organizations")) as {
      organizations?: unknown;
    };
    if (!Array.isArray(body.organizations)) {
      throw new RelayClientError(
        502,
        "INVALID_RESPONSE",
        "Relay organization directory response is invalid",
      );
    }
    return body.organizations.map((organization) =>
      organizationDirectoryBundleSchema.parse(organization),
    );
  }

  async createOrganizationInvitation(
    organizationId: string,
    expiresInMinutes = 1_440,
  ): Promise<{ invitation: string; expiresAt: string }> {
    const body = (await this.request(
      "POST",
      `/squad/v1/organizations/${organizationId}/invitations`,
      { expiresInMinutes },
    )) as { invitation?: unknown; expiresAt?: unknown };
    if (
      typeof body.invitation !== "string" ||
      typeof body.expiresAt !== "string"
    ) {
      throw new RelayClientError(
        502,
        "INVALID_RESPONSE",
        "Relay organization invitation response is invalid",
      );
    }
    return { invitation: body.invitation, expiresAt: body.expiresAt };
  }

  async joinOrganization(
    invitation: string,
    request: OrganizationJoinRequest,
  ): Promise<void> {
    await this.request("POST", "/squad/v1/organizations/join", {
      invitation,
      request,
    });
  }

  async approveOrganizationJoin(
    organizationId: string,
    requestId: string,
    certificate: OrganizationMembershipCertificate,
  ): Promise<void> {
    await this.request(
      "POST",
      `/squad/v1/organizations/${organizationId}/join-requests/${requestId}/approve`,
      { certificate },
    );
  }

  async updateOrganizationMember(
    organizationId: string,
    membershipId: string,
    certificate: OrganizationMembershipCertificate,
  ): Promise<void> {
    await this.request(
      "POST",
      `/squad/v1/organizations/${organizationId}/members/${membershipId}/certificate`,
      { certificate },
    );
  }

  async nodes(): Promise<
    Array<{ nodeId: string; displayName: string; publicKey: string }>
  > {
    const body = (await this.request("GET", "/squad/v1/nodes")) as {
      nodes?: unknown;
    };
    if (!Array.isArray(body.nodes)) {
      throw new RelayClientError(
        502,
        "INVALID_RESPONSE",
        "Relay directory response is invalid",
      );
    }
    return body.nodes as Array<{
      nodeId: string;
      displayName: string;
      publicKey: string;
    }>;
  }
}
