import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSessionMock,
  removeChannelMock,
  channelOnMock,
  channelSubscribeMock,
  channelFactoryMock,
} = vi.hoisted(() => {
  const on = vi.fn().mockReturnThis();
  const subscribe = vi.fn();
  const channel = {
    on,
    subscribe,
  };
  return {
    getSessionMock: vi.fn(),
    removeChannelMock: vi.fn().mockResolvedValue(undefined),
    channelOnMock: on,
    channelSubscribeMock: subscribe,
    channelFactoryMock: vi.fn(() => channel),
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
    },
    channel: channelFactoryMock,
    removeChannel: removeChannelMock,
  },
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    createRun: vi.fn(),
    getRunStatus: vi.fn(),
    getRunReport: vi.fn(),
    deployRun: vi.fn(),
  };
});

import * as api from "@/lib/api";
import { useBacktest, type UseBacktestReturn } from "@/hooks/useBacktest";

let container: HTMLDivElement;
let root: Root;
let latestState: UseBacktestReturn;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function HookHost() {
  latestState = useBacktest();
  return null;
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useBacktest", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<HookHost />);
    });
    channelSubscribeMock.mockImplementation((callback: (status: string) => void) => {
      callback("SUBSCRIBED");
      return { on: channelOnMock, subscribe: channelSubscribeMock };
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("sets auth error when runBacktest is called without session token", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });

    await act(async () => {
      latestState.setPrompt("Buy SPY on MACD cross");
    });
    await flushMicrotasks();

    await act(async () => {
      await latestState.runBacktest();
    });
    await flushMicrotasks();

    expect(latestState.status).toBe("idle");
    expect(latestState.error).toBe("Please login first.");
    expect(latestState.statusMessage).toBe("Authentication required");
  });

  it("transitions into running state after successful run creation", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "token-1" } } });
    vi.mocked(api.createRun).mockResolvedValue({ runId: "run-123" });
    vi.mocked(api.getRunStatus).mockResolvedValue({
      runId: "run-123",
      state: "running",
      steps: [{ key: "parse", title: "Parse Strategy", status: "running", durationMs: null, logs: [] }],
      artifacts: { dsl: "", reportUrl: "", tradesCsvUrl: "" },
    });

    await act(async () => {
      latestState.setPrompt("Momentum strategy");
    });
    await flushMicrotasks();

    await act(async () => {
      await latestState.runBacktest();
    });
    await flushMicrotasks();

    expect(latestState.status).toBe("running");
    expect(latestState.runId).toBe("run-123");
    expect(latestState.error).toBeNull();
    expect(channelFactoryMock).toHaveBeenCalled();
    expect(api.getRunStatus).toHaveBeenCalledWith("run-123");
  });

  it("passes selected backtest date range to createRun", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "token-1" } } });
    vi.mocked(api.createRun).mockResolvedValue({ runId: "run-456" });
    vi.mocked(api.getRunStatus).mockResolvedValue({
      runId: "run-456",
      state: "running",
      steps: [{ key: "parse", title: "Parse Strategy", status: "running", durationMs: null, logs: [] }],
      artifacts: { dsl: "", reportUrl: "", tradesCsvUrl: "" },
    });

    await act(async () => {
      latestState.setBacktestDateRange({ startDate: "2025-01-01", endDate: "2025-06-30" });
      latestState.setPrompt("Date range strategy");
    });
    await flushMicrotasks();

    await act(async () => {
      await latestState.runBacktest();
    });
    await flushMicrotasks();

    expect(api.createRun).toHaveBeenCalledWith(
      "Date range strategy",
      expect.objectContaining({
        startDate: "2025-01-01",
        endDate: "2025-06-30",
      })
    );
  });
});
