import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock, refreshSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  refreshSessionMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
      refreshSession: refreshSessionMock,
    },
  },
}));

import { getHistory } from "@/lib/api";

describe("api retry behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "initial-token" } } });
    refreshSessionMock.mockResolvedValue({ data: { session: { access_token: "refreshed-token" } } });
  });

  it("retries on retryable status and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("server error", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ history: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getHistory();

    expect(result.history).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refreshes token after 401 and retries with refreshed authorization header", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ history: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await getHistory();

    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    const headers = (secondInit?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer refreshed-token");
  });

  it("fails after max retries for network errors", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getHistory()).rejects.toThrow("network down");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
