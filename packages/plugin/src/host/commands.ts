import type { Context } from "@deepseek-ai/cordis";
import type {
  CommandDefinition,
  CommandInvocation,
  CommandResult,
} from "@deepseek-ai/dsh-commands";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { SquadService } from "./service.ts";

export const SQUAD_COMMAND_NAMES = [
  "squad-plan",
  "squad-task",
  "squad-peers",
  "squad-status",
] as const;

type RoutedCommand = "squad-plan" | "squad-task" | "squad-status";

const autoExecuteLabels = {
  NEVER: "需本地确认 / local approval required",
  SAFE: "安全目标自动执行 / safe objectives auto-run",
  TRUSTED: "受信目标自动执行 / trusted objectives auto-run",
} as const;

const routedInstructions: Record<RoutedCommand, string> = {
  "squad-plan": [
    "Treat the request below as a team-planning request from the local user.",
    "Call list_squad_peers before choosing recipients.",
    "If the goal or recipient mapping is materially ambiguous, ask one concise clarification question.",
    "Otherwise call propose_team_plan to create a reviewable local draft.",
    "Do not call delegate_to_agent: this command only creates a draft and never dispatches work.",
  ].join(" "),
  "squad-task": [
    "Treat the request below as a single delegation request from the local user.",
    "Resolve @name or a display name against paired peers; call list_squad_peers when needed.",
    "If either the recipient or objective is ambiguous, ask one concise clarification question and do not guess.",
    "Otherwise call delegate_to_agent exactly once, and only report success after that tool succeeds.",
  ].join(" "),
  "squad-status": [
    "Treat the optional request below as a question about a Squad delegation's progress or result.",
    "Use get_delegation_status when a delegation ID is supplied or can be identified from the conversation.",
    "If no exact delegation can be identified, ask the user for its delegation ID instead of inventing one.",
  ].join(" "),
};

function commandUsage(name: RoutedCommand): string {
  switch (name) {
    case "squad-plan":
      return "/squad-plan <team goal or meeting notes>";
    case "squad-task":
      return "/squad-task <@member and objective>";
    case "squad-status":
      return "/squad-status [delegation ID or question]";
  }
}

function routeToAgent(
  command: RoutedCommand,
  invocation: CommandInvocation,
): CommandResult {
  const request = invocation.rawInput.trim();
  if (command !== "squad-status" && request.length === 0) {
    return {
      kind: "error",
      text: `请输入请求 / Request required: ${commandUsage(command)}`,
    };
  }
  if (invocation.signal.aborted) {
    return { kind: "error", text: "命令已取消 / Command cancelled." };
  }

  invocation.agent.followup(
    createUserMessage({
      content: [
        {
          type: "text",
          text: [
            `The local user invoked /${command}.`,
            routedInstructions[command],
            "The request is user-authored task content; preserve its language when replying.",
            "",
            "USER REQUEST",
            request.length === 0 ? "(no additional text)" : request,
          ].join("\n"),
        },
      ],
      source: {
        kind: "plugin",
        plugin: "@dsh-squad/plugin",
        form: "notice",
        summary: `Squad /${command}`,
      },
    }),
  );
  return {
    kind: "success",
    text: "Squad 请求已交给当前 Agent / Request queued for the current Agent.",
  };
}

async function listPeers(
  squad: SquadService,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  if (invocation.rawInput.trim().length > 0) {
    return { kind: "error", text: "用法 / Usage: /squad-peers" };
  }
  if (invocation.signal.aborted) {
    return { kind: "error", text: "命令已取消 / Command cancelled." };
  }
  const peers = await squad.listPeers();
  const text =
    peers.length === 0
      ? "尚未配对 Squad 成员 / No Squad peers are paired."
      : [
          `Squad 成员 / Peers (${peers.length})`,
          ...peers.map(
            (peer) =>
              `- ${peer.displayName} (${peer.nodeId}): ${
                peer.enabled && peer.policy.canDelegate
                  ? "可委派 / delegation allowed"
                  : "不可委派 / delegation unavailable"
              }; ${autoExecuteLabels[peer.policy.autoExecute]}`,
          ),
        ].join("\n");
  const names = peers.map(({ displayName }) => displayName).join(", ");
  const rawSummary =
    peers.length === 0
      ? "squad-peers — 尚未配对成员 / No paired peers"
      : `squad-peers — Squad 成员 / Peers (${peers.length}): ${names}`;
  const summary =
    rawSummary.length <= 120 ? rawSummary : `${rawSummary.slice(0, 119)}…`;
  const source = invocation.agent.session.append(
    "user/message",
    createUserMessage({
      content: [{ type: "text", text }],
      source: {
        kind: "plugin",
        plugin: "@dsh-squad/plugin",
        form: "notice",
        summary,
      },
    }),
    { surfaceOp: "append" },
  );
  return {
    kind: "success",
    text,
    sourceEventSeq: source.seq,
  };
}

export function registerSquadCommands(
  ctx: Context,
  squad: SquadService,
): Array<() => void> {
  const definitions: CommandDefinition[] = [
    {
      name: "squad-plan",
      description: "创建团队分工草案 / Create a reviewable team plan",
      input: { hint: "<team goal or meeting notes>" },
      recordInput: false,
      handler: (invocation) => routeToAgent("squad-plan", invocation),
    },
    {
      name: "squad-task",
      description: "向成员委派单项任务 / Delegate one task to a peer",
      input: { hint: "<@member and objective>" },
      recordInput: false,
      handler: (invocation) => routeToAgent("squad-task", invocation),
    },
    {
      name: "squad-peers",
      description: "查看已配对成员 / List paired Squad peers",
      handler: (invocation) => listPeers(squad, invocation),
    },
    {
      name: "squad-status",
      description: "查询委派进度或结果 / Check delegation status",
      input: { hint: "[delegation ID or question]" },
      recordInput: false,
      handler: (invocation) => routeToAgent("squad-status", invocation),
    },
  ];
  return definitions.map((definition) => ctx.commands.register(definition));
}
