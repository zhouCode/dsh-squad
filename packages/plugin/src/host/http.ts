import type { IncomingMessage, ServerResponse } from "node:http";
import {
  peerPolicySchema,
  type CreateDelegationInput,
} from "../shared/contracts.ts";
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

export function createHttpHandler(squad: SquadService) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (await squad.relayServer?.handle(req, res)) return;
    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`,
    );
    try {
      if (req.method === "GET" && url.pathname === "/squad/v1/local/state") {
        reply(res, 200, squad.localState());
        return;
      }
      if (req.method === "POST") assertSameOrigin(req);
      if (
        req.method === "POST" &&
        url.pathname === "/squad/v1/local/delegations"
      ) {
        const body = await readJson(req);
        const delegation = await squad.delegate(body as CreateDelegationInput);
        reply(res, 201, delegation);
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
          policy: peerPolicySchema.parse(body.policy ?? {}),
        });
        reply(res, 201, peer);
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
