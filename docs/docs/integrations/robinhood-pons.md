# Robinhood Chain and Pons integration

This guide covers Statica's shared Robinhood Chain integration and its support for both generations of the Pons launch protocol.

## Scope

The integration lives in `@statica/core/integrations` and contains no wallet-specific dependency. Applications inject an `EvmTransport` backed by viem, ethers, a browser wallet, or a secured agent signer. Read-only Robinhood Stock Token data uses the public REST client directly.

| Module | Purpose |
| --- | --- |
| `robinhood-chain` | Chain definitions, Stock Token API client, ERC-8056 helpers, and Chainlink ABI |
| `pons-contracts` | Versioned Pons deployment addresses and minimal contract interfaces |
| `pons` | v1 state access, v2 launch/trade operations, and deterministic quote math |
| `evm` | Small transport boundary for contract reads and wallet-signed writes |

## Robinhood Chain

Robinhood Chain mainnet uses chain ID `4663` and ETH for gas. Testnet uses chain ID `46630`. The included public RPC endpoints are appropriate for development and light reads; use an archive-capable provider for production indexing.

```ts
import {
  RobinhoodStockTokenClient,
  applyStockTokenMultiplier,
  robinhoodChain,
} from "@statica/core/integrations";

const stockTokens = new RobinhoodStockTokenClient();
const assets = await stockTokens.listAssets();
const aaplQuotes = await stockTokens.getPrices("AAPL");

const adjustedBalance = applyStockTokenMultiplier(rawBalance, uiMultiplier);
console.log(robinhoodChain.id, assets, aaplQuotes, adjustedBalance);
```

The REST price is the raw underlying-equity bid/ask. The onchain Chainlink feed is already multiplier-adjusted. Do not apply the ERC-8056 multiplier twice.

## EVM transport

Connect the integration to the wallet stack already used by the host application. The adapter must parse the supplied human-readable ABI strings before passing them to its EVM library.

```ts
import { parseAbi } from "viem";
import type { EvmTransport } from "@statica/core/integrations";

const transport: EvmTransport = {
  readContract: ({ abi, ...request }) =>
    publicClient.readContract({ ...request, abi: parseAbi(abi) }),
  writeContract: ({ abi, ...request }) =>
    walletClient.writeContract({ ...request, abi: parseAbi(abi), account }),
};
```

Omit `writeContract` for read-only agents. Any launch or trade attempt through that transport will fail before requesting a signature.

## Pons v1

Pons v1 launches directly into locked Uniswap v3 pools. New and legacy factory addresses remain relevant because deployed contracts are immutable.

```ts
import { PonsV1Client, ponsV1PriceRatio } from "@statica/core/integrations";

const ponsV1 = new PonsV1Client(transport);
const metadata = await ponsV1.getTokenMetadata(tokenAddress);
const launch = await ponsV1.getLaunch(tokenAddress);
const graduation = await ponsV1.getGraduation(tokenAddress);
const ratio = ponsV1PriceRatio(sqrtPriceX96, launch.isToken0);
```

For discovery, index each factory's `TokenLaunched` event from its documented start block, then index each emitted pool's `Swap` events. Backfill in bounded ranges because the public RPC may reject wide `eth_getLogs` requests. v1 trades route through the listed Uniswap v3 router and quoter.

## Pons v2

Pons v2 starts each launch on a bonding curve and graduates it into a permanently locked Uniswap v4 pool. The launch record's `phase` is authoritative:

- `0` — trade on the curve.
- `1` — swept; pool creation is pending.
- `2` — trade through the Uniswap v4 pool.
- `3` — rescued; surface this state explicitly.

### Read configs and quote a trade

```ts
import { PonsV2Client, quotePonsV2Buy } from "@statica/core/integrations";

const ponsV2 = new PonsV2Client(transport);
const configs = await ponsV2.listOpenLaunchConfigs();
const state = await ponsV2.getQuoteState(curveAddress, recipientAddress);
const quote = quotePonsV2Buy(quoteIn, state);

const slippageBps = 100n;
const minTokensOut = quote.tokensOut * (10_000n - slippageBps) / 10_000n;
```

The quote implementation follows the protocol's integer order: buy fees are removed before curve pricing, sell fees are removed after pricing, snipe tax applies only to buys, and final curve buys can be partially filled with a refund.

### Prepare and launch a token

```ts
const { params, launchFee } = await ponsV2.prepareLaunchParams(
  {
    name: "Example",
    symbol: "EXMPL",
    logo: "ipfs://...",
    description: "An example launch.",
    socials: { twitter: "", telegram: "", discord: "", website: "", farcaster: "" },
    creatorFeeRecipient: creatorAddress,
    creatorTaxBps: 0,
    buybackEnabled: true,
    salt,
  },
  launchConfigId,
  pairToken,
);

const transactionHash = await ponsV2.launchToken(
  params,
  launchConfigId,
  pairToken,
  launchFee,
);
```

`prepareLaunchParams` reads `previewLaunchEconomics` immediately before launch and pins those economics in the signed request. A configuration change between preparation and execution causes the contract to revert rather than accepting different terms.

### Buy and sell before graduation

```ts
// Native ETH pair
await ponsV2.buy(curveAddress, quoteIn, minTokensOut, recipientAddress, true);

// ERC-20 pair: approve first, then buy with no native value
await ponsV2.approveQuoteAsset(pairToken, curveAddress, quoteIn);
await ponsV2.buy(curveAddress, quoteIn, minTokensOut, recipientAddress, false);

// Approve the curve to spend launch tokens before selling.
await ponsV2.approveToken(launchToken, curveAddress, tokensIn);
await ponsV2.sell(curveAddress, tokensIn, minQuoteOut, recipientAddress);
```

Custom-pair amounts must use the quote asset's own decimals. Once a launch reaches phase `2`, route trades to Uniswap v4 rather than the curve.

## Production checklist

- Read active configs and approved pair assets immediately before launch.
- Verify `canLaunch(account)` before opening a signing flow.
- Simulate every write and display the decoded transaction to the signer.
- Set minimum outputs from a fresh quote and an explicit slippage policy.
- Re-quote after meaningful block, reserve, or tax changes.
- Index both current and legacy v1 factories.
- Index v2 factory and per-curve events; use bounded block ranges.
- Track partial-fill refunds and use emitted settled amounts.
- Use the v2 launch phase to select the correct trading venue.
- Keep all key material outside Statica and never place secrets in issue content or agent instructions.

## References

- [Robinhood Chain documentation](https://docs.robinhood.com/chain/)
- [Robinhood Stock Token APIs](https://docs.robinhood.com/chain/stock-token-apis/)
- [Pons v1 documentation](https://docs.ponsfamily.com/)
- [Pons v2 documentation](https://docs.ponsfamily.com/v2)
