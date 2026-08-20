import { describe, expect, it } from "vitest";
import {
  en,
  formatDelivery,
  formatErrorCode,
  formatPlanItemStatus,
  formatPlanStatus,
  formatPolicy,
  formatStatus,
  formatSummary,
  formatUpdateMode,
  formatUpdatePhase,
  zh,
  type SquadTranslate,
} from "./locales.ts";

function translator(dictionary: Record<string, string>): SquadTranslate {
  return ((key: string, params?: Record<string, unknown>) => {
    const template = dictionary[key] ?? key;
    if (params === undefined) return template;
    return template.replace(/\{(\w+)\}/gu, (match, name: string) =>
      name in params ? String(params[name]) : match,
    );
  }) as SquadTranslate;
}

describe("Squad locale dictionaries", () => {
  it("keeps Simplified Chinese and English key-complete", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    expect(zh["inbox.title"]).toBe("Squad 团队协作");
    expect(en["inbox.title"]).toBe("Squad");
  });

  it("localizes protocol enums without changing their stored values", () => {
    const t = translator(zh);
    expect(formatStatus(t, "WAITING_HUMAN")).toBe("等待人工处理");
    expect(formatDelivery(t, "STORED_BY_RELAY")).toBe("中继已持久保存");
    expect(formatPolicy(t, "SAFE")).toBe("仅匹配本机规则");
    expect(formatPlanStatus(t, "PARTIAL")).toBe("部分失败");
    expect(formatPlanItemStatus(t, "DISPATCHED")).toBe("已创建委派");
    expect(formatUpdateMode(t, "NOTIFY")).toBe("仅通知（推荐）");
    expect(formatUpdatePhase(t, "ROLLED_BACK")).toBe("已回滚");
    expect(formatDelivery(t, "FUTURE_DELIVERY_STATE")).toBe(
      "FUTURE_DELIVERY_STATE",
    );
  });

  it("keeps diagnostic codes visible beside localized explanations", () => {
    const t = translator(zh);
    expect(formatErrorCode(t, "EXECUTION_TIMEOUT")).toBe(
      "执行超时（EXECUTION_TIMEOUT）",
    );
    expect(formatErrorCode(t, "NODE_STATE_UNAVAILABLE")).toBe(
      "无法验证本地节点状态（NODE_STATE_UNAVAILABLE）",
    );
    expect(
      formatErrorCode(t, "RELAY_HOST_MEMBERSHIP_CONFIRMATION_REQUIRED"),
    ).toBe(
      "专用 Relay 变为成员节点前需要明确确认混合角色（RELAY_HOST_MEMBERSHIP_CONFIRMATION_REQUIRED）",
    );
    expect(formatErrorCode(t, "FUTURE_ERROR")).toBe("FUTURE_ERROR");
  });

  it("localizes only plugin-owned summaries and preserves task output", () => {
    const t = translator(zh);
    expect(formatSummary(t, "Awaiting local acceptance.")).toBe(
      "等待接收方本人接受。",
    );
    expect(
      formatSummary(t, "Automatic execution paused: approval required"),
    ).toBe("自动执行已暂停：approval required");
    expect(formatSummary(t, "用户或 Agent 生成的摘要")).toBe(
      "用户或 Agent 生成的摘要",
    );
  });
});
