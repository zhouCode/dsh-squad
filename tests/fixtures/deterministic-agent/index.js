import { randomUUID } from "node:crypto";
import { CallId, LlmAdapter } from "@deepseek-ai/dsh-llm";

const PROVIDER = "squad-fixture";
const MODEL = "deterministic";
const SKILL_NAME = "squad-count-items";
const SKILL_MARKER = "SQUAD_FIXTURE_SKILL_LOADED";

function textOf(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).join("\n");
  if (value === null || typeof value !== "object") return "";
  if (value.type === "text" && typeof value.text === "string")
    return value.text;
  return Object.values(value).map(textOf).join("\n");
}

function latestOwnerPrompt(options) {
  const messages = options.messages;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.source?.kind === "user") {
      return {
        index,
        text: textOf(message.content),
        tail: messages.slice(index + 1),
      };
    }
  }
  return undefined;
}

function latestSquadPrompt(options) {
  const messages = options.messages;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const content = textOf(message?.content);
    if (
      message?.source?.kind === "plugin" &&
      (content.includes("You are handling a task delegated") ||
        content.includes("The local owner supplied"))
    ) {
      return { index, text: content, tail: messages.slice(index + 1) };
    }
  }
  return undefined;
}

function calledTool(messages, name) {
  return messages.some((message) =>
    message.content?.some(
      (block) => block.type === "tool-call" && block.name === name,
    ),
  );
}

async function* finishText(text) {
  yield { type: "block-start", index: 0, blockType: "text" };
  yield { type: "text-delta", index: 0, text };
  yield { type: "block-end", index: 0, block: { type: "text", text } };
  yield {
    type: "usage",
    usage: { inputTokens: 1, outputTokens: 1 },
  };
  yield { type: "finish", reason: { kind: "stop" } };
}

async function* callTool(name, args) {
  const id = CallId(`squad-fixture-${randomUUID()}`);
  const serialized = JSON.stringify(args);
  yield { type: "block-start", index: 0, blockType: "tool-call" };
  yield {
    type: "tool-call-delta",
    index: 0,
    id,
    name,
    argumentsDelta: serialized,
  };
  yield {
    type: "block-end",
    index: 0,
    block: { type: "tool-call", id, name, arguments: serialized },
  };
  yield {
    type: "usage",
    usage: { inputTokens: 1, outputTokens: 1 },
  };
  yield { type: "finish", reason: { kind: "tool-calls" } };
}

function toolNames(options) {
  return new Set((options.tools ?? []).map((tool) => tool.name));
}

function nodeIdFrom(text) {
  return text.match(/node_[A-Za-z0-9_-]{43}/u)?.[0];
}

function ownerDelegationArgs(prompt) {
  const to = nodeIdFrom(prompt);
  if (to === undefined)
    throw new Error("fixture prompt is missing the target nodeId");
  if (prompt.includes("HUMAN_HANDOFF_FIXTURE")) {
    return {
      to,
      objective: "HUMAN_HANDOFF_FIXTURE prepare the owner-approved release",
      context: "The receiver must ask for two independent local approvals.",
      acceptanceCriteria: [
        "Resume the original native DSH session after both approvals.",
      ],
    };
  }
  return {
    to,
    objective: "AUTO_SKILL_FIXTURE count the supplied line items",
    context: "alpha\nbeta\ngamma",
    acceptanceCriteria: [
      "Return the count and prove the receiver-local Skill was loaded.",
    ],
  };
}

class DeterministicAgentAdapter extends LlmAdapter {
  providerInfo(provider) {
    return { id: provider, name: "Squad deterministic acceptance fixture" };
  }

  listModels() {
    return Promise.resolve([
      { provider: PROVIDER, id: MODEL, name: "Deterministic acceptance model" },
    ]);
  }

  async *stream(options) {
    options.signal?.throwIfAborted();
    if (options.purpose === "session-title") {
      yield* finishText("Squad acceptance");
      return;
    }

    const tools = toolNames(options);
    if (tools.has("squad_publish_outcome")) {
      const squadPrompt = latestSquadPrompt(options);
      if (squadPrompt === undefined) {
        yield* finishText("No Squad delegation prompt was found.");
        return;
      }
      if (calledTool(squadPrompt.tail, "squad_publish_outcome")) {
        yield* finishText("The structured Squad outcome was published.");
        return;
      }
      if (squadPrompt.text.includes("The local owner supplied")) {
        yield* callTool("squad_publish_outcome", {
          kind: "COMPLETE",
          summary:
            "Both owner approvals were received in the original DSH session.",
          outputs: [
            {
              type: "text",
              content: "same-session-resume: complete",
            },
          ],
        });
        return;
      }

      const hasSkillResult = textOf(squadPrompt.tail).includes(SKILL_MARKER);
      if (!hasSkillResult) {
        yield* callTool("skill", { name: SKILL_NAME });
        return;
      }
      if (squadPrompt.text.includes("HUMAN_HANDOFF_FIXTURE")) {
        yield* callTool("squad_publish_outcome", {
          kind: "HANDOFF",
          completedSummary: `Receiver-local Skill ${SKILL_NAME} loaded before handoff.`,
          todos: [
            {
              title: "Approve release notes",
              instructions: "Confirm the public summary may be shared.",
              blockingReason: "Only the local owner can approve publication.",
            },
            {
              title: "Approve release window",
              instructions: "Confirm the deployment window.",
              blockingReason: "Only the local owner controls scheduling.",
            },
          ],
        });
        return;
      }
      yield* callTool("squad_publish_outcome", {
        kind: "COMPLETE",
        summary: `Counted three items with receiver-local Skill ${SKILL_NAME}.`,
        outputs: [
          {
            type: "text",
            content: `${SKILL_MARKER}; count=3`,
          },
        ],
      });
      return;
    }

    if (tools.has("delegate_to_agent")) {
      const ownerPrompt = latestOwnerPrompt(options);
      if (ownerPrompt !== undefined) {
        const alreadyDelegated = textOf(ownerPrompt.tail).includes(
          "delegation ",
        );
        if (!alreadyDelegated) {
          yield* callTool(
            "delegate_to_agent",
            ownerDelegationArgs(ownerPrompt.text),
          );
          return;
        }
      }
      yield* finishText(
        "The delegation was queued for the paired Personal Agent.",
      );
      return;
    }

    yield* finishText("Squad deterministic fixture ready.");
  }
}

export const name = "squad-deterministic-agent-fixture";
export const inject = ["llm"];

export function apply(ctx) {
  return ctx.llm.registerAdapter([PROVIDER], new DeterministicAgentAdapter());
}
