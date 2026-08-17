import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-commands";
import type {} from "@deepseek-ai/dsh-host-webserver";
import { registerSquadCommands } from "./commands.ts";
import { resolveConfig, type SquadConfig } from "./config.ts";
import { createHttpHandler } from "./http.ts";
import { SquadService } from "./service.ts";
import { registerSquadTools } from "./tools.ts";

export const name = "dsh-squad";
export const inject = [
  "agents",
  "agentDefaultModel",
  "agentPresets",
  "commands",
  "sessionPersistence",
  "tools",
  "webServer",
];

export async function apply(
  ctx: Context,
  config: SquadConfig = {},
): Promise<() => Promise<void>> {
  const squad = new SquadService(ctx, resolveConfig(config));
  const disposeTools = registerSquadTools(ctx, squad);
  const disposeCommands = registerSquadCommands(ctx, squad);
  const disposeRoute = ctx.webServer.register({
    kind: "prefix",
    path: "/squad/v1",
    handler: createHttpHandler(squad),
  });
  try {
    await squad.start();
  } catch (error) {
    disposeRoute();
    for (const dispose of disposeCommands.reverse()) dispose();
    for (const dispose of disposeTools.reverse()) dispose();
    await squad.close();
    throw error;
  }
  return async () => {
    disposeRoute();
    for (const dispose of disposeCommands.reverse()) dispose();
    for (const dispose of disposeTools.reverse()) dispose();
    await squad.close();
  };
}

export type { SquadConfig } from "./config.ts";
export type { DelegationView, HumanInput } from "./service.ts";
export { SquadService } from "./service.ts";
