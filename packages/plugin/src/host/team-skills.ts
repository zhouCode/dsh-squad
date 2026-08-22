import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type {
  SkillCandidate,
  SkillDefinition,
  SkillLookupOptions,
  SkillProvider,
  SkillProviderControl,
} from "@deepseek-ai/dsh-skill";
import { canonicalBytes, sha256Hex } from "../shared/canonical.ts";
import {
  MAX_TEAM_SKILL_FILES,
  MAX_TEAM_SKILL_UNPACKED_BYTES,
  TEAM_SKILL_PROTOCOL_VERSION,
  teamSkillBundleSchema,
  teamSkillNameSchema,
  type PublishableSkillView,
  type TeamSkillActivation,
  type TeamSkillBundle,
  type TeamSkillRelease,
} from "../shared/team-skills.ts";
import type { SquadDatabase, TeamSkillInstallationRecord } from "./database.ts";
import { verifySignature } from "./identity.ts";

export const TEAM_SKILL_PROVIDER_NAME = "squad-team-skills";
export const TEAM_SKILL_PROVIDER_RANK = 700;

const SECRET_FILE_NAMES = new Set([
  ".env",
  ".npmrc",
  ".pypirc",
  "credentials",
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
]);

export interface TeamSkillBundleMetrics {
  bytes: Buffer;
  sha256: string;
  bundleSize: number;
  fileCount: number;
  unpackedSize: number;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw signal.reason;
}

function decodedFile(file: TeamSkillBundle["files"][number]): Buffer {
  const decoded = Buffer.from(file.contentBase64, "base64");
  if (decoded.toString("base64") !== file.contentBase64) {
    throw new Error(`team Skill resource ${file.path} has invalid base64`);
  }
  return decoded;
}

export function measureTeamSkillBundle(
  bundleCandidate: TeamSkillBundle,
): TeamSkillBundleMetrics {
  const bundle = teamSkillBundleSchema.parse(bundleCandidate);
  const seen = new Set<string>();
  let unpackedSize = Buffer.byteLength(bundle.content, "utf8");
  for (const file of bundle.files) {
    if (seen.has(file.path)) {
      throw new Error(`team Skill bundle contains duplicate path ${file.path}`);
    }
    seen.add(file.path);
    unpackedSize += decodedFile(file).byteLength;
    if (unpackedSize > MAX_TEAM_SKILL_UNPACKED_BYTES) {
      throw new Error("team Skill bundle exceeds the unpacked size limit");
    }
  }
  const bytes = canonicalBytes(bundle);
  return {
    bytes,
    sha256: sha256Hex(bytes),
    bundleSize: bytes.byteLength,
    fileCount: bundle.files.length + 1,
    unpackedSize,
  };
}

export function verifyTeamSkillRelease(
  release: TeamSkillRelease,
  bundle: TeamSkillBundle,
  publisherPublicKey: string,
): void {
  const metrics = measureTeamSkillBundle(bundle);
  assertSafeResource("SKILL.md", Buffer.from(bundle.content, "utf8"));
  for (const file of bundle.files) {
    assertSafeResource(file.path, decodedFile(file));
  }
  if (
    metrics.sha256 !== release.bundleSha256 ||
    metrics.bundleSize !== release.bundleSize ||
    metrics.fileCount !== release.fileCount ||
    metrics.unpackedSize !== release.unpackedSize
  ) {
    throw new Error("team Skill bundle does not match its signed release");
  }
  const { signature: _signature, ...unsigned } = release;
  if (!verifySignature(unsigned, release.signature, publisherPublicKey)) {
    throw new Error("team Skill release signature is invalid");
  }
}

function assertSafeResource(relativePath: string, content: Buffer): void {
  const leaf = basename(relativePath).toLowerCase();
  if (
    SECRET_FILE_NAMES.has(leaf) ||
    leaf.endsWith(".pem") ||
    leaf.endsWith(".key") ||
    leaf.includes("credential") ||
    leaf.includes("secret")
  ) {
    throw new Error(`refusing to publish secret-like resource ${relativePath}`);
  }
  const text = content.toString("utf8");
  if (/-----BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----/u.test(text)) {
    throw new Error(`refusing to publish private key data in ${relativePath}`);
  }
}

function collectResources(directory: string): TeamSkillBundle["files"] {
  const root = resolve(directory);
  const files: TeamSkillBundle["files"][number][] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if ([".git", "node_modules", "__pycache__"].includes(entry.name)) {
        continue;
      }
      const path = join(current, entry.name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        throw new Error(
          `team Skill resources cannot contain symlink ${entry.name}`,
        );
      }
      if (stat.isDirectory()) {
        visit(path);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(
          `team Skill resources must be regular files: ${entry.name}`,
        );
      }
      const relativePath = relative(root, path).split(sep).join("/");
      if (relativePath === "SKILL.md") continue;
      const content = readFileSync(path);
      assertSafeResource(relativePath, content);
      files.push({
        path: relativePath,
        contentBase64: content.toString("base64"),
      });
      if (files.length > MAX_TEAM_SKILL_FILES) {
        throw new Error("team Skill bundle contains too many resources");
      }
    }
  };
  visit(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function invocationFor(
  activation: TeamSkillActivation,
  delegated: boolean,
): { modelInvocable: boolean; userInvocable: boolean } {
  return {
    userInvocable: activation !== "DISABLED",
    modelInvocable:
      activation === "DELEGATION" || (activation === "LOCAL" && !delegated),
  };
}

export class TeamSkillManager {
  readonly #delegationScopes = new WeakSet<object>();
  readonly #releasesDirectory: string;
  #control: SkillProviderControl | undefined;

  constructor(
    private readonly ctx: Context,
    private readonly database: SquadDatabase,
    dataDirectory: string,
  ) {
    this.#releasesDirectory = join(dataDirectory, "team-skills", "releases");
    mkdirSync(this.#releasesDirectory, { recursive: true, mode: 0o700 });
  }

  provider(control: SkillProviderControl): SkillProvider {
    this.#control = control;
    return {
      name: TEAM_SKILL_PROVIDER_NAME,
      list: (options) => this.list(options),
      get: (candidate, options) => this.get(candidate, options),
    };
  }

  invalidate(): void {
    this.#control?.invalidate();
  }

  markDelegationScope(scope: object): void {
    this.#delegationScopes.add(scope);
    this.invalidate();
  }

  private isDelegationLookup(options: SkillLookupOptions): boolean {
    const scope = (options as SkillLookupOptions & { scope?: object }).scope;
    return scope !== undefined && this.#delegationScopes.has(scope);
  }

  private candidateFor(
    installation: TeamSkillInstallationRecord,
    delegated: boolean,
  ): SkillCandidate {
    const { release } = installation;
    return {
      name: installation.localName,
      description: release.description,
      ...(release.whenToUse === undefined
        ? {}
        : { whenToUse: release.whenToUse }),
      invocation: invocationFor(installation.activation, delegated),
      source: "squad-team",
      provider: TEAM_SKILL_PROVIDER_NAME,
      rank: TEAM_SKILL_PROVIDER_RANK,
      locator: release.releaseId,
      path: join(installation.installPath, "SKILL.md"),
      resourceBase: { kind: "directory", path: installation.installPath },
      metadata: {
        organizationId: release.organizationId,
        releaseId: release.releaseId,
        version: release.skillVersion,
      },
    };
  }

  async list(options: SkillLookupOptions): Promise<readonly SkillCandidate[]> {
    assertNotAborted(options.signal);
    const delegated = this.isDelegationLookup(options);
    return this.database
      .listTeamSkillInstallations()
      .filter((installation) => installation.activation !== "DISABLED")
      .map((installation) => this.candidateFor(installation, delegated));
  }

  async get(
    candidate: SkillCandidate,
    options: SkillLookupOptions,
  ): Promise<SkillDefinition | undefined> {
    assertNotAborted(options.signal);
    if (candidate.provider !== TEAM_SKILL_PROVIDER_NAME) return undefined;
    const releaseId =
      typeof candidate.locator === "string" ? candidate.locator : "";
    const installation = this.database.findTeamSkillInstallation(releaseId);
    if (
      installation === undefined ||
      installation.activation === "DISABLED" ||
      installation.localName !== candidate.name
    ) {
      return undefined;
    }
    const current = this.candidateFor(
      installation,
      this.isDelegationLookup(options),
    );
    if (
      !current.invocation.userInvocable &&
      !current.invocation.modelInvocable
    ) {
      return undefined;
    }
    const path = join(installation.installPath, "SKILL.md");
    const content = readFileSync(path, "utf8");
    assertNotAborted(options.signal);
    return {
      name: current.name,
      description: current.description,
      ...(current.whenToUse === undefined
        ? {}
        : { whenToUse: current.whenToUse }),
      invocation: current.invocation,
      source: current.source,
      provider: current.provider,
      path,
      ...(current.resourceBase === undefined
        ? {}
        : { resourceBase: current.resourceBase }),
      ...(current.metadata === undefined ? {} : { metadata: current.metadata }),
      content,
    };
  }

  async publishableSkills(): Promise<PublishableSkillView[]> {
    const skills = await this.ctx.skills.list();
    return skills
      .filter((skill) => skill.provider !== TEAM_SKILL_PROVIDER_NAME)
      .map((skill) => ({
        name: skill.name,
        description: skill.description,
        ...(skill.whenToUse === undefined
          ? {}
          : { whenToUse: skill.whenToUse }),
        source: skill.source,
        provider: skill.provider,
      }));
  }

  async bundleSource(sourceNameCandidate: string): Promise<{
    definition: SkillDefinition;
    bundle: TeamSkillBundle;
    metrics: TeamSkillBundleMetrics;
  }> {
    const sourceName = teamSkillNameSchema.parse(sourceNameCandidate);
    const definition = await this.ctx.skills.get(sourceName);
    if (definition === undefined)
      throw new Error(`native Skill ${sourceName} was not found`);
    if (definition.provider === TEAM_SKILL_PROVIDER_NAME) {
      throw new Error(
        "publish from the original native Skill, not an installed team copy",
      );
    }
    assertSafeResource("SKILL.md", Buffer.from(definition.content, "utf8"));
    let files: TeamSkillBundle["files"] = [];
    if (
      definition.path !== undefined &&
      definition.resourceBase?.kind === "directory" &&
      basename(definition.path) === "SKILL.md" &&
      resolve(dirname(definition.path)) ===
        resolve(definition.resourceBase.path)
    ) {
      files = collectResources(definition.resourceBase.path);
    }
    const bundle = teamSkillBundleSchema.parse({
      version: TEAM_SKILL_PROTOCOL_VERSION,
      content: definition.content,
      files,
    });
    return { definition, bundle, metrics: measureTeamSkillBundle(bundle) };
  }

  assertInstallNameAvailable(
    localNameCandidate: string,
    release: TeamSkillRelease,
  ): void {
    const localName = teamSkillNameSchema.parse(localNameCandidate);
    const collision = this.database
      .listTeamSkillInstallations()
      .find(
        (installation) =>
          installation.localName === localName &&
          (installation.release.organizationId !== release.organizationId ||
            installation.release.skillName !== release.skillName),
      );
    if (collision !== undefined) {
      throw new Error(
        `local team Skill name ${localName} is already installed`,
      );
    }
  }

  async assertNoNativeCollision(localNameCandidate: string): Promise<void> {
    const localName = teamSkillNameSchema.parse(localNameCandidate);
    const collision = (await this.ctx.skills.list()).find(
      (skill) =>
        skill.name === localName && skill.provider !== TEAM_SKILL_PROVIDER_NAME,
    );
    if (collision !== undefined) {
      throw new Error(
        `local name ${localName} conflicts with native Skill from ${collision.provider}`,
      );
    }
  }

  materialize(
    release: TeamSkillRelease,
    bundleCandidate: TeamSkillBundle,
  ): string {
    const bundle = teamSkillBundleSchema.parse(bundleCandidate);
    const metrics = measureTeamSkillBundle(bundle);
    if (metrics.sha256 !== release.bundleSha256) {
      throw new Error("team Skill materialization received the wrong bundle");
    }
    const target = join(
      this.#releasesDirectory,
      `${release.releaseId}-${release.bundleSha256.slice(0, 12)}`,
    );
    if (existsSync(target)) {
      const stored = teamSkillBundleSchema.parse(
        JSON.parse(
          readFileSync(join(target, "bundle.json"), "utf8"),
        ) as unknown,
      );
      if (measureTeamSkillBundle(stored).sha256 !== release.bundleSha256) {
        throw new Error("cached team Skill release is corrupted");
      }
      return target;
    }
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    mkdirSync(temporary, { recursive: true, mode: 0o700 });
    try {
      writeFileSync(join(temporary, "SKILL.md"), bundle.content, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      for (const file of bundle.files) {
        const path = resolve(temporary, file.path);
        if (!path.startsWith(`${resolve(temporary)}${sep}`)) {
          throw new Error(`unsafe team Skill path ${file.path}`);
        }
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        writeFileSync(path, decodedFile(file), { mode: 0o600, flag: "wx" });
      }
      writeFileSync(
        join(temporary, "bundle.json"),
        `${JSON.stringify(bundle)}\n`,
        {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        },
      );
      renameSync(temporary, target);
      chmodSync(target, 0o700);
      return target;
    } catch (error) {
      rmSync(temporary, { recursive: true, force: true });
      throw error;
    }
  }
}
