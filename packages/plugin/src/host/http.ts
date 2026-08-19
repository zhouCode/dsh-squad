import type { IncomingMessage, ServerResponse } from "node:http";
import {
  peerPolicySchema,
  type CreateDelegationInput,
  type CreateTeamPlanInput,
} from "../shared/contracts.ts";
import { updateModeSchema } from "../shared/updates.ts";
import type { SquadService } from "./service.ts";

class LocalHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}

async function readJson(
  req: IncomingMessage,
  maxBytes = 256 * 1024,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of req) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.byteLength;
    if (size > maxBytes) throw new LocalHttpError(413, "PAYLOAD_TOO_LARGE");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(
      Buffer.concat(chunks).toString("utf8") || "{}",
    ) as unknown;
  } catch {
    throw new LocalHttpError(400, "INVALID_JSON");
  }
}

function reply(res: ServerResponse, status: number, value: unknown): void {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": bytes.byteLength,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(bytes);
}

function streamLocalState(
  req: IncomingMessage,
  res: ServerResponse,
  squad: SquadService,
): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write("retry: 3000\n\n");
  const dispose = squad.subscribeLocalState((revision) => {
    if (!res.destroyed) {
      res.write(`event: state\ndata: ${JSON.stringify({ revision })}\n\n`);
    }
  });
  const heartbeat = setInterval(() => {
    if (!res.destroyed) res.write(": keepalive\n\n");
  }, 20_000);
  heartbeat.unref?.();
  req.once("close", () => {
    clearInterval(heartbeat);
    dispose();
  });
}

function assertSameOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin;
  if (origin === undefined) return;
  const host = req.headers.host;
  if (host === undefined) throw new LocalHttpError(403, "ORIGIN_REJECTED");
  const parsed = new URL(origin);
  if (parsed.host !== host || !["http:", "https:"].includes(parsed.protocol)) {
    throw new LocalHttpError(403, "ORIGIN_REJECTED");
  }
}

function assertLoopbackClient(req: IncomingMessage): void {
  const address = req.socket.remoteAddress;
  const loopback =
    address === "::1" ||
    address?.startsWith("127.") === true ||
    address?.startsWith("::ffff:127.") === true;
  if (
    !loopback ||
    req.headers["x-forwarded-for"] !== undefined ||
    req.headers["x-real-ip"] !== undefined
  ) {
    throw new LocalHttpError(403, "LOCAL_API_REQUIRES_LOOPBACK");
  }
}

export function createHttpHandler(squad: SquadService) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`,
    );
    if (req.method === "GET" && url.pathname === "/squad/v1/health") {
      reply(res, 200, {
        ok: true,
        version: squad.version(),
        protocolVersions: [1, 2],
      });
      return;
    }
    if (await squad.relayServer?.handle(req, res)) return;
    try {
      if (url.pathname.startsWith("/squad/v1/local/")) {
        assertLoopbackClient(req);
      }
      if (req.method === "GET" && url.pathname === "/squad/v1/local/state") {
        reply(res, 200, squad.localState());
        return;
      }
      if (req.method === "GET" && url.pathname === "/squad/v1/local/events") {
        streamLocalState(req, res, squad);
        return;
      }
      if (req.method === "POST") assertSameOrigin(req);
      if (
        req.method === "POST" &&
        url.pathname === "/squad/v1/direct/envelopes"
      ) {
        const envelope = await readJson(req, 256 * 1024);
        reply(res, 200, await squad.receiveDirectEnvelope(envelope));
        return;
      }
      if (
        req.method === "POST" &&
        url.pathname === "/squad/v1/local/updates/check"
      ) {
        await readJson(req, 1_024);
        reply(res, 200, await squad.checkForUpdates());
        return;
      }
      if (
        req.method === "POST" &&
        url.pathname === "/squad/v1/local/updates/policy"
      ) {
        const body = (await readJson(req, 1_024)) as Record<string, unknown>;
        reply(
          res,
          200,
          await squad.setUpdateMode(updateModeSchema.parse(body.mode)),
        );
        return;
      }
      if (
        req.method === "POST" &&
        url.pathname === "/squad/v1/local/updates/install"
      ) {
        await readJson(req, 1_024);
        reply(res, 202, await squad.requestUpdateInstall());
        return;
      }
      if (
        req.method === "POST" &&
        url.pathname === "/squad/v1/local/delegations"
      ) {
        const body = await readJson(req);
        const delegation = await squad.delegate(body as CreateDelegationInput);
        reply(res, 201, delegation);
        return;
      }
      if (req.method === "POST" && url.pathname === "/squad/v1/local/plans") {
        const body = await readJson(req);
        const plan = await squad.createTeamPlan(body as CreateTeamPlanInput);
        reply(res, 201, plan);
        return;
      }
      if (req.method === "POST" && url.pathname === "/squad/v1/local/peers") {
        const body = (await readJson(req, 32 * 1024)) as Record<
          string,
          unknown
        >;
        const peer = await squad.addPeer({
          nodeId: String(body.nodeId ?? ""),
          displayName: String(body.displayName ?? ""),
          publicKey: String(body.publicKey ?? ""),
          enabled: body.enabled === undefined ? true : body.enabled === true,
          transport:
            body.transport === "DIRECT" || body.transport === "RELAY"
              ? body.transport
              : "RELAY",
          ...(typeof body.directUrl === "string"
            ? { directUrl: body.directUrl }
            : {}),
          policy: peerPolicySchema.parse(body.policy ?? {}),
        });
        reply(res, 201, peer);
        return;
      }
      const directPeerPolicy =
        /^\/squad\/v1\/local\/peers\/(node_[A-Za-z0-9_-]{43})\/policy$/u.exec(
          url.pathname,
        );
      if (req.method === "POST" && directPeerPolicy?.[1] !== undefined) {
        const body = (await readJson(req, 8 * 1024)) as Record<string, unknown>;
        const peer = await squad.updatePeerPolicy(directPeerPolicy[1], {
          autoExecute: peerPolicySchema.shape.autoExecute.parse(
            body.autoExecute,
          ),
        });
        reply(res, 200, peer);
        return;
      }
      if (
        req.method === "POST" &&
        url.pathname === "/squad/v1/local/organizations"
      ) {
        const body = (await readJson(req, 8 * 1024)) as Record<string, unknown>;
        reply(
          res,
          201,
          await squad.createOrganization(String(body.name ?? "")),
        );
        return;
      }
      if (
        req.method === "POST" &&
        url.pathname === "/squad/v1/local/organizations/join"
      ) {
        const body = (await readJson(req, 8 * 1024)) as Record<string, unknown>;
        await squad.joinOrganization(String(body.invitation ?? ""));
        reply(res, 202, { ok: true });
        return;
      }
      const organizationInvitation =
        /^\/squad\/v1\/local\/organizations\/([0-9a-f-]{36})\/invitations$/u.exec(
          url.pathname,
        );
      if (req.method === "POST" && organizationInvitation?.[1] !== undefined) {
        const body = (await readJson(req, 8 * 1024)) as Record<string, unknown>;
        const rawMinutes = Number(body.expiresInMinutes ?? 1_440);
        if (!Number.isInteger(rawMinutes)) {
          throw new LocalHttpError(400, "INVALID_INVITATION_EXPIRY");
        }
        reply(
          res,
          201,
          await squad.createOrganizationInvitation(
            organizationInvitation[1],
            rawMinutes,
          ),
        );
        return;
      }
      const approveOrganizationJoin =
        /^\/squad\/v1\/local\/organizations\/([0-9a-f-]{36})\/join-requests\/([0-9a-f-]{36})\/approve$/u.exec(
          url.pathname,
        );
      if (
        req.method === "POST" &&
        approveOrganizationJoin?.[1] !== undefined &&
        approveOrganizationJoin[2] !== undefined
      ) {
        await readJson(req, 1_024);
        await squad.approveOrganizationJoin(
          approveOrganizationJoin[1],
          approveOrganizationJoin[2],
        );
        reply(res, 200, { ok: true });
        return;
      }
      const organizationMemberAction =
        /^\/squad\/v1\/local\/organizations\/([0-9a-f-]{36})\/members\/([0-9a-f-]{36})\/(role|status|policy)$/u.exec(
          url.pathname,
        );
      if (
        req.method === "POST" &&
        organizationMemberAction?.[1] !== undefined &&
        organizationMemberAction[2] !== undefined &&
        organizationMemberAction[3] !== undefined
      ) {
        const body = (await readJson(req, 8 * 1024)) as Record<string, unknown>;
        if (organizationMemberAction[3] === "role") {
          await squad.setOrganizationMemberRole(
            organizationMemberAction[1],
            organizationMemberAction[2],
            String(body.role ?? ""),
          );
        }
        if (organizationMemberAction[3] === "status") {
          await squad.setOrganizationMemberEnabled(
            organizationMemberAction[1],
            organizationMemberAction[2],
            body.enabled === true,
          );
        }
        if (organizationMemberAction[3] === "policy") {
          await squad.updateOrganizationMemberPolicy(
            organizationMemberAction[1],
            organizationMemberAction[2],
            {
              autoExecute: peerPolicySchema.shape.autoExecute.parse(
                body.autoExecute,
              ),
            },
          );
        }
        reply(res, 200, { ok: true });
        return;
      }
      if (
        req.method === "POST" &&
        url.pathname === "/squad/v1/local/session-organization"
      ) {
        const body = (await readJson(req, 8 * 1024)) as Record<string, unknown>;
        const sessionId = String(body.sessionId ?? "").trim();
        if (sessionId.length === 0) {
          throw new LocalHttpError(400, "SESSION_REQUIRED");
        }
        await squad.selectSessionOrganization(
          sessionId,
          typeof body.organizationId === "string" &&
            body.organizationId.trim().length > 0
            ? body.organizationId
            : undefined,
        );
        reply(res, 200, { ok: true });
        return;
      }
      const action =
        /^\/squad\/v1\/local\/delegations\/([0-9a-f-]{36})\/(accept|reject|human-input|retry|cancel)$/u.exec(
          url.pathname,
        );
      if (
        req.method === "POST" &&
        action?.[1] !== undefined &&
        action[2] !== undefined
      ) {
        const body = (await readJson(req)) as Record<string, unknown>;
        if (action[2] === "accept") await squad.acceptDelegation(action[1]);
        if (action[2] === "reject") {
          await squad.rejectDelegation(
            action[1],
            String(body.reason ?? "Rejected by owner."),
          );
        }
        if (action[2] === "human-input") {
          await squad.submitHumanInput(action[1], {
            todoIds: Array.isArray(body.todoIds)
              ? body.todoIds.map((value) => String(value))
              : [],
            ...(body.response === undefined
              ? {}
              : { response: String(body.response) }),
            attachmentRefs: Array.isArray(body.attachmentRefs)
              ? body.attachmentRefs
              : [],
          });
        }
        if (action[2] === "retry") await squad.retryDelivery(action[1]);
        if (action[2] === "cancel") {
          await squad.requestCancel(
            action[1],
            body.reason === undefined ? undefined : String(body.reason),
          );
        }
        reply(res, 200, { ok: true });
        return;
      }
      const planAction =
        /^\/squad\/v1\/local\/plans\/([0-9a-f-]{36})\/(approve|retry|cancel)$/u.exec(
          url.pathname,
        );
      if (
        req.method === "POST" &&
        planAction?.[1] !== undefined &&
        planAction[2] !== undefined
      ) {
        const plan =
          planAction[2] === "cancel"
            ? await squad.cancelTeamPlan(planAction[1])
            : await squad.approveTeamPlan(planAction[1]);
        reply(res, 200, plan);
        return;
      }
      if (
        req.method === "POST" &&
        url.pathname === "/squad/v1/local/self-test/session"
      ) {
        reply(res, 200, await squad.nativeHostSelfTest());
        return;
      }
      reply(res, 404, {
        error: { code: "NOT_FOUND", message: "route not found" },
      });
    } catch (error) {
      if (error instanceof LocalHttpError) {
        reply(res, error.status, {
          error: { code: error.code, message: error.message },
        });
        return;
      }
      reply(res, 400, {
        error: {
          code: "LOCAL_REQUEST_FAILED",
          message: error instanceof Error ? error.message : "request failed",
        },
      });
    }
  };
}
