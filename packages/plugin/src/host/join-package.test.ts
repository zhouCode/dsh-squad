import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "./config.ts";
import { RelayServer } from "./relay.ts";
import { SquadService } from "./service.ts";

async function listen(handler: RequestListener): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

describe("one-step team join package", () => {
  it("enrolls an unconfigured Node and submits its organization request", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-squad-one-step-join-"));
    const relay = new RelayServer({
      databasePath: join(root, "relay.sqlite"),
      invites: [
        {
          token: "relay-invite-alice-000000000000",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
      maxMailboxItems: 100,
      maxRequestsPerMinute: 1_000,
    });
    const http = await listen((req, res) => {
      void relay.handle(req, res).then((handled) => {
        if (!handled) {
          res.statusCode = 404;
          res.end();
        }
      });
    });
    const alice = new SquadService(
      new Context(),
      resolveConfig({
        dataDir: join(root, "alice"),
        updates: { stateDir: join(root, "alice-updates") },
      }),
    );
    const bob = new SquadService(
      new Context(),
      resolveConfig({
        dataDir: join(root, "bob"),
        updates: { stateDir: join(root, "bob-updates") },
      }),
    );
    const charlie = new SquadService(
      new Context(),
      resolveConfig({
        dataDir: join(root, "charlie"),
        updates: { stateDir: join(root, "charlie-updates") },
      }),
    );
    try {
      await Promise.all([alice.start(), bob.start(), charlie.start()]);
      await alice.configureNode({
        mode: "RELAY",
        displayName: "Alice",
        relayUrl: http.url,
        invitation: "relay-invite-alice-000000000000",
      });
      const organization = await alice.createOrganization("Product");
      const joinPackage = await alice.createOrganizationJoinPackage(
        organization.organizationId,
        60,
      );

      await expect(
        bob.importJoinPackage({
          bundle: joinPackage.bundle,
          displayName: "Bob",
        }),
      ).resolves.toMatchObject({
        organizationId: organization.organizationId,
        organizationName: "Product",
        status: "PENDING",
      });
      expect(bob.localState()).toMatchObject({
        setup: { required: false, mode: "RELAY" },
        identity: { displayName: "Bob" },
        relay: { configured: true, url: http.url },
        organizations: [
          {
            organizationId: organization.organizationId,
            membershipStatus: "PENDING",
          },
        ],
      });

      const ownerDirectory = await alice.relayClient?.organizations();
      expect(ownerDirectory?.[0]?.pendingJoinRequests[0]).toMatchObject({
        displayName: "Bob",
        nodeId: bob.identity.nodeId,
      });
      await expect(
        charlie.importJoinPackage({
          bundle: joinPackage.bundle,
          displayName: "Charlie",
        }),
      ).rejects.toMatchObject({ code: "INVITATION_ALREADY_USED" });

      const request = ownerDirectory?.[0]?.pendingJoinRequests[0];
      if (request === undefined) throw new Error("missing Bob join request");
      await alice.approveOrganizationJoin(
        organization.organizationId,
        request.requestId,
      );
      const bobBundle = (await bob.relayClient?.organizations())?.[0];
      if (bobBundle === undefined) throw new Error("missing Bob directory");
      bob.database.applyOrganizationBundle(bobBundle, bob.identity.nodeId);
      await bob.selectSessionOrganization(
        "leave-session",
        organization.organizationId,
      );
      expect(bob.sessionOrganization("leave-session")?.organizationId).toBe(
        organization.organizationId,
      );

      await alice.proposeOrganizationOwnershipTransfer(
        organization.organizationId,
        request.membershipId,
        60,
      );
      const transferToBob = (await bob.relayClient?.organizations())?.[0]
        ?.pendingOwnerTransfer;
      if (transferToBob === undefined) {
        throw new Error("missing transfer proposal for Bob");
      }
      await bob.acceptOrganizationOwnershipTransfer(
        organization.organizationId,
        transferToBob.transferId,
      );
      expect((await bob.listOrganizations())[0]?.role).toBe("OWNER");

      const aliceMembershipId = organization.selfMembershipId;
      if (aliceMembershipId === undefined) {
        throw new Error("missing Alice membership");
      }
      await bob.proposeOrganizationOwnershipTransfer(
        organization.organizationId,
        aliceMembershipId,
        60,
      );
      const transferToAlice = (await alice.relayClient?.organizations())?.[0]
        ?.pendingOwnerTransfer;
      if (transferToAlice === undefined) {
        throw new Error("missing transfer proposal for Alice");
      }
      await alice.acceptOrganizationOwnershipTransfer(
        organization.organizationId,
        transferToAlice.transferId,
      );
      expect((await alice.listOrganizations())[0]?.role).toBe("OWNER");
      await alice.renameOrganization(
        organization.organizationId,
        "Product Core",
      );
      expect((await alice.listOrganizations())[0]?.name).toBe("Product Core");

      await bob.leaveOrganization(organization.organizationId);
      expect(bob.sessionOrganization("leave-session")).toBeUndefined();
      expect(bob.localState().organizations[0]).toMatchObject({
        organizationId: organization.organizationId,
        name: "Product Core",
        membershipStatus: "DISABLED",
      });

      await alice.selectSessionOrganization(
        "dissolve-session",
        organization.organizationId,
      );
      await alice.dissolveOrganization(
        organization.organizationId,
        "Project completed",
      );
      expect(alice.sessionOrganization("dissolve-session")).toBeUndefined();
      expect(alice.localState().organizations[0]).toMatchObject({
        organizationId: organization.organizationId,
        name: "Product Core",
        lifecycleStatus: "DISSOLVED",
      });
      const dissolvedBobBundle = (await bob.relayClient?.organizations())?.[0];
      if (dissolvedBobBundle === undefined) {
        throw new Error("missing dissolved Bob directory");
      }
      bob.database.applyOrganizationBundle(
        dissolvedBobBundle,
        bob.identity.nodeId,
      );
      expect(bob.localState().organizations[0]?.lifecycleStatus).toBe(
        "DISSOLVED",
      );
      await expect(
        alice.createOrganizationJoinPackage(organization.organizationId, 60),
      ).rejects.toThrow(/dissolved|active organization/iu);
    } finally {
      await Promise.all([alice.close(), bob.close(), charlie.close()]);
      await http.close();
      relay.close();
    }
  });
});
