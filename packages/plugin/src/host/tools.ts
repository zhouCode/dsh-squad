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

const teamPlanItem = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    to: {
      type: "string" as const,
      required: true as const,
      description: "Paired peer display name or stable nodeId.",
    },
    objective: {
      type: "string" as const,
      required: true as const,
      description: "The result this team member should achieve.",
    },
    context: {
      type: "string" as const,
      description: "Optional task-specific background.",
    },
    acceptanceCriteria: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "Observable completion criteria.",
    },
    attachmentRefs: {
      type: "array" as const,
      items: attachmentItem,
      description: "HTTPS references with expected SHA-256 and byte size.",
    },
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

  const peers = ctx.tools.register(
    defineTool({
      name: "list_squad_peers",
      description:
        "列出本节点已配对的 Squad 成员及其委派可用状态。List locally paired Squad members and whether delegation is currently allowed.",
      parameters: {},
      output: {
        schema: { type: "json" },
        render: (_args, value) => [
          { type: "text", text: JSON.stringify(value) },
        ],
      },
      async execute() {
        const records = await squad.listPeers();
        return {
          peers: records.map((peer) => ({
            nodeId: peer.nodeId,
            displayName: peer.displayName,
            enabled: peer.enabled,
            canDelegate: peer.policy.canDelegate,
            autoExecute: peer.policy.autoExecute,
          })),
        };
      },
    }),
  );

  const proposePlan = ctx.tools.register(
    defineTool({
      name: "propose_team_plan",
      description:
        "创建本地团队分派草案，供负责人在 Squad 界面审核；此工具绝不会直接发送任务。Create a local team delegation draft for owner review; this tool never dispatches tasks.",
      parameters: {
        title: {
          type: "string",
          required: true,
          description: "Short plan title.",
        },
        sourceSummary: {
          type: "string",
          description:
            "Optional meeting summary, request summary, or planning rationale.",
        },
        items: {
          type: "array",
          required: true,
          items: teamPlanItem,
          description: "One proposed delegation per team member or objective.",
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            planId: { type: "string", required: true },
            status: { type: "string", required: true },
            itemCount: { type: "integer", required: true },
            requiresApproval: { type: "boolean", required: true },
          },
        },
        render: (_args, value) => [
          {
            type: "text",
            text: `团队分派计划 / team plan ${value.planId}: ${value.status} (${value.itemCount} items; approval required)`,
          },
        ],
      },
      async execute(args) {
        const plan = await squad.createTeamPlan({
          title: args.title,
          ...(args.sourceSummary === undefined
            ? {}
            : { sourceSummary: args.sourceSummary }),
          items: args.items.map((item) => ({
            to: item.to,
            objective: item.objective,
            ...(item.context === undefined ? {} : { context: item.context }),
            ...(item.acceptanceCriteria === undefined
              ? {}
              : { acceptanceCriteria: item.acceptanceCriteria }),
            ...(item.attachmentRefs === undefined
              ? {}
              : { attachmentRefs: item.attachmentRefs }),
          })),
        });
        return {
          planId: plan.id,
          status: plan.status,
          itemCount: plan.items.length,
          requiresApproval: true,
        };
      },
    }),
  );

  return [delegate, status, peers, proposePlan];
}
