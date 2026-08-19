import { envelopeSchema, type Envelope } from "../shared/contracts.ts";
import {
  organizationDirectoryBundleSchema,
  organizationInvitationViewSchema,
  type OrganizationDirectoryBundle,
  type OrganizationDissolutionEvent,
  type OrganizationDocument,
  type OrganizationJoinRequest,
  type OrganizationInvitationView,
  type OrganizationMembershipCertificate,
  type OrganizationOwnershipTransferProposal,
  type OrganizationRenameEvent,
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

  async health(): Promise<{
    version: string;
    nodeId: string;
    protocolVersions: number[];
  }> {
    const response = await fetch(`${this.baseUrl}/squad/v1/health`, {
      signal: AbortSignal.timeout(10_000),
      headers: { accept: "application/json" },
    });
    const body = (await parseResponse(response)) as Record<string, unknown>;
    if (
      body.ok !== true ||
      typeof body.version !== "string" ||
      typeof body.nodeId !== "string" ||
      !Array.isArray(body.protocolVersions) ||
      !body.protocolVersions.every((value) => Number.isSafeInteger(value))
    ) {
      throw new RelayClientError(
        502,
        "INVALID_RESPONSE",
        "Relay health response is invalid",
      );
    }
    return {
      version: body.version,
      nodeId: body.nodeId,
      protocolVersions: body.protocolVersions as number[],
    };
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

  async watchMailbox(
    signal: AbortSignal,
    onNotification: () => void,
  ): Promise<void> {
    const path = "/squad/v1/mailbox/events";
    const signed = signedRequest(this.identity, "GET", path);
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: { ...signed.headers, accept: "text/event-stream" },
      signal,
    });
    if (!response.ok) {
      await parseResponse(response);
      return;
    }
    if (
      !response.headers.get("content-type")?.startsWith("text/event-stream")
    ) {
      throw new RelayClientError(
        502,
        "INVALID_RESPONSE",
        "Relay mailbox event stream has an invalid content type",
      );
    }
    if (response.body === null) {
      throw new RelayClientError(
        502,
        "INVALID_RESPONSE",
        "Relay mailbox event stream has no body",
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    while (!signal.aborted) {
      const chunk = await reader.read();
      buffered += decoder.decode(chunk.value, { stream: !chunk.done });
      if (buffered.length > 64 * 1024) {
        throw new RelayClientError(
          502,
          "INVALID_RESPONSE",
          "Relay mailbox event stream exceeded its buffer limit",
        );
      }
      let separator = /\r?\n\r?\n/u.exec(buffered);
      while (separator?.index !== undefined) {
        const block = buffered.slice(0, separator.index);
        buffered = buffered.slice(separator.index + separator[0].length);
        const event = block
          .split(/\r?\n/u)
          .find((line) => line.startsWith("event:"))
          ?.slice("event:".length)
          .trim();
        if (event === "ready" || event === "mailbox") onNotification();
        separator = /\r?\n\r?\n/u.exec(buffered);
      }
      if (chunk.done) return;
    }
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
  ): Promise<{
    invitation: string;
    invitationId: string;
    expiresAt: string;
  }> {
    const body = (await this.request(
      "POST",
      `/squad/v1/organizations/${organizationId}/invitations`,
      { expiresInMinutes },
    )) as {
      invitation?: unknown;
      invitationId?: unknown;
      expiresAt?: unknown;
    };
    if (
      typeof body.invitation !== "string" ||
      typeof body.invitationId !== "string" ||
      typeof body.expiresAt !== "string"
    ) {
      throw new RelayClientError(
        502,
        "INVALID_RESPONSE",
        "Relay organization invitation response is invalid",
      );
    }
    return {
      invitation: body.invitation,
      invitationId: body.invitationId,
      expiresAt: body.expiresAt,
    };
  }

  async organizationInvitations(
    organizationId: string,
  ): Promise<OrganizationInvitationView[]> {
    const body = (await this.request(
      "GET",
      `/squad/v1/organizations/${organizationId}/invitations`,
    )) as { invitations?: unknown };
    if (!Array.isArray(body.invitations)) {
      throw new RelayClientError(
        502,
        "INVALID_RESPONSE",
        "Relay organization invitation list is invalid",
      );
    }
    return body.invitations.map((invitation) =>
      organizationInvitationViewSchema.parse(invitation),
    );
  }

  async revokeOrganizationInvitation(
    organizationId: string,
    invitationId: string,
  ): Promise<OrganizationInvitationView> {
    return organizationInvitationViewSchema.parse(
      await this.request(
        "DELETE",
        `/squad/v1/organizations/${organizationId}/invitations/${invitationId}`,
      ),
    );
  }

  async createOrganizationJoinPackage(
    organizationId: string,
    expiresInMinutes = 1_440,
  ): Promise<{
    enrollmentInvitation: string;
    organizationInvitation: string;
    expiresAt: string;
  }> {
    const body = (await this.request(
      "POST",
      `/squad/v1/organizations/${organizationId}/join-packages`,
      { expiresInMinutes },
    )) as Record<string, unknown>;
    if (
      typeof body.enrollmentInvitation !== "string" ||
      typeof body.organizationInvitation !== "string" ||
      typeof body.expiresAt !== "string"
    ) {
      throw new RelayClientError(
        502,
        "INVALID_RESPONSE",
        "Relay join package response is invalid",
      );
    }
    return {
      enrollmentInvitation: body.enrollmentInvitation,
      organizationInvitation: body.organizationInvitation,
      expiresAt: body.expiresAt,
    };
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

  async rejectOrganizationJoin(
    organizationId: string,
    requestId: string,
  ): Promise<void> {
    await this.request(
      "POST",
      `/squad/v1/organizations/${organizationId}/join-requests/${requestId}/reject`,
      {},
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

  async leaveOrganization(
    organizationId: string,
    certificate: OrganizationMembershipCertificate,
  ): Promise<void> {
    await this.request(
      "POST",
      `/squad/v1/organizations/${organizationId}/leave`,
      { certificate },
    );
  }

  async proposeOwnershipTransfer(
    organizationId: string,
    proposal: OrganizationOwnershipTransferProposal,
  ): Promise<void> {
    await this.request(
      "POST",
      `/squad/v1/organizations/${organizationId}/owner-transfers`,
      { proposal },
    );
  }

  async renameOrganization(
    organizationId: string,
    event: OrganizationRenameEvent,
  ): Promise<void> {
    await this.request(
      "POST",
      `/squad/v1/organizations/${organizationId}/name`,
      { event },
    );
  }

  async dissolveOrganization(
    organizationId: string,
    event: OrganizationDissolutionEvent,
  ): Promise<void> {
    await this.request(
      "POST",
      `/squad/v1/organizations/${organizationId}/dissolve`,
      { event },
    );
  }

  async acceptOwnershipTransfer(
    organizationId: string,
    transferId: string,
    acceptance: { acceptedAt: string; acceptanceSignature: string },
  ): Promise<void> {
    await this.request(
      "POST",
      `/squad/v1/organizations/${organizationId}/owner-transfers/${transferId}/accept`,
      acceptance,
    );
  }

  async declineOwnershipTransfer(
    organizationId: string,
    transferId: string,
  ): Promise<void> {
    await this.request(
      "DELETE",
      `/squad/v1/organizations/${organizationId}/owner-transfers/${transferId}`,
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
