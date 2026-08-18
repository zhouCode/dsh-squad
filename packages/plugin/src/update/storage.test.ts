import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UpdateStore } from "./storage.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("update state storage", () => {
  it("creates private state and persists explicit policy/request state", async () => {
    const root = await mkdtemp(join(tmpdir(), "squad-update-store-"));
    temporaryDirectories.push(root);
    const store = new UpdateStore(join(root, "state"));
    await store.initialize();
    expect((await stat(store.stateDir)).mode & 0o777).toBe(0o700);
    expect((await store.policy("NOTIFY")).mode).toBe("NOTIFY");
    await store.writePolicy({
      schemaVersion: 1,
      mode: "AUTOMATIC",
      updatedAt: "2026-08-19T00:00:00.000Z",
    });
    await store.writeRequest({
      schemaVersion: 1,
      requestedAt: "2026-08-19T00:00:00.000Z",
      requestedVersion: "0.6.0",
    });
    expect((await store.readPolicy())?.mode).toBe("AUTOMATIC");
    expect((await store.readRequest())?.requestedVersion).toBe("0.6.0");
    expect((await stat(store.policyPath)).mode & 0o777).toBe(0o600);
    await store.clearRequest();
    expect(await store.readRequest()).toBeUndefined();
  });
});
