import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { createHttpHandler } from "./http.ts";
import { TeamPlanEditConflictError } from "./database.ts";
import type { SquadService } from "./service.ts";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) =>
            error === undefined ? resolve() : reject(error),
          );
        }),
    ),
  );
});

describe("Squad host health", () => {
  it("reports the running plugin version even when Relay also handles health", async () => {
    const squad = {
      version: () => "0.6.0",
      nodeId: () => "node_test-health-identity",
      relayServer: {
        handle: async () => {
          throw new Error("Relay handler must not shadow host health");
        },
      },
    } as unknown as SquadService;
    const server = createServer(createHttpHandler(squad));
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${address.port}/squad/v1/health`,
    );
    expect(await response.json()).toEqual({
      ok: true,
      version: "0.6.0",
      nodeId: "node_test-health-identity",
      protocolVersions: [1, 2],
    });
  });

  it("accepts validated guided setup through the loopback management API", async () => {
    const configureNode = vi.fn(async (input: unknown) => ({ input }));
    const squad = { configureNode } as unknown as SquadService;
    const server = createServer(createHttpHandler(squad));
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${address.port}/squad/v1/local/setup`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "DIRECT",
          displayName: "Alice",
          directEnabled: false,
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      input: {
        mode: "DIRECT",
        displayName: "Alice",
        directEnabled: false,
      },
    });
    expect(configureNode).toHaveBeenCalledOnce();
  });

  it("exposes a lightweight actionable-work summary", async () => {
    const squad = {
      relayServer: undefined,
      localAttentionSummary: () => ({
        revision: 3,
        setupRequired: false,
        waitingHuman: 2,
        failedOutgoing: 1,
        pendingJoinRequests: 0,
        draftPlans: 1,
        updateAvailable: false,
        total: 4,
      }),
    } as unknown as SquadService;
    const server = createServer(createHttpHandler(squad));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("test server did not bind");
    }
    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/squad/v1/local/attention`,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ total: 4, revision: 3 });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("validates and saves an optimistic team-plan draft edit", async () => {
    const planId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const updateTeamPlan = vi.fn(async (_id: string, input: unknown) => ({
      id: planId,
      revision: 3,
      status: "DRAFT",
      input,
    }));
    const squad = { updateTeamPlan } as unknown as SquadService;
    const server = createServer(createHttpHandler(squad));
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    const input = {
      revision: 2,
      title: "Edited plan",
      items: [{ to: "Bob", objective: "Write the final draft" }],
    };
    const response = await fetch(
      `http://127.0.0.1:${address.port}/squad/v1/local/plans/${planId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ revision: 3 });
    expect(updateTeamPlan).toHaveBeenCalledWith(planId, input);

    updateTeamPlan.mockRejectedValueOnce(
      new TeamPlanEditConflictError("reload before saving"),
    );
    const conflict = await fetch(
      `http://127.0.0.1:${address.port}/squad/v1/local/plans/${planId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      error: {
        code: "TEAM_PLAN_EDIT_CONFLICT",
        message: "reload before saving",
      },
    });
  });

  it("runs connection diagnostics through the loopback management API", async () => {
    const checkConnections = vi.fn(async () => ({
      checkedAt: new Date().toISOString(),
      relay: {
        status: "CONNECTED",
        configured: true,
        serving: false,
        eventStream: "CONNECTED",
      },
      direct: { status: "NOT_CONFIGURED", serving: false },
      queue: { pending: 0, retrying: 0 },
    }));
    const squad = { checkConnections } as unknown as SquadService;
    const server = createServer(createHttpHandler(squad));
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${address.port}/squad/v1/local/connections/check`,
      { method: "POST", body: "{}" },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      relay: { status: "CONNECTED" },
      queue: { pending: 0 },
    });
    expect(checkConnections).toHaveBeenCalledOnce();
  });

  it("routes native Skill discovery and local Team Skill controls", async () => {
    const releaseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const listPublishableSkills = vi.fn(async () => [
      {
        name: "release-notes",
        description: "Prepare release notes",
        source: "filesystem",
        provider: "filesystem",
      },
    ]);
    const setTeamSkillActivation = vi.fn((_id: string, activation: string) => ({
      releaseId,
      activation,
    }));
    const removeTeamSkill = vi.fn();
    const squad = {
      listPublishableSkills,
      setTeamSkillActivation,
      removeTeamSkill,
    } as unknown as SquadService;
    const server = createServer(createHttpHandler(squad));
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}/squad/v1/local/team-skills`;

    const native = await fetch(`${base}/native`);
    expect(native.status).toBe(200);
    expect(await native.json()).toMatchObject({
      skills: [{ name: "release-notes" }],
    });

    const activation = await fetch(`${base}/${releaseId}/activation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activation: "DELEGATION" }),
    });
    expect(activation.status).toBe(200);
    expect(setTeamSkillActivation).toHaveBeenCalledWith(
      releaseId,
      "DELEGATION",
    );

    const removal = await fetch(`${base}/${releaseId}`, { method: "DELETE" });
    expect(removal.status).toBe(200);
    expect(removeTeamSkill).toHaveBeenCalledWith(releaseId);
  });

  it("actively synchronizes before returning refreshed local state", async () => {
    const refreshNow = vi.fn(async () => ({
      revision: 42,
      delegations: [],
      plans: [],
    }));
    const squad = { refreshNow } as unknown as SquadService;
    const server = createServer(createHttpHandler(squad));
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${address.port}/squad/v1/local/refresh`,
      { method: "POST", body: "{}" },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ revision: 42 });
    expect(refreshNow).toHaveBeenCalledOnce();
  });

  it("routes reversible work archival through the local API", async () => {
    const delegationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const planId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const archiveDelegation = vi.fn(async () => ({ id: delegationId }));
    const restoreDelegation = vi.fn(async () => ({ id: delegationId }));
    const archiveTeamPlan = vi.fn(async () => ({ id: planId }));
    const restoreTeamPlan = vi.fn(async () => ({ id: planId }));
    const squad = {
      archiveDelegation,
      restoreDelegation,
      archiveTeamPlan,
      restoreTeamPlan,
    } as unknown as SquadService;
    const server = createServer(createHttpHandler(squad));
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    for (const path of [
      `delegations/${delegationId}/archive`,
      `delegations/${delegationId}/restore`,
      `plans/${planId}/archive`,
      `plans/${planId}/restore`,
    ]) {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/squad/v1/local/${path}`,
        { method: "POST", body: "{}" },
      );
      expect(response.status).toBe(200);
    }
    expect(archiveDelegation).toHaveBeenCalledWith(delegationId);
    expect(restoreDelegation).toHaveBeenCalledWith(delegationId);
    expect(archiveTeamPlan).toHaveBeenCalledWith(planId);
    expect(restoreTeamPlan).toHaveBeenCalledWith(planId);
  });

  it("routes organization join rejection through the local API", async () => {
    const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const rejectOrganizationJoin = vi.fn(async () => undefined);
    const squad = { rejectOrganizationJoin } as unknown as SquadService;
    const server = createServer(createHttpHandler(squad));
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${address.port}/squad/v1/local/organizations/${organizationId}/join-requests/${requestId}/reject`,
      { method: "POST", body: "{}" },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(rejectOrganizationJoin).toHaveBeenCalledWith(
      organizationId,
      requestId,
    );
  });

  it("lists and revokes organization invitations through the local API", async () => {
    const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const invitationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const invitation = {
      invitationId,
      organizationId,
      createdByMembershipId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      status: "ACTIVE" as const,
      createdAt: "2026-08-20T00:00:00.000Z",
      expiresAt: "2026-08-21T00:00:00.000Z",
    };
    const organizationInvitations = vi.fn(async () => [invitation]);
    const revokeOrganizationInvitation = vi.fn(async () => ({
      ...invitation,
      status: "REVOKED" as const,
      revokedAt: "2026-08-20T01:00:00.000Z",
    }));
    const squad = {
      organizationInvitations,
      revokeOrganizationInvitation,
    } as unknown as SquadService;
    const server = createServer(createHttpHandler(squad));
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}/squad/v1/local/organizations/${organizationId}/invitations`;

    const listResponse = await fetch(base);
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual([invitation]);
    expect(organizationInvitations).toHaveBeenCalledWith(organizationId);

    const revokeResponse = await fetch(`${base}/${invitationId}`, {
      method: "DELETE",
    });
    expect(revokeResponse.status).toBe(200);
    expect(await revokeResponse.json()).toMatchObject({ status: "REVOKED" });
    expect(revokeOrganizationInvitation).toHaveBeenCalledWith(
      organizationId,
      invitationId,
    );
  });

  it("leaves an organization through the local API", async () => {
    const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const leaveOrganization = vi.fn(async () => undefined);
    const squad = { leaveOrganization } as unknown as SquadService;
    const server = createServer(createHttpHandler(squad));
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${address.port}/squad/v1/local/organizations/${organizationId}/leave`,
      { method: "POST", body: "{}" },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(leaveOrganization).toHaveBeenCalledWith(organizationId);
  });

  it("renames organizations and manages ownership transfers through the local API", async () => {
    const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const transferId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const targetMembershipId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const renameOrganization = vi.fn(async () => undefined);
    const dissolveOrganization = vi.fn(async () => undefined);
    const proposeOrganizationOwnershipTransfer = vi.fn(async () => undefined);
    const acceptOrganizationOwnershipTransfer = vi.fn(async () => undefined);
    const declineOrganizationOwnershipTransfer = vi.fn(async () => undefined);
    const squad = {
      renameOrganization,
      dissolveOrganization,
      proposeOrganizationOwnershipTransfer,
      acceptOrganizationOwnershipTransfer,
      declineOrganizationOwnershipTransfer,
    } as unknown as SquadService;
    const server = createServer(createHttpHandler(squad));
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}/squad/v1/local/organizations/${organizationId}/owner-transfers`;

    const renamed = await fetch(
      `http://127.0.0.1:${address.port}/squad/v1/local/organizations/${organizationId}/name`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Product Core" }),
      },
    );
    expect(renamed.status).toBe(200);
    expect(renameOrganization).toHaveBeenCalledWith(
      organizationId,
      "Product Core",
    );

    const dissolved = await fetch(
      `http://127.0.0.1:${address.port}/squad/v1/local/organizations/${organizationId}/dissolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Project completed" }),
      },
    );
    expect(dissolved.status).toBe(200);
    expect(dissolveOrganization).toHaveBeenCalledWith(
      organizationId,
      "Project completed",
    );

    const proposed = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetMembershipId, expiresInMinutes: 60 }),
    });
    expect(proposed.status).toBe(202);
    expect(proposeOrganizationOwnershipTransfer).toHaveBeenCalledWith(
      organizationId,
      targetMembershipId,
      60,
    );

    const accepted = await fetch(`${base}/${transferId}/accept`, {
      method: "POST",
      body: "{}",
    });
    expect(accepted.status).toBe(200);
    expect(acceptOrganizationOwnershipTransfer).toHaveBeenCalledWith(
      organizationId,
      transferId,
    );

    const declined = await fetch(`${base}/${transferId}/decline`, {
      method: "POST",
      body: "{}",
    });
    expect(declined.status).toBe(200);
    expect(declineOrganizationOwnershipTransfer).toHaveBeenCalledWith(
      organizationId,
      transferId,
    );
  });

  it("validates and manages local automation rules", async () => {
    const created = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      source: "INTERFACE" as const,
      name: "Review docs",
      objectivePattern: "review docs:*",
      allowedTools: ["read_file"],
      allowAttachments: false,
      maxRuntimeMinutes: 5,
      priority: 10,
      enabled: true,
    };
    const createAutomationRule = vi.fn(async () => created);
    const updateAutomationRule = vi.fn(async () => ({
      ...created,
      enabled: false,
    }));
    const deleteAutomationRule = vi.fn(async () => undefined);
    const squad = {
      createAutomationRule,
      updateAutomationRule,
      deleteAutomationRule,
    } as unknown as SquadService;
    const server = createServer(createHttpHandler(squad));
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}/squad/v1/local/automation-rules`;
    const input = {
      name: "Review docs",
      objectivePattern: "review docs:*",
      allowedTools: ["read_file"],
      allowAttachments: false,
      maxRuntimeMinutes: 5,
      priority: 10,
      enabled: true,
    };

    const createResponse = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(createResponse.status).toBe(201);
    expect(await createResponse.json()).toEqual(created);
    expect(createAutomationRule).toHaveBeenCalledWith(input);

    const updateResponse = await fetch(`${base}/${created.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, enabled: false }),
    });
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toMatchObject({ enabled: false });
    expect(updateAutomationRule).toHaveBeenCalledWith(created.id, {
      ...input,
      enabled: false,
    });

    const deleteResponse = await fetch(`${base}/${created.id}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toEqual({ ok: true });
    expect(deleteAutomationRule).toHaveBeenCalledWith(created.id);
  });

  it("rejects unsafe automation rule payloads before they reach the service", async () => {
    const createAutomationRule = vi.fn();
    const squad = { createAutomationRule } as unknown as SquadService;
    const server = createServer(createHttpHandler(squad));
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${address.port}/squad/v1/local/automation-rules`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Unsafe",
          objectivePattern: "*",
          allowedTools: ["run_code"],
        }),
      },
    );
    expect(response.status).toBe(400);
    expect(createAutomationRule).not.toHaveBeenCalled();
  });
});
