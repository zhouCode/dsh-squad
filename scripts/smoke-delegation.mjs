import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = join(root, "packages", "plugin");
const fixtureDir = join(root, "tests", "fixtures", "deterministic-agent");
const skillFixture = join(
  root,
  "tests",
  "fixtures",
  "bob-skill",
  "squad-count-items",
);
const artifactsDir = join(root, "artifacts");
const pluginManifest = JSON.parse(
  await readFile(join(pluginDir, "package.json"), "utf8"),
);
const pluginTarball = join(
  artifactsDir,
  `dsh-squad-plugin-${String(pluginManifest.version)}.tgz`,
);
const fixtureTarball = join(
  artifactsDir,
  "dsh-squad-deterministic-agent-fixture-0.0.0.tgz",
);
const keep = process.env.SQUAD_SMOKE_KEEP === "1";

function log(message) {
  process.stdout.write(`[squad smoke] ${message}\n`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(" ")} failed with status ${String(result.status)}`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert(address !== null && typeof address === "object");
  const port = address.port;
  await new Promise((resolveClose, reject) =>
    server.close((error) =>
      error === undefined ? resolveClose() : reject(error),
    ),
  );
  return port;
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

async function waitFor(description, predicate, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value !== undefined && value !== false) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(
    `timed out waiting for ${description}${
      lastError instanceof Error ? `: ${lastError.message}` : ""
    }`,
  );
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(
      `${url} returned non-JSON (${response.status}): ${text.slice(0, 400)}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `${url} returned ${response.status}: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function localState(port) {
  return fetchJson(`http://127.0.0.1:${port}/squad/v1/local/state`);
}

class DshHost {
  constructor(label, home, port) {
    this.label = label;
    this.home = home;
    this.port = port;
    this.output = "";
    this.child = undefined;
    this.exit = undefined;
  }

  async start(expectSquad = true) {
    assert.equal(this.child, undefined, `${this.label} is already running`);
    const child = spawn(
      "pnpm",
      [
        "exec",
        "dsh",
        "web",
        "--host",
        "127.0.0.1",
        "--port",
        String(this.port),
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          DSH_HOME: this.home,
          DSH_TELEMETRY_MODE: "DISABLED",
          DSH_TOOLS_MODE: "native",
        },
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.child = child;
    this.output = "";
    const capture = (chunk) => {
      this.output = `${this.output}${chunk.toString("utf8")}`.slice(-100_000);
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    this.exit = new Promise((resolveExit) => child.once("exit", resolveExit));

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`${this.label} exited during startup\n${this.output}`);
      }
      try {
        if (expectSquad) await localState(this.port);
        else {
          const response = await fetch(`http://127.0.0.1:${this.port}/`);
          if (!response.ok)
            throw new Error(`Harness returned ${response.status}`);
        }
        return;
      } catch {
        await sleep(200);
      }
    }
    throw new Error(`${this.label} did not become ready\n${this.output}`);
  }

  async stop() {
    const child = this.child;
    if (child === undefined) return;
    const signal = (name) => {
      try {
        if (process.platform === "win32") child.kill(name);
        else process.kill(-child.pid, name);
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    };
    if (child.exitCode === null) signal("SIGINT");
    const exited = async (milliseconds) =>
      Promise.race([
        this.exit.then(() => true),
        sleep(milliseconds).then(() => false),
      ]);
    if (!(await exited(8_000))) signal("SIGTERM");
    if (!(await exited(3_000))) signal("SIGKILL");
    await this.exit;
    this.child = undefined;
    this.exit = undefined;
  }
}

async function installProfile(home, withFixture, cacheHome) {
  await mkdir(home, { recursive: true });
  const env = {
    DSH_HOME: home,
    DSH_TELEMETRY_MODE: "DISABLED",
    XDG_CACHE_HOME: cacheHome,
  };
  run(
    "pnpm",
    [
      "exec",
      "dsh",
      "plugin",
      "--profile",
      "web",
      "add",
      pluginTarball,
      "--offline",
    ],
    { env },
  );
  if (withFixture) {
    run(
      "pnpm",
      [
        "exec",
        "dsh",
        "plugin",
        "--profile",
        "web",
        "add",
        fixtureTarball,
        "--offline",
      ],
      { env },
    );
  }
}

async function writePatch(home, config) {
  const path = join(home, "profiles", "web", "cordis.patch.yml");
  await writeFile(
    path,
    `${JSON.stringify([{ id: "dsh-squad", config }], null, 2)}\n`,
  );
}

function nodeConfig(home, displayName, relayUrl, invitation) {
  return {
    dataDir: join(home, "squad"),
    displayName,
    pollIntervalMs: 1_000,
    envelopeTtlMinutes: 60,
    peers: [],
    execution: { cwd: root, safeObjectivePrefixes: [] },
    relay: {
      enabled: false,
      url: relayUrl,
      invitation,
      databasePath: join(home, "squad", "unused-relay.sqlite"),
      invites: [],
      maxMailboxItems: 10_000,
      maxRequestsPerMinute: 2_000,
    },
  };
}

function relayConfig(home, invites) {
  return {
    dataDir: join(home, "squad-node"),
    displayName: "Acceptance Relay",
    pollIntervalMs: 1_000,
    envelopeTtlMinutes: 60,
    peers: [],
    execution: { cwd: root, safeObjectivePrefixes: [] },
    relay: {
      enabled: true,
      databasePath: join(home, "relay", "mailbox.sqlite"),
      invites,
      maxMailboxItems: 10_000,
      maxRequestsPerMinute: 2_000,
    },
  };
}

async function bootstrapIdentity(host) {
  await host.start();
  try {
    return (await localState(host.port)).identity;
  } finally {
    await host.stop();
  }
}

async function chooseWorkspace(page) {
  const chooser = page.getByRole("button", {
    name: "Choose workspace",
    exact: true,
  });
  if (!(await chooser.isVisible().catch(() => false))) return;
  await chooser.click();
  const editPath = page.getByRole("button", {
    name: "Edit path",
    exact: true,
  });
  await editPath.waitFor({ state: "visible" });
  await editPath.click();
  const pathInput = page.getByRole("textbox", {
    name: "Edit path",
    exact: true,
  });
  await pathInput.fill(root);
  await pathInput.press("Enter");
  await pathInput.waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: basename(root), exact: true })
    .last()
    .waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Open", exact: true }).click();
}

async function openDshPage(context, port, selectWorkspace = true) {
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("button", { name: "Agent Inbox", exact: true })
    .waitFor({ state: "visible", timeout: 30_000 });
  const continueButton = page.getByRole("button", {
    name: "Continue",
    exact: true,
  });
  await continueButton
    .waitFor({ state: "visible", timeout: 3_000 })
    .catch(() => undefined);
  if (await continueButton.isVisible().catch(() => false)) {
    await continueButton.click();
    await continueButton.waitFor({ state: "hidden" });
  }
  if (selectWorkspace) {
    await chooseWorkspace(page);
    await page.locator("textarea:visible").last().waitFor({ state: "visible" });
  }
  assert.match(await page.title(), /(?:^| — )DeepSeek Harness$/u);
  assert(
    await page.getByText("New Session", { exact: true }).first().isVisible(),
  );
  assert(await page.getByText("Settings", { exact: true }).first().isVisible());
  return page;
}

async function openInbox(page) {
  const existing = page.getByRole("dialog", { name: "Agent Inbox" });
  if (await existing.isVisible().catch(() => false)) return existing;
  await page.getByRole("button", { name: "Agent Inbox", exact: true }).click();
  await existing.waitFor({ state: "visible" });
  return existing;
}

async function closeInbox(dialog) {
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
}

async function pairPeer(page, peer, displayName, autoExecute) {
  const dialog = await openInbox(page);
  await dialog.getByRole("button", { name: "Settings", exact: true }).click();
  await dialog.getByLabel("Display name").fill(displayName);
  await dialog.getByLabel("Node ID").fill(peer.nodeId);
  await dialog.getByLabel("Ed25519 public key").fill(peer.publicKey);
  await dialog.getByLabel("Automatic execution").selectOption(autoExecute);
  await dialog.getByRole("button", { name: "Save peer", exact: true }).click();
  const peerRow = dialog.locator(".squad-peer").filter({
    hasText: displayName,
  });
  await peerRow.waitFor({ state: "visible" });
  assert.equal(await peerRow.locator("select").inputValue(), autoExecute);
  await closeInbox(dialog);
}

async function assertChineseLocalization(browser, port) {
  const context = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1440, height: 960 },
  });
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}`, {
      waitUntil: "domcontentloaded",
    });
    const trigger = page.getByRole("button", {
      name: "智能体收件箱",
      exact: true,
    });
    await trigger.waitFor({ state: "visible", timeout: 30_000 });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "智能体收件箱" });
    await dialog.waitFor({ state: "visible" });
    assert.equal(
      await dialog.locator(".squad-panel").getAttribute("lang"),
      "zh-CN",
    );
    for (const tab of [
      "分派计划",
      "待我处理",
      "运行中",
      "已发送",
      "已完成",
      "组织",
      "更新",
      "设置",
    ]) {
      await dialog.getByRole("button", { name: tab, exact: true }).waitFor();
    }
    await dialog.getByRole("button", { name: "更新", exact: true }).click();
    await dialog.getByText("当前版本", { exact: true }).waitFor();
    await dialog
      .getByText(`v${String(pluginManifest.version)}`, {
        exact: true,
      })
      .waitFor();
    assert.equal(
      await dialog.locator(".squad-update-policy select").inputValue(),
      "NOTIFY",
    );
    await dialog.getByRole("button", { name: "设置", exact: true }).click();
    await dialog.getByText("节点身份", { exact: true }).waitFor();
    await dialog.getByLabel("显示名称", { exact: true }).waitFor();
    const policySelect = dialog.locator('select[name="autoExecute"]');
    await policySelect.waitFor({ state: "visible" });
    assert.equal(
      await policySelect.locator('option[value="SAFE"]').textContent(),
      "仅安全目标",
    );
  } finally {
    await context.close();
  }
}

async function sendAgentPrompt(page, prompt) {
  const composer = page.locator("textarea:visible").last();
  await composer.fill(prompt);
  await composer.press("Enter");
  await page
    .getByText("The delegation was queued for the paired Personal Agent.", {
      exact: true,
    })
    .last()
    .waitFor({ timeout: 30_000 });
}

function matching(state, marker, direction) {
  return state.delegations.filter(
    (item) => item.direction === direction && item.objective.includes(marker),
  );
}

async function waitForDelegation(port, marker, direction, status) {
  return waitFor(`${marker} ${direction} ${status}`, async () => {
    const state = await localState(port);
    const items = matching(state, marker, direction);
    if (items.length !== 1 || items[0].status !== status) return undefined;
    return items[0];
  });
}

async function assertInboxItem(page, tab, marker) {
  const dialog = await openInbox(page);
  await dialog.getByRole("button", { name: tab, exact: true }).click();
  await dialog
    .getByText(new RegExp(marker, "u"))
    .first()
    .waitFor({ timeout: 20_000 });
  return dialog;
}

async function allFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await allFiles(path)));
    else result.push(path);
  }
  return result;
}

function zstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    assert(buffer.length - offset >= 5, "truncated DSH Zstandard frame header");
    assert.equal(
      buffer.readUInt32LE(offset),
      0xfd2fb528,
      `invalid DSH Zstandard frame at byte ${offset}`,
    );
    offset += 4;
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes =
      contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    for (;;) {
      assert(
        buffer.length - offset >= 3,
        "truncated DSH Zstandard block header",
      );
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      assert.notEqual(blockType, 3, "reserved DSH Zstandard block type");
      const blockSize = blockHeader >>> 3;
      offset += blockType === 1 ? 1 : blockSize;
      assert(offset <= buffer.length, "truncated DSH Zstandard block");
      if (lastBlock) break;
    }
    if (checksum) offset += 4;
    assert(offset <= buffer.length, "truncated DSH Zstandard checksum");
    frames.push(buffer.subarray(start, offset));
  }
  return frames;
}

async function sessionEvidence(home, sessionId) {
  const candidates = await allFiles(home);
  const matchingFiles = candidates.filter((path) => path.includes(sessionId));
  assert(
    matchingFiles.length > 0,
    `no durable DSH session file found for ${sessionId}`,
  );
  return (
    await Promise.all(
      matchingFiles.map(async (path) => {
        try {
          const bytes = await readFile(path);
          return path.endsWith(".zstd")
            ? zstdFrames(bytes)
                .map((frame) => zstdDecompressSync(frame).toString("utf8"))
                .join("")
            : bytes.toString("utf8");
        } catch {
          return "";
        }
      }),
    )
  ).join("\n");
}

async function main() {
  assert.equal(
    process.version,
    "v24.18.0",
    "smoke requires the pinned Node.js 24.18.0",
  );
  await mkdir(artifactsDir, { recursive: true });

  log("building and packing the independently installable plugin");
  run("pnpm", ["build"]);
  run("pnpm", ["pack", "--pack-destination", artifactsDir], { cwd: pluginDir });
  run("pnpm", ["pack", "--pack-destination", artifactsDir], {
    cwd: fixtureDir,
  });
  const tarEntries = run("tar", ["-tzf", pluginTarball]);
  for (const expected of [
    "package/dist/host/plugin.js",
    "package/dist/client.js",
    "package/cordis.patch.yml",
  ]) {
    assert(
      tarEntries.includes(expected),
      `plugin tarball is missing ${expected}`,
    );
  }
  assert(
    !/(?:^|\/)(?:apps|service|seat-runtime|contracts|deploy)(?:\/|$)/mu.test(
      tarEntries,
    ),
  );

  const temporaryRoot = await mkdtemp(join(tmpdir(), "dsh-squad-delegation-"));
  const cleanPackageCache = join(temporaryRoot, "pnpm-cache");
  const aliceHome = join(temporaryRoot, "alice-home");
  const bobHome = join(temporaryRoot, "bob-home");
  const relayHome = join(temporaryRoot, "relay-home");
  const [alicePort, bobPort, relayPort] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
  ]);
  const alice = new DshHost("Alice DSH", aliceHome, alicePort);
  const bob = new DshHost("Bob DSH", bobHome, bobPort);
  const relay = new DshHost("Relay DSH", relayHome, relayPort);
  let browser;

  try {
    log(`using isolated DSH homes under ${temporaryRoot}`);
    await installProfile(aliceHome, true, cleanPackageCache);
    await installProfile(bobHome, true, cleanPackageCache);
    await installProfile(relayHome, false, cleanPackageCache);

    log("bootstrapping stable Alice and Bob Ed25519 identities");
    const aliceIdentity = await bootstrapIdentity(alice);
    const bobIdentity = await bootstrapIdentity(bob);
    assert.notEqual(aliceIdentity.nodeId, bobIdentity.nodeId);
    await mkdir(join(bobHome, "skills"), { recursive: true });
    await cp(skillFixture, join(bobHome, "skills", "squad-count-items"), {
      recursive: true,
    });
    await assert.rejects(stat(join(aliceHome, "skills", "squad-count-items")));

    const relayUrl = `http://127.0.0.1:${relayPort}`;
    const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
    const aliceInvite = "squad-acceptance-alice-invite-7d1719d4";
    const bobInvite = "squad-acceptance-bob-invite-64c048b9";
    await writePatch(
      relayHome,
      relayConfig(relayHome, [
        { token: aliceInvite, expiresAt },
        { token: bobInvite, expiresAt },
      ]),
    );
    await writePatch(
      aliceHome,
      nodeConfig(aliceHome, "Alice Personal Agent", relayUrl, aliceInvite),
    );
    await writePatch(
      bobHome,
      nodeConfig(bobHome, "Bob Personal Agent", relayUrl, bobInvite),
    );

    log("starting one Relay plus two real, isolated DSH Web Hosts");
    await relay.start();
    const health = await fetchJson(`${relayUrl}/squad/v1/health`);
    assert.deepEqual(health, {
      ok: true,
      version: String(pluginManifest.version),
      protocolVersions: [1, 2],
    });
    await alice.start();
    await bob.start();

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
    });
    let alicePage = await openDshPage(context, alicePort);
    let bobPage = await openDshPage(context, bobPort);

    log("verifying system-derived Simplified Chinese and English WebUI copy");
    await assertChineseLocalization(browser, alicePort);

    log("pairing pinned peers and policies through the native WebUI");
    await pairPeer(alicePage, bobIdentity, "Bob Personal Agent", "NEVER");
    await pairPeer(bobPage, aliceIdentity, "Alice Personal Agent", "TRUSTED");
    await waitFor("Alice peer persistence", async () => {
      const state = await localState(alicePort);
      return state.peers.some((peer) => peer.nodeId === bobIdentity.nodeId);
    });
    await waitFor("Bob peer persistence", async () => {
      const state = await localState(bobPort);
      return state.peers.some(
        (peer) =>
          peer.nodeId === aliceIdentity.nodeId &&
          peer.policy.autoExecute === "TRUSTED",
      );
    });

    log("creating a local Team Planner draft and approving it in WebUI");
    const planFixtureMarker = "TEAM_PLAN_FIXTURE";
    const plan = await fetchJson(
      `http://127.0.0.1:${alicePort}/squad/v1/local/plans`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Team Planner smoke plan",
          sourceSummary: "One reviewed item must become one signed delegation.",
          items: [
            {
              to: bobIdentity.nodeId,
              objective: `${planFixtureMarker}: verify the reviewed plan path`,
              acceptanceCriteria: ["Return one explicit outcome"],
            },
          ],
        }),
      },
    );
    assert.equal(plan.status, "DRAFT");
    assert.equal(plan.items.length, 1);
    assert.equal(
      matching(await localState(alicePort), planFixtureMarker, "OUTGOING")
        .length,
      0,
      "a Team Planner draft must not dispatch before local approval",
    );
    let dialog = await openInbox(alicePage);
    await dialog.getByRole("button", { name: "Plans", exact: true }).click();
    await dialog
      .getByText("Team Planner smoke plan", { exact: true })
      .first()
      .waitFor();
    await dialog
      .getByRole("button", { name: "Approve and dispatch", exact: true })
      .click();
    const dispatchedPlan = await waitFor(
      "reviewed Team Planner dispatch",
      async () => {
        const state = await localState(alicePort);
        const candidate = state.plans.find((item) => item.id === plan.id);
        return candidate?.status === "DISPATCHED" ? candidate : undefined;
      },
    );
    const plannedOutgoing = matching(
      await localState(alicePort),
      planFixtureMarker,
      "OUTGOING",
    );
    assert.equal(plannedOutgoing.length, 1);
    assert.equal(plannedOutgoing[0].id, plan.items[0].id);
    assert.equal(dispatchedPlan.items[0].delegationId, plan.items[0].id);
    await closeInbox(dialog);
    const replayedApproval = await fetchJson(
      `http://127.0.0.1:${alicePort}/squad/v1/local/plans/${plan.id}/approve`,
      { method: "POST" },
    );
    assert.equal(replayedApproval.status, "DISPATCHED");
    assert.equal(
      matching(await localState(alicePort), planFixtureMarker, "OUTGOING")
        .length,
      1,
      "replayed approval must not create a duplicate delegation",
    );
    const completedPlanDelegation = await waitForDelegation(
      alicePort,
      planFixtureMarker,
      "OUTGOING",
      "COMPLETED",
    );
    assert.equal(completedPlanDelegation.id, plan.items[0].id);

    const nativeSelfTest = await fetchJson(
      `http://127.0.0.1:${alicePort}/squad/v1/local/self-test/session`,
      { method: "POST" },
    );
    assert.equal(nativeSelfTest.liveRead, true);
    assert.equal(nativeSelfTest.persistedRead, true);
    assert.equal(nativeSelfTest.sameSessionResumed, true);
    assert.equal(nativeSelfTest.toolsAvailable, true);

    await bobPage.close();
    await bob.stop();
    log("Bob is offline; Alice's native Agent is invoking delegate_to_agent");
    await sendAgentPrompt(
      alicePage,
      `Use delegate_to_agent to send AUTO_SKILL_FIXTURE to ${bobIdentity.nodeId}. Send only the objective and line-item context; the receiver must choose its own local Skill.`,
    );
    const offlineOutgoing = await waitFor(
      "Relay-persisted offline request",
      async () => {
        const state = await localState(alicePort);
        const items = matching(state, "AUTO_SKILL_FIXTURE", "OUTGOING");
        if (
          items.length !== 1 ||
          items[0].deliveryStatus !== "STORED_BY_RELAY"
        ) {
          return undefined;
        }
        return items[0];
      },
    );
    dialog = await assertInboxItem(alicePage, "Sent", "AUTO_SKILL_FIXTURE");
    await dialog.getByRole("button", { name: "Settings", exact: true }).click();
    await dialog
      .getByText("Bob Personal Agent", { exact: true })
      .first()
      .waitFor();
    await closeInbox(dialog);

    log("restarting Relay while its Bob mailbox is unacknowledged");
    await relay.stop();
    await sleep(1_200);
    await relay.start();
    await fetchJson(`${relayUrl}/squad/v1/health`);

    log("bringing Bob online to execute once with Bob's receiver-local Skill");
    await bob.start();
    const bobAutomatic = await waitForDelegation(
      bobPort,
      "AUTO_SKILL_FIXTURE",
      "INCOMING",
      "COMPLETED",
    );
    assert.equal(
      matching(await localState(bobPort), "AUTO_SKILL_FIXTURE", "INCOMING")
        .length,
      1,
    );
    assert(
      bobAutomatic.outputs.some((item) => item.content?.includes("count=3")),
    );
    const aliceAutomatic = await waitForDelegation(
      alicePort,
      "AUTO_SKILL_FIXTURE",
      "OUTGOING",
      "COMPLETED",
    );
    assert.equal(aliceAutomatic.id, offlineOutgoing.id);
    assert.equal(aliceAutomatic.sessionId, undefined);
    assert.deepEqual(aliceAutomatic.todos, []);
    const automaticEvidence = await sessionEvidence(
      bobHome,
      bobAutomatic.sessionId,
    );
    assert(automaticEvidence.includes("squad-count-items"));
    assert(automaticEvidence.includes("SQUAD_FIXTURE_SKILL_LOADED"));

    log("restarting Alice independently and checking durable completed state");
    await alicePage.close();
    await alice.stop();
    await alice.start();
    const aliceAfterRestart = await waitForDelegation(
      alicePort,
      "AUTO_SKILL_FIXTURE",
      "OUTGOING",
      "COMPLETED",
    );
    assert.equal(aliceAfterRestart.id, aliceAutomatic.id);
    assert.equal(
      (await localState(alicePort)).identity.nodeId,
      aliceIdentity.nodeId,
    );
    alicePage = await openDshPage(context, alicePort);
    dialog = await assertInboxItem(
      alicePage,
      "Completed",
      "AUTO_SKILL_FIXTURE",
    );
    await dialog
      .getByText("SQUAD_FIXTURE_SKILL_LOADED", { exact: false })
      .waitFor();
    await closeInbox(dialog);

    log(
      "Alice's native Agent is sending a delegation that requires two local Bob approvals",
    );
    await sendAgentPrompt(
      alicePage,
      `Use delegate_to_agent to send HUMAN_HANDOFF_FIXTURE to ${bobIdentity.nodeId}. The receiver owns all approvals and must resume its original session.`,
    );
    const bobWaiting = await waitForDelegation(
      bobPort,
      "HUMAN_HANDOFF_FIXTURE",
      "INCOMING",
      "WAITING_HUMAN",
    );
    assert.equal(
      bobWaiting.todos.filter((todo) => todo.status === "OPEN").length,
      2,
    );
    const originalSessionId = bobWaiting.sessionId;
    assert.match(originalSessionId, /^squad-[0-9a-f-]{36}$/u);
    const aliceWaiting = await waitForDelegation(
      alicePort,
      "HUMAN_HANDOFF_FIXTURE",
      "OUTGOING",
      "WAITING_HUMAN",
    );
    assert.equal(aliceWaiting.sessionId, undefined);
    assert.deepEqual(aliceWaiting.todos, []);
    assert.equal(aliceWaiting.summary, "Waiting for the receiving owner.");
    const aliceProjection = JSON.stringify(await localState(alicePort));
    assert(!aliceProjection.includes("Approve release notes"));
    assert(!aliceProjection.includes("Approve release window"));
    assert(!aliceProjection.includes(bobHome));

    bobPage = await openDshPage(context, bobPort, false);
    dialog = await openInbox(bobPage);
    await dialog.getByRole("button", { name: "Settings", exact: true }).click();
    const alicePeerRow = dialog.locator(".squad-peer").filter({
      hasText: "Alice Personal Agent",
    });
    await alicePeerRow.waitFor({ state: "visible" });
    assert.equal(await alicePeerRow.locator("select").inputValue(), "TRUSTED");
    await dialog
      .getByRole("button", { name: "Waiting for me", exact: true })
      .click();
    await dialog
      .getByText("HUMAN_HANDOFF_FIXTURE", { exact: false })
      .first()
      .waitFor();
    const checkboxes = dialog.locator('.squad-todo input[type="checkbox"]');
    await waitFor("two Todo checkboxes", async () =>
      (await checkboxes.count()) === 2 ? true : undefined,
    );
    await waitFor("both Todo checkboxes to be selected by default", async () =>
      (await checkboxes.nth(0).isChecked()) &&
      (await checkboxes.nth(1).isChecked())
        ? true
        : undefined,
    );
    await checkboxes.nth(1).uncheck();
    await dialog
      .getByLabel("Response for the receiving Agent")
      .fill("Release notes approved locally.");
    await dialog
      .getByRole("button", { name: "Complete selected", exact: true })
      .click();
    const partiallyDone = await waitForDelegation(
      bobPort,
      "HUMAN_HANDOFF_FIXTURE",
      "INCOMING",
      "WAITING_HUMAN",
    );
    assert.equal(
      partiallyDone.todos.filter((todo) => todo.status === "DONE").length,
      1,
    );
    assert.equal(
      partiallyDone.todos.filter((todo) => todo.status === "OPEN").length,
      1,
    );
    assert.equal(partiallyDone.sessionId, originalSessionId);

    await bobPage.setViewportSize({ width: 390, height: 844 });
    const responsive = await bobPage.evaluate(() => {
      const panel = document
        .querySelector(".squad-panel")
        ?.getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        panel:
          panel === undefined
            ? undefined
            : {
                x: panel.x,
                y: panel.y,
                width: panel.width,
                height: panel.height,
              },
      };
    });
    assert.equal(responsive.documentWidth <= responsive.viewportWidth, true);
    assert(responsive.panel !== undefined);
    assert(
      responsive.panel.x >= 0 &&
        responsive.panel.width <= responsive.viewportWidth,
    );
    assert(
      await bobPage
        .getByText("New Session", { exact: true })
        .first()
        .isVisible(),
    );
    await bobPage.setViewportSize({ width: 1440, height: 960 });

    log(
      "restarting Bob with one Todo still open, then completing the remainder",
    );
    await bobPage.close();
    await bob.stop();
    await bob.start();
    const waitingAfterRestart = await waitForDelegation(
      bobPort,
      "HUMAN_HANDOFF_FIXTURE",
      "INCOMING",
      "WAITING_HUMAN",
    );
    assert.equal(waitingAfterRestart.sessionId, originalSessionId);
    assert.equal(
      waitingAfterRestart.todos.filter((todo) => todo.status === "OPEN").length,
      1,
    );
    bobPage = await openDshPage(context, bobPort, false);
    dialog = await openInbox(bobPage);
    await dialog
      .getByText("HUMAN_HANDOFF_FIXTURE", { exact: false })
      .first()
      .waitFor();
    assert.equal(
      await dialog.locator('.squad-todo input[type="checkbox"]').count(),
      1,
    );
    await dialog
      .getByLabel("Response for the receiving Agent")
      .fill("Release window approved locally.");
    await dialog
      .getByRole("button", { name: "Complete selected", exact: true })
      .click();

    const bobCompleted = await waitForDelegation(
      bobPort,
      "HUMAN_HANDOFF_FIXTURE",
      "INCOMING",
      "COMPLETED",
    );
    assert.equal(bobCompleted.sessionId, originalSessionId);
    assert.equal(
      bobCompleted.todos.filter((todo) => todo.status === "DONE").length,
      2,
    );
    assert(
      bobCompleted.outputs.some(
        (item) => item.content === "same-session-resume: complete",
      ),
    );
    const aliceCompleted = await waitForDelegation(
      alicePort,
      "HUMAN_HANDOFF_FIXTURE",
      "OUTGOING",
      "COMPLETED",
    );
    assert.equal(aliceCompleted.sessionId, undefined);
    assert.deepEqual(aliceCompleted.todos, []);

    dialog = await assertInboxItem(
      bobPage,
      "Completed",
      "HUMAN_HANDOFF_FIXTURE",
    );
    await dialog
      .getByText("same-session-resume: complete", { exact: true })
      .waitFor();
    await dialog
      .getByRole("button", { name: "Open native DSH session", exact: true })
      .click();
    await waitFor("native resumed DSH session UI", async () => {
      const body = await bobPage.locator("body").innerText();
      return body.includes("HUMAN_HANDOFF_FIXTURE") ? true : undefined;
    });

    const resumedEvidence = await sessionEvidence(bobHome, originalSessionId);
    assert(resumedEvidence.includes("Release notes approved locally."));
    assert(resumedEvidence.includes("Release window approved locally."));
    assert(resumedEvidence.includes("same-session-resume: complete"));

    log("checking sender privacy and Relay mailbox authentication boundaries");
    const privateRoute = await fetch(
      `http://127.0.0.1:${alicePort}/squad/v1/local/delegations/${aliceCompleted.id}/session`,
    );
    assert.equal(privateRoute.status, 404);
    const unauthenticatedMailbox = await fetch(
      `${relayUrl}/squad/v1/mailbox?after=0&limit=100`,
    );
    assert.equal(unauthenticatedMailbox.status, 401);
    const finalAliceProjection = JSON.stringify(await localState(alicePort));
    assert(!finalAliceProjection.includes(originalSessionId));
    assert(!finalAliceProjection.includes("Release notes approved locally."));
    assert(!finalAliceProjection.includes("Release window approved locally."));

    dialog = await assertInboxItem(
      alicePage,
      "Completed",
      "HUMAN_HANDOFF_FIXTURE",
    );
    await dialog
      .getByText("same-session-resume: complete", { exact: true })
      .waitFor();
    await closeInbox(dialog);

    log(
      "disabling the Relay profile plugin and proving the native Harness remains usable",
    );
    await relay.stop();
    await writeFile(
      join(relayHome, "profiles", "web", "cordis.patch.yml"),
      `${JSON.stringify([{ id: "dsh-squad", disabled: true }], null, 2)}\n`,
    );
    await relay.start(false);
    const relayRoot = await fetch(`http://127.0.0.1:${relayPort}/`);
    assert.equal(relayRoot.status, 200);
    const removedRoute = await fetch(`${relayUrl}/squad/v1/local/state`);
    assert.equal(removedRoute.status, 200);
    assert.match(
      removedRoute.headers.get("content-type") ?? "",
      /^text\/html(?:;|$)/u,
    );
    assert(!(await removedRoute.text()).includes('"identity"'));
    const disabledPage = await context.newPage();
    await disabledPage.goto(`http://127.0.0.1:${relayPort}`);
    await disabledPage
      .getByText("New Session", { exact: true })
      .first()
      .waitFor();
    assert.equal(
      await disabledPage
        .getByRole("button", { name: "Agent Inbox", exact: true })
        .count(),
      0,
    );
    await disabledPage.close();

    log(
      "PASS: tarball, Team Planner approval, bilingual DSH UI, offline Relay, Skill, Todo, resume, privacy, and Chromium",
    );
  } catch (error) {
    for (const host of [alice, bob, relay]) {
      process.stderr.write(`\n--- ${host.label} output ---\n${host.output}\n`);
      if (host.child !== undefined) {
        try {
          process.stderr.write(
            `--- ${host.label} local state ---\n${JSON.stringify(await localState(host.port), null, 2)}\n`,
          );
        } catch {
          // The process may already be stopped; its captured output remains useful.
        }
      }
    }
    throw error;
  } finally {
    await Promise.allSettled([alice.stop(), bob.stop(), relay.stop()]);
    await browser?.close();
    if (keep) log(`kept smoke homes at ${temporaryRoot}`);
    else await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await main();
