import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { SquadService } from "./service.ts";

const attachmentItem = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    url: { type: "string" as const, required: true as const },
    sha256: { type: "string" as const, required: true as const },
    size: { type: "integer" as const, required: true as const },
    name: { type: "string" as const, required: true as const },
  },
};

export function registerSquadTools(
  ctx: Context,
  squad: SquadService,
): Array<() => void> {
  const delegate = ctx.tools.register(
    defineTool({
      name: "delegate_to_agent",
      description:
        "Delegate an objective to a paired person's existing Personal Agent. The receiving Agent chooses its own local skills, tools, MCP servers, credentials, and permissions. This call never grants remote capabilities.",
      parameters: {
        to: {
          type: "string",
          required: true,
          description: "Paired peer display name or stable nodeId.",
        },
        objective: {
          type: "string",
          required: true,
          description: "The result to achieve; not a remote tool command.",
        },
        context: {
          type: "string",
          description:
            "Optional background information treated as untrusted task data.",
        },
        acceptanceCriteria: {
          type: "array",
          items: { type: "string" },
          description: "Observable completion criteria.",
        },
        parentDelegationId: {
          type: "string",
          description: "Existing local parent delegation for a downstream hop.",
        },
        attachmentRefs: {
          type: "array",
          items: attachmentItem,
          description: "HTTPS references with expected SHA-256 and byte size.",
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            delegationId: { type: "string", required: true },
            status: { type: "string", required: true },
            deliveryStatus: { type: "string", required: true },
          },
        },
        render: (_args, value) => [
          {
            type: "text",
            text: `delegation ${value.delegationId}: ${value.status} (${value.deliveryStatus})`,
          },
        ],
      },
      async execute(args, exec) {
        const delegation = await squad.delegate(
          {
            to: args.to,
            objective: args.objective,
            ...(args.context === undefined ? {} : { context: args.context }),
            ...(args.acceptanceCriteria === undefined
              ? {}
              : { acceptanceCriteria: args.acceptanceCriteria }),
            ...(args.parentDelegationId === undefined
              ? {}
              : { parentDelegationId: args.parentDelegationId }),
            ...(args.attachmentRefs === undefined
              ? {}
              : { attachmentRefs: args.attachmentRefs }),
          },
          exec.agent?.id,
        );
        return {
          delegationId: delegation.id,
          status: delegation.status,
          deliveryStatus: delegation.deliveryStatus,
        };
      },
    }),
  );

  const status = ctx.tools.register(
    defineTool({
      name: "get_delegation_status",
      description:
        "Read this Node's public projection of one sent or received delegation. It never returns a remote session, private HumanTodo details, credentials, or hidden reasoning.",
      parameters: {
        delegationId: { type: "string", required: true },
      },
      output: {
        schema: { type: "json" },
        render: (_args, value) => [
          { type: "text", text: JSON.stringify(value) },
        ],
      },
      async execute(args) {
        const delegation = await squad.getDelegation(args.delegationId);
        if (delegation === undefined) {
          return { found: false, code: "NOT_FOUND" };
        }
        const outputs = delegation.outputs.map((output) => {
          if (output.type === "text") {
            return { type: output.type, content: output.content };
          }
          return output.sha256 === undefined
            ? { type: output.type, name: output.name, url: output.url }
            : {
                type: output.type,
                name: output.name,
                url: output.url,
                sha256: output.sha256,
              };
        });
        return {
          found: true,
          delegationId: delegation.id,
          direction: delegation.direction,
          peerNodeId: delegation.peerNodeId,
          status: delegation.status,
          revision: delegation.revision,
          deliveryStatus: delegation.deliveryStatus,
          ...(delegation.summary === undefined
            ? {}
            : { summary: delegation.summary }),
          outputs,
          ...(delegation.errorCode === undefined
            ? {}
            : { errorCode: delegation.errorCode }),
          updatedAt: delegation.updatedAt,
        };
      },
    }),
  );

  return [delegate, status];
}
