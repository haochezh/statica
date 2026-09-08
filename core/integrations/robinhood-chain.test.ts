import { describe, expect, it, vi } from "vitest";
import {
  RobinhoodApiError,
  RobinhoodStockTokenClient,
  applyStockTokenMultiplier,
  robinhoodChain,
} from "./robinhood-chain";

describe("Robinhood Chain integration", () => {
  it("exposes the production chain configuration", () => {
    expect(robinhoodChain.id).toBe(4663);
    expect(robinhoodChain.rpcUrls.default.http[0]).toContain("robinhood.com");
  });

  it("normalizes symbols and returns quotes", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ quotes: [{ tokenSymbol: "AAPL" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const client = new RobinhoodStockTokenClient({ fetcher });

    const quotes = await client.getPrices(" aapl ");

    expect(quotes[0]?.tokenSymbol).toBe("AAPL");
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.robinhood.com/rhj/prices/AAPL",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("preserves API failure details", async () => {
    const client = new RobinhoodStockTokenClient({
      fetcher: vi.fn().mockResolvedValue(new Response("limited", { status: 429 })),
    });
    await expect(client.listAssets()).rejects.toEqual(
      expect.objectContaining<Partial<RobinhoodApiError>>({ status: 429, responseBody: "limited" }),
    );
  });

  it("applies ERC-8056 multipliers without changing raw units", () => {
    expect(applyStockTokenMultiplier(2n * 10n ** 18n, 15n * 10n ** 17n)).toBe(3n * 10n ** 18n);
  });
});
