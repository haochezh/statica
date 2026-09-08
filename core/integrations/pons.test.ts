import { describe, expect, it } from "vitest";
import { ponsV1PriceRatio, quotePonsV2Buy, quotePonsV2Sell } from "./pons";

describe("Pons v1 price math", () => {
  it("preserves an exact 1:1 sqrt price in either token order", () => {
    const sqrtPriceX96 = 2n ** 96n;
    expect(ponsV1PriceRatio(sqrtPriceX96, true)).toEqual({
      numerator: 2n ** 192n,
      denominator: 2n ** 192n,
    });
    expect(ponsV1PriceRatio(sqrtPriceX96, false)).toEqual({
      numerator: 2n ** 192n,
      denominator: 2n ** 192n,
    });
  });
});

describe("Pons v2 quote math", () => {
  const state = {
    quoteReserve: 1_000_000n,
    tokenReserve: 10_000_000n,
    sellableTokens: 9_000_000n,
    feeBps: 100n,
    creatorTaxBps: 50n,
    snipeTaxBps: 0n,
  };

  it("quotes a buy with fees removed before curve pricing", () => {
    expect(quotePonsV2Buy(10_000n, state)).toEqual({
      tokensOut: 97_539n,
      spent: 10_000n,
      refund: 0n,
    });
  });

  it("quotes a sell with fees removed after curve pricing", () => {
    expect(quotePonsV2Sell(100_000n, state)).toBe(9_752n);
  });

  it("clamps a curve-ending buy and reports its refund", () => {
    const quote = quotePonsV2Buy(1_000_000n, { ...state, sellableTokens: 100_000n });
    expect(quote.tokensOut).toBe(100_000n);
    expect(quote.refund).toBeGreaterThan(0n);
    expect(quote.spent + quote.refund).toBe(1_000_000n);
  });
});
