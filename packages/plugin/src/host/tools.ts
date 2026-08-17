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
        "将任务委派给已配对成员的 Personal Agent。用户说“交给 Bob”“让 Alice 处理”“委派给某人”或使用“@Bob + 任务”时应调用；@name 是简称时先调用 list_squad_peers，并传入匹配到的完整 displayName 或 nodeId。若成员或目标不明确，先澄清，绝不猜测。Delegate when the user says assign/send/hand this to a paired member or writes @name with an objective. Resolve shorthand through list_squad_peers and pass the exact displayName or nodeId. The receiving Agent chooses its own local capabilities; this call never grants remote capabilities.",
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
        "用户询问某项委派的进度、状态、结果或失败原因时，读取本 Node 可见的公开投影。Read the public projection when the user asks for a delegation's progress, status, result, or failure reason. It never returns a remote session, private HumanTodo details, credentials, or hidden reasoning.",
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
        "用户询问团队成员、谁在团队里或任务可以交给谁时列出本节点已配对成员；规划或委派时若成员名称不明确，也应先调用。List locally paired Squad members and delegation availability when the user asks who is on the team, who can receive work, or when planning/delegation needs recipient resolution.",
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
        "用户要求根据会议纪要、团队目标或一批工作进行总结分工、拆解任务、安排多人协作时，创建本地团队分派草案；通常先调用 list_squad_peers。Create a local delegation draft when the user asks to turn meeting notes, a team objective, or a work batch into a team plan. Usually call list_squad_peers first. The owner must review the draft; this tool never dispatches tasks.",
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
