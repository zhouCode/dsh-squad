import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type {
  CommandDefinition,
  CommandInvocation,
} from "@deepseek-ai/dsh-commands";
import { describe, expect, it, vi } from "vitest";
import type { SquadService } from "./service.ts";
import { registerSquadCommands, SQUAD_COMMAND_NAMES } from "./commands.ts";

function commandHarness(peers: Awaited<ReturnType<SquadService["listPeers"]>>) {
  const definitions: CommandDefinition[] = [];
  const disposers = SQUAD_COMMAND_NAMES.map(() => vi.fn());
  const register = vi.fn((definition: CommandDefinition) => {
    definitions.push(definition);
    const disposer = disposers[definitions.length - 1];
    if (disposer === undefined) throw new Error("missing disposer");
    return disposer;
  });
  const ctx = { commands: { register } } as unknown as Context;
  const squad = {
    listPeers: vi.fn().mockResolvedValue(peers),
  } as unknown as SquadService;
  const returnedDisposers = registerSquadCommands(ctx, squad);
  return { definitions, disposers, register, returnedDisposers, squad };
}

function invocation(
  rawInput: string,
  followup = vi.fn(),
  append = vi.fn().mockReturnValue({ seq: 41 }),
): CommandInvocation {
  return {
    commandId: "test-command" as CommandInvocation["commandId"],
    agent: { followup, session: { append } } as unknown as Agent,
    rawInput,
    signal: new AbortController().signal,
  };
}

describe("Squad slash commands", () => {
  it("registers only the namespaced English command names", () => {
    const harness = commandHarness([]);
    expect(harness.definitions.map(({ name }) => name)).toEqual(
      SQUAD_COMMAND_NAMES,
    );
    expect(harness.returnedDisposers).toEqual(harness.disposers);
    expect(
      harness.definitions
        .filter(({ name }) => name !== "squad-peers")
        .every(({ recordInput }) => recordInput === false),
    ).toBe(true);
  });

  it("routes a task command to the current Agent with safe tool guidance", async () => {
    const harness = commandHarness([]);
    const command = harness.definitions.find(
      ({ name }) => name === "squad-task",
    );
    if (command === undefined) throw new Error("missing squad-task command");
    const followup = vi.fn();

    const result = await Promise.resolve(
      command.handler(invocation(" @Bob 整理本周发布说明 ", followup)),
    );
    expect(result).toMatchObject({ kind: "success" });
    expect(followup).toHaveBeenCalledOnce();
    const message = followup.mock.calls[0]?.[0];
    expect(message).toMatchObject({
      role: "user",
      source: {
        kind: "plugin",
        plugin: "@dsh-squad/plugin",
        form: "notice",
      },
    });
    expect(message?.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("@Bob 整理本周发布说明"),
    });
    expect(message?.content[0]).toMatchObject({
      text: expect.stringContaining("delegate_to_agent exactly once"),
    });
  });

  it("keeps team planning as an approval-required draft", async () => {
    const harness = commandHarness([]);
    const command = harness.definitions.find(
      ({ name }) => name === "squad-plan",
    );
    if (command === undefined) throw new Error("missing squad-plan command");
    const followup = vi.fn();

    await command.handler(invocation("根据会议纪要安排工作", followup));
    const text = followup.mock.calls[0]?.[0]?.content[0];
    expect(text).toMatchObject({
      type: "text",
      text: expect.stringContaining("propose_team_plan"),
    });
    expect(text).toMatchObject({
      text: expect.stringContaining("Do not call delegate_to_agent"),
    });
  });

  it("rejects an empty task instead of guessing", async () => {
    const harness = commandHarness([]);
    const command = harness.definitions.find(
      ({ name }) => name === "squad-task",
    );
    if (command === undefined) throw new Error("missing squad-task command");
    const followup = vi.fn();

    const result = await Promise.resolve(
      command.handler(invocation("  ", followup)),
    );
    expect(result).toEqual(expect.objectContaining({ kind: "error" }));
    expect(followup).not.toHaveBeenCalled();
  });

  it("lists paired peers directly without waking the model", async () => {
    const harness = commandHarness([
      {
        nodeId: "node_bob",
        displayName: "Bob",
        publicKey: "public-key",
        enabled: true,
        policy: {
          canMessage: false,
          canDelegate: true,
          autoExecute: "SAFE",
          maxConcurrent: 1,
          maxDelegationDepth: 1,
          maxRuntimeMinutes: 30,
        },
        createdAt: "2026-08-17T00:00:00.000Z",
        updatedAt: "2026-08-17T00:00:00.000Z",
      },
    ]);
    const command = harness.definitions.find(
      ({ name }) => name === "squad-peers",
    );
    if (command === undefined) throw new Error("missing squad-peers command");
    const append = vi.fn().mockReturnValue({ seq: 41 });

    const result = await Promise.resolve(
      command.handler(invocation("", vi.fn(), append)),
    );
    expect(result).toMatchObject({
      kind: "success",
      text: expect.stringContaining("Bob (node_bob)"),
      sourceEventSeq: 41,
    });
    expect(result).toMatchObject({
      text: expect.stringContaining("安全目标自动执行"),
    });
    expect(harness.squad.listPeers).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledWith(
      "user/message",
      expect.objectContaining({
        role: "user",
        content: [
          expect.objectContaining({
            type: "text",
            text: expect.stringContaining("Bob (node_bob)"),
          }),
        ],
        source: expect.objectContaining({
          kind: "plugin",
          plugin: "@dsh-squad/plugin",
          form: "notice",
          summary: expect.stringContaining("Bob"),
        }),
      }),
      { surfaceOp: "append" },
    );
  });
});
