import { describe, expect, it } from "vitest";
import { updaterConfigSchema } from "./config.ts";
import { renderSystemdBundle } from "./systemd.ts";

describe("systemd updater units", () => {
  it("renders separate scheduled and user-approved update triggers", () => {
    const config = updaterConfigSchema.parse({
      schemaVersion: 1,
      repository: "zhouCode/dsh-squad",
      stateDir: "/srv/squad/update-state",
      dshHome: "/srv/squad/dsh-home",
      profile: "web",
      serviceUnit: "dsh-squad-relay.service",
      scope: "user",
      healthUrl: "http://127.0.0.1:37100/squad/v1/health",
      stateUrl: "http://127.0.0.1:37100/squad/v1/local/state",
      dataPaths: ["/srv/squad/node-data", "/srv/squad/relay-data"],
      nodeCommand: "/usr/bin/node",
      pnpmCommand: "/usr/bin/pnpm",
      retainBackups: 3,
    });
    const bundle = renderSystemdBundle(
      config,
      "/srv/squad/dsh-home/profiles/web/node_modules/.bin/dsh-squad-update",
      "/srv/squad/update-state/updater-config.json",
    );
    expect(bundle.files["dsh-squad-relay-updater.timer"]).toContain(
      "Persistent=true",
    );
    expect(bundle.files["dsh-squad-relay-updater.path"]).toContain(
      "update-request.json",
    );
    expect(bundle.files["dsh-squad-relay-updater.path"]).toContain(
      "WantedBy=default.target",
    );
    expect(bundle.files["dsh-squad-relay-updater.service"]).toContain(
      "NoNewPrivileges=true",
    );
    expect(bundle.files["dsh-squad-relay-updater.service"]).toContain(
      "PATH=/usr/bin:",
    );
  });

  it("rejects a root-privileged system-scope updater", () => {
    expect(() =>
      updaterConfigSchema.parse({
        schemaVersion: 1,
        repository: "zhouCode/dsh-squad",
        stateDir: "/srv/squad/update-state",
        dshHome: "/srv/squad/dsh-home",
        profile: "web",
        serviceUnit: "dsh-squad-relay.service",
        scope: "system",
        healthUrl: "http://127.0.0.1:37100/squad/v1/health",
        stateUrl: "http://127.0.0.1:37100/squad/v1/local/state",
        dataPaths: ["/srv/squad/node-data"],
        nodeCommand: "/usr/bin/node",
        pnpmCommand: "/usr/bin/pnpm",
        retainBackups: 3,
      }),
    ).toThrow();
  });
});
