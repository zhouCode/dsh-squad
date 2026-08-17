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
  "squad-orgs",
  "squad-org",
  "squad-members",
  "squad-invite",
  "squad-role",
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
    "Resolve @name or a display name against the current Session organization, or direct Peers when no organization is selected; call list_squad_peers when needed.",
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
  const { organization, members: peers } = await squad.listRecipients(
    invocation.agent.id,
  );
  const text =
    peers.length === 0
      ? organization === undefined
        ? "尚未配对 Squad 成员 / No Squad peers are paired."
        : `组织 ${organization.name} 暂无其他活动成员 / No other active members in ${organization.name}.`
      : [
          organization === undefined
            ? `Squad 直接对等方 / Direct Peers (${peers.length})`
            : `${organization.name} · Squad 成员 / Members (${peers.length})`,
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

function appendNotice(
  invocation: CommandInvocation,
  text: string,
  summary: string,
): CommandResult {
  const source = invocation.agent.session.append(
    "user/message",
    createUserMessage({
      content: [{ type: "text", text }],
      source: {
        kind: "plugin",
        plugin: "@dsh-squad/plugin",
        form: "notice",
        summary: summary.length <= 120 ? summary : `${summary.slice(0, 119)}…`,
      },
    }),
    { surfaceOp: "append" },
  );
  return { kind: "success", text, sourceEventSeq: source.seq };
}

async function listOrganizations(
  squad: SquadService,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  if (invocation.rawInput.trim().length > 0) {
    return { kind: "error", text: "用法 / Usage: /squad-orgs" };
  }
  const organizations = await squad.listOrganizations();
  const current = squad.sessionOrganization(invocation.agent.id);
  const text =
    organizations.length === 0
      ? "当前节点尚未加入组织 / This Node has not joined an organization."
      : [
          `Squad 组织 / Organizations (${organizations.length})`,
          ...organizations.map(
            (organization) =>
              `- ${current?.organizationId === organization.organizationId ? "● " : ""}${organization.name} (${organization.organizationId}): ${organization.role ?? "PENDING"} · ${organization.membershipStatus}`,
          ),
        ].join("\n");
  return appendNotice(
    invocation,
    text,
    "squad-orgs — Squad 组织 / Organizations",
  );
}

async function selectOrganization(
  squad: SquadService,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const selector = invocation.rawInput.trim();
  if (selector.length === 0) {
    return {
      kind: "error",
      text: "用法 / Usage: /squad-org <organization name, ID, or direct>",
    };
  }
  const direct = ["direct", "none", "clear"].includes(selector.toLowerCase());
  await squad.selectSessionOrganization(
    invocation.agent.id,
    direct ? undefined : selector,
  );
  const selected = squad.sessionOrganization(invocation.agent.id);
  const text =
    selected === undefined
      ? "当前 Session 已切换到直接 Peer / Current Session now uses direct Peers."
      : `当前 Session 已切换到 ${selected.name} (${selected.organizationId}) / Session organization selected.`;
  return appendNotice(
    invocation,
    text,
    `squad-org — ${selected?.name ?? "direct"}`,
  );
}

async function listMembers(
  squad: SquadService,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  if (invocation.rawInput.trim().length > 0) {
    return { kind: "error", text: "用法 / Usage: /squad-members" };
  }
  const organization = squad.sessionOrganization(invocation.agent.id);
  if (organization === undefined) {
    return {
      kind: "error",
      text: "当前 Session 未选择组织；请先使用 /squad-org。 / Select an organization with /squad-org first.",
    };
  }
  const text = [
    `${organization.name} · 成员 / Members (${organization.members.length})`,
    ...organization.members.map(
      (member) =>
        `- ${member.isSelf ? "● " : ""}${member.displayName} (${member.membershipId}): ${member.role} · ${member.status}${member.isSelf ? "" : ` · ${autoExecuteLabels[member.policy.autoExecute]}`}`,
    ),
  ].join("\n");
  return appendNotice(invocation, text, `squad-members — ${organization.name}`);
}

async function createInvitation(
  squad: SquadService,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const organization = squad.sessionOrganization(invocation.agent.id);
  if (organization === undefined) {
    return {
      kind: "error",
      text: "当前 Session 未选择组织；请先使用 /squad-org。 / Select an organization first.",
    };
  }
  const raw = invocation.rawInput.trim();
  const minutes = raw.length === 0 ? 1_440 : Number(raw);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 10_080) {
    return {
      kind: "error",
      text: "用法 / Usage: /squad-invite [expiry minutes: 5-10080]",
    };
  }
  const invitation = await squad.createOrganizationInvitation(
    organization.organizationId,
    minutes,
  );
  return {
    kind: "success",
    text: [
      `一次性组织邀请（请通过安全渠道发送）/ One-time organization invitation:`,
      invitation.invitation,
      `有效期至 / Expires: ${invitation.expiresAt}`,
    ].join("\n"),
  };
}

async function setRole(
  squad: SquadService,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const organization = squad.sessionOrganization(invocation.agent.id);
  if (organization === undefined) {
    return {
      kind: "error",
      text: "当前 Session 未选择组织；请先使用 /squad-org。 / Select an organization first.",
    };
  }
  const match = /^(.*?)\s+(admin|member)$/iu.exec(invocation.rawInput.trim());
  if (match?.[1] === undefined || match[2] === undefined) {
    return {
      kind: "error",
      text: "用法 / Usage: /squad-role <member name or ID> <admin|member>",
    };
  }
  const selector = match[1].trim();
  const candidates = organization.members.filter(
    (member) =>
      member.membershipId === selector ||
      member.nodeId === selector ||
      member.displayName.toLowerCase() === selector.toLowerCase(),
  );
  if (candidates.length !== 1 || candidates[0] === undefined) {
    return {
      kind: "error",
      text:
        candidates.length === 0
          ? `未找到成员 ${selector} / Member not found.`
          : `成员名 ${selector} 不唯一，请使用 membership ID / Ambiguous member name; use membership ID.`,
    };
  }
  const role = match[2].toUpperCase();
  await squad.setOrganizationMemberRole(
    organization.organizationId,
    candidates[0].membershipId,
    role,
  );
  const text = `${candidates[0].displayName} → ${role}`;
  return appendNotice(invocation, text, `squad-role — ${text}`);
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
      description: "查看当前协作范围成员 / List members in the current scope",
      handler: (invocation) => listPeers(squad, invocation),
    },
    {
      name: "squad-status",
      description: "查询委派进度或结果 / Check delegation status",
      input: { hint: "[delegation ID or question]" },
      recordInput: false,
      handler: (invocation) => routeToAgent("squad-status", invocation),
    },
    {
      name: "squad-orgs",
      description: "查看当前节点的组织 / List this Node's organizations",
      handler: (invocation) => listOrganizations(squad, invocation),
    },
    {
      name: "squad-org",
      description: "设置当前 Session 组织 / Select Session organization",
      input: { hint: "<organization name, ID, or direct>" },
      handler: (invocation) => selectOrganization(squad, invocation),
    },
    {
      name: "squad-members",
      description: "查看当前组织成员 / List current organization members",
      handler: (invocation) => listMembers(squad, invocation),
    },
    {
      name: "squad-invite",
      description: "创建一次性组织邀请 / Create one-time organization invite",
      input: { hint: "[expiry minutes]" },
      handler: (invocation) => createInvitation(squad, invocation),
    },
    {
      name: "squad-role",
      description: "任命或撤销 Admin / Appoint or demote an Admin",
      input: { hint: "<member> <admin|member>" },
      handler: (invocation) => setRole(squad, invocation),
    },
  ];
  return definitions.map((definition) => ctx.commands.register(definition));
}
