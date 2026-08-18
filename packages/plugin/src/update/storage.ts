import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { ZodType } from "zod";
import {
  updateAutomationSchema,
  updatePolicySchema,
  updateRequestSchema,
  updateStatusSchema,
  type UpdateAutomation,
  type UpdateMode,
  type UpdatePolicy,
  type UpdateRequest,
  type UpdateStatus,
} from "../shared/updates.ts";

export const UPDATE_POLICY_FILE = "update-policy.json";
export const UPDATE_STATUS_FILE = "update-status.json";
export const UPDATE_REQUEST_FILE = "update-request.json";
export const UPDATE_AUTOMATION_FILE = "automation.json";

async function readDocument<T>(
  path: string,
  schema: ZodType<T>,
): Promise<T | undefined> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`${path} must be a regular file`);
    }
    if (metadata.size > 256 * 1024) {
      throw new Error(`${path} exceeds the update state size limit`);
    }
    return schema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

export async function atomicWriteJson(
  path: string,
  value: unknown,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

export class UpdateStore {
  readonly stateDir: string;
  readonly policyPath: string;
  readonly statusPath: string;
  readonly requestPath: string;
  readonly automationPath: string;
  readonly lockPath: string;

  constructor(stateDir: string) {
    this.stateDir = resolve(stateDir);
    this.policyPath = join(this.stateDir, UPDATE_POLICY_FILE);
    this.statusPath = join(this.stateDir, UPDATE_STATUS_FILE);
    this.requestPath = join(this.stateDir, UPDATE_REQUEST_FILE);
    this.automationPath = join(this.stateDir, UPDATE_AUTOMATION_FILE);
    this.lockPath = join(this.stateDir, "update.lock");
  }

  async initialize(): Promise<void> {
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    const metadata = await lstat(this.stateDir);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("Squad update stateDir must be a real directory");
    }
    await chmod(this.stateDir, 0o700);
  }

  async policy(defaultMode: UpdateMode): Promise<UpdatePolicy> {
    const existing = await readDocument(this.policyPath, updatePolicySchema);
    if (existing !== undefined) return existing;
    const created: UpdatePolicy = {
      schemaVersion: 1,
      mode: defaultMode,
      updatedAt: new Date().toISOString(),
    };
    await this.writePolicy(created);
    return created;
  }

  readPolicy(): Promise<UpdatePolicy | undefined> {
    return readDocument(this.policyPath, updatePolicySchema);
  }

  async writePolicy(policy: UpdatePolicy): Promise<void> {
    await atomicWriteJson(this.policyPath, updatePolicySchema.parse(policy));
  }

  readStatus(): Promise<UpdateStatus | undefined> {
    return readDocument(this.statusPath, updateStatusSchema);
  }

  async writeStatus(status: UpdateStatus): Promise<void> {
    await atomicWriteJson(this.statusPath, updateStatusSchema.parse(status));
  }

  readRequest(): Promise<UpdateRequest | undefined> {
    return readDocument(this.requestPath, updateRequestSchema);
  }

  async writeRequest(request: UpdateRequest): Promise<void> {
    await atomicWriteJson(this.requestPath, updateRequestSchema.parse(request));
  }

  async clearRequest(): Promise<void> {
    await rm(this.requestPath, { force: true });
  }

  readAutomation(): Promise<UpdateAutomation | undefined> {
    return readDocument(this.automationPath, updateAutomationSchema);
  }

  async writeAutomation(automation: UpdateAutomation): Promise<void> {
    await atomicWriteJson(
      this.automationPath,
      updateAutomationSchema.parse(automation),
    );
  }

  async isUpdateLocked(): Promise<boolean> {
    try {
      await lstat(this.lockPath);
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return false;
      }
      throw error;
    }
  }
}
