import type { Address, EvmTransport, Hex } from "./evm";
import { requireWriteTransport } from "./evm";
import {
  ERC20_ABI,
  PONS_V1_CONTRACTS,
  PONS_V1_FACTORY_ABI,
  PONS_V1_TOKEN_ABI,
  PONS_V2_CONTRACTS,
  PONS_V2_CURVE_ABI,
  PONS_V2_FACTORY_ABI,
  ZERO_ADDRESS,
} from "./pons-contracts";

export interface PonsSocials {
  twitter: string;
  telegram: string;
  discord: string;
  website: string;
  farcaster: string;
}

export interface PonsV1TokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  logo: string;
  description: string;
  pool: Address;
  socials: PonsSocials;
}

export interface PonsV1Launch {
  token: Address;
  deployer: Address;
  pairedToken: Address;
  positionManager: Address;
  positionId: bigint;
  dexId: bigint;
  launchConfigId: bigint;
  restrictionsEndBlock: bigint;
  supply: bigint;
  isToken0: boolean;
  poolFee: number;
  exists: boolean;
  initialBuyAmount: bigint;
}

export interface PonsV1Graduation {
  pairedPrincipal: bigint;
  threshold: bigint;
  graduated: boolean;
  progress: number;
}

export interface PonsV1PriceRatio {
  /** Quote-token units in the ratio numerator. */
  numerator: bigint;
  /** Launch-token units in the ratio denominator. */
  denominator: bigint;
}

/**
 * Converts a Uniswap v3 sqrtPriceX96 into an exact quote-token/token ratio.
 * Consumers can apply token decimals and an ETH/USD oracle without losing
 * precision to JavaScript floating-point arithmetic.
 */
export function ponsV1PriceRatio(
  sqrtPriceX96: bigint,
  tokenIsToken0: boolean,
): PonsV1PriceRatio {
  if (sqrtPriceX96 <= 0n) throw new Error("sqrtPriceX96 must be positive");
  const squared = sqrtPriceX96 * sqrtPriceX96;
  const q192 = 2n ** 192n;
  return tokenIsToken0
    ? { numerator: squared, denominator: q192 }
    : { numerator: q192, denominator: squared };
}

export class PonsV1Client {
  constructor(
    private readonly transport: EvmTransport,
    private readonly factory: Address = PONS_V1_CONTRACTS.factory,
  ) {}

  async getTokenMetadata(token: Address): Promise<PonsV1TokenMetadata> {
    const read = <T>(functionName: string) =>
      this.transport.readContract<T>({
        address: token,
        abi: PONS_V1_TOKEN_ABI,
        functionName,
      });
    const [name, symbol, decimals, totalSupply, logo, description, pool, socialsResult] =
      await Promise.all([
        read<string>("name"),
        read<string>("symbol"),
        read<number>("decimals"),
        read<bigint>("totalSupply"),
        read<string>("logo"),
        read<string>("description"),
        read<Address>("liquidityPool"),
        read<PonsSocials | readonly [string, string, string, string, string]>("socials"),
      ]);
    const socials = Array.isArray(socialsResult)
      ? {
          twitter: socialsResult[0] ?? "",
          telegram: socialsResult[1] ?? "",
          discord: socialsResult[2] ?? "",
          website: socialsResult[3] ?? "",
          farcaster: socialsResult[4] ?? "",
        }
      : socialsResult as PonsSocials;
    return { name, symbol, decimals, totalSupply, logo, description, pool, socials };
  }

  async getLaunch(token: Address): Promise<PonsV1Launch> {
    return this.transport.readContract<PonsV1Launch>({
      address: this.factory,
      abi: PONS_V1_FACTORY_ABI,
      functionName: "getLaunchedToken",
      args: [token],
    });
  }

  async getGraduation(token: Address): Promise<PonsV1Graduation> {
    const result = await this.transport.readContract<
      readonly [bigint, bigint, boolean]
    >({
      address: this.factory,
      abi: PONS_V1_FACTORY_ABI,
      functionName: "graduationStatus",
      args: [token],
    });
    const [pairedPrincipal, threshold, graduated] = result;
    const progress = threshold === 0n
      ? 0
      : Number((pairedPrincipal * 10_000n) / threshold) / 10_000;
    return { pairedPrincipal, threshold, graduated, progress: Math.min(progress, 1) };
  }
}

export interface PonsV2LaunchConfig {
  id: bigint;
  supply: bigint;
  curveFeeBps: bigint;
  phantomQuote: bigint;
  graduationThreshold: bigint;
  poolFee: number;
  tickSpacing: number;
  enabled: boolean;
}

export interface PonsV2TokenParams {
  name: string;
  symbol: string;
  logo: string;
  description: string;
  socials: PonsSocials;
  creatorFeeRecipient: Address;
  creatorTaxBps: number;
  buybackEnabled: boolean;
  expectedEconomics: Hex;
  salt: Hex;
}

export interface PonsV2Launch {
  token: Address;
  curve: Address;
  deployer: Address;
  creatorFeeRecipient: Address;
  pairToken: Address;
  graduationThreshold: bigint;
  poolFee: number;
  tickSpacing: number;
  creatorTaxBps: number;
  buybackEnabled: boolean;
  phase: 0 | 1 | 2 | 3;
  sweptQuote: bigint;
  sweptTokens: bigint;
  sweptAt: bigint;
  exists: boolean;
}

export interface PonsV2QuoteState {
  quoteReserve: bigint;
  tokenReserve: bigint;
  sellableTokens: bigint;
  feeBps: bigint;
  creatorTaxBps: bigint;
  snipeTaxBps: bigint;
}

export interface PonsV2BuyQuote {
  tokensOut: bigint;
  spent: bigint;
  refund: bigint;
}

export interface PonsV2PairTokenEconomics {
  approved: boolean;
  phantomQuote: bigint;
  graduationThreshold: bigint;
  decimals: number;
}

const BPS = 10_000n;

function amountOut(inAmount: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (inAmount < 0n || reserveIn <= 0n || reserveOut <= 0n) {
    throw new Error("Quote amounts and reserves must be positive");
  }
  return (inAmount * reserveOut) / (reserveIn + inAmount);
}

function amountIn(outAmount: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (outAmount < 0n || reserveIn <= 0n || reserveOut <= outAmount) {
    throw new Error("Requested output exceeds available reserves");
  }
  return (outAmount * reserveIn) / (reserveOut - outAmount) + 1n;
}

function ceilDiv(a: bigint, b: bigint): bigint {
  if (a < 0n || b <= 0n) throw new Error("Invalid division operands");
  return (a + b - 1n) / b;
}

export function quotePonsV2Buy(quoteIn: bigint, state: PonsV2QuoteState): PonsV2BuyQuote {
  if (quoteIn < 0n) throw new Error("quoteIn cannot be negative");
  let snipeTaxBps = state.snipeTaxBps;
  if (snipeTaxBps > 0n) {
    const maximum = BPS - state.feeBps - state.creatorTaxBps - 100n;
    if (maximum < 0n) throw new Error("Combined Pons fees leave no valid trade amount");
    snipeTaxBps = snipeTaxBps > maximum ? maximum : snipeTaxBps;
  }
  const totalBps = state.feeBps + state.creatorTaxBps + snipeTaxBps;
  if (totalBps >= BPS) throw new Error("Combined Pons fees must be below 100%");

  let spent = quoteIn;
  const net = spent
    - (spent * state.feeBps) / BPS
    - (spent * state.creatorTaxBps) / BPS
    - (spent * snipeTaxBps) / BPS;
  let tokensOut = amountOut(net, state.quoteReserve, state.tokenReserve);

  if (tokensOut > state.sellableTokens) {
    tokensOut = state.sellableTokens;
    const requiredNet = amountIn(tokensOut, state.quoteReserve, state.tokenReserve);
    const grossed = ceilDiv(requiredNet * BPS, BPS - totalBps);
    spent = grossed < quoteIn ? grossed : quoteIn;
  }
  return { tokensOut, spent, refund: quoteIn - spent };
}

export function quotePonsV2Sell(
  tokensIn: bigint,
  state: Pick<PonsV2QuoteState, "quoteReserve" | "tokenReserve" | "feeBps" | "creatorTaxBps">,
): bigint {
  const gross = amountOut(tokensIn, state.tokenReserve, state.quoteReserve);
  return gross
    - (gross * state.feeBps) / BPS
    - (gross * state.creatorTaxBps) / BPS;
}

export class PonsV2Client {
  constructor(
    private readonly transport: EvmTransport,
    private readonly factory: Address = PONS_V2_CONTRACTS.factory,
  ) {}

  async listOpenLaunchConfigs(): Promise<PonsV2LaunchConfig[]> {
    const count = await this.transport.readContract<bigint>({
      address: this.factory,
      abi: PONS_V2_FACTORY_ABI,
      functionName: "launchConfigCount",
    });
    const configs = await Promise.all(
      Array.from({ length: Number(count) }, async (_, id) => {
        const config = await this.transport.readContract<Omit<PonsV2LaunchConfig, "id">>({
          address: this.factory,
          abi: PONS_V2_FACTORY_ABI,
          functionName: "getLaunchConfig",
          args: [BigInt(id)],
        });
        return { id: BigInt(id), ...config };
      }),
    );
    return configs.filter((config) => config.enabled);
  }

  async canLaunch(account: Address): Promise<boolean> {
    return this.transport.readContract<boolean>({
      address: this.factory,
      abi: PONS_V2_FACTORY_ABI,
      functionName: "canLaunch",
      args: [account],
    });
  }

  async getLaunch(token: Address): Promise<PonsV2Launch> {
    return this.transport.readContract<PonsV2Launch>({
      address: this.factory,
      abi: PONS_V2_FACTORY_ABI,
      functionName: "getLaunchedToken",
      args: [token],
    });
  }

  async getPairTokenEconomics(pairToken: Address): Promise<PonsV2PairTokenEconomics> {
    const [approved, economics] = await Promise.all([
      this.transport.readContract<boolean>({
        address: this.factory,
        abi: PONS_V2_FACTORY_ABI,
        functionName: "approvedPairTokens",
        args: [pairToken],
      }),
      this.transport.readContract<readonly [bigint, bigint, number]>({
        address: this.factory,
        abi: PONS_V2_FACTORY_ABI,
        functionName: "pairTokenEconomics",
        args: [pairToken],
      }),
    ]);
    return {
      approved,
      phantomQuote: economics[0],
      graduationThreshold: economics[1],
      decimals: economics[2],
    };
  }

  async getQuoteState(curve: Address, recipient: Address): Promise<PonsV2QuoteState> {
    const read = <T>(functionName: string, args?: readonly unknown[]) =>
      this.transport.readContract<T>({
        address: curve,
        abi: PONS_V2_CURVE_ABI,
        functionName,
        args,
      });
    const [reserves, sellableTokens, feeBps, creatorTaxBps, snipeTaxBps] =
      await Promise.all([
        read<readonly [bigint, bigint]>("getReserves"),
        read<bigint>("sellableTokens"),
        read<bigint>("feeBps"),
        read<bigint>("creatorTaxBps"),
        read<bigint>("currentSnipeTaxBps", [recipient]),
      ]);
    return {
      quoteReserve: reserves[0],
      tokenReserve: reserves[1],
      sellableTokens,
      feeBps,
      creatorTaxBps,
      snipeTaxBps,
    };
  }

  async prepareLaunchParams(
    params: Omit<PonsV2TokenParams, "expectedEconomics">,
    launchConfigId: bigint,
    pairToken: Address = ZERO_ADDRESS,
  ): Promise<{ params: PonsV2TokenParams; launchFee: bigint }> {
    const [expectedEconomics, launchFee] = await Promise.all([
      this.transport.readContract<Hex>({
        address: this.factory,
        abi: PONS_V2_FACTORY_ABI,
        functionName: "previewLaunchEconomics",
        args: [launchConfigId, pairToken],
      }),
      this.transport.readContract<bigint>({
        address: this.factory,
        abi: PONS_V2_FACTORY_ABI,
        functionName: "launchFee",
      }),
    ]);
    return { params: { ...params, expectedEconomics }, launchFee };
  }

  async launchToken(
    params: PonsV2TokenParams,
    launchConfigId: bigint,
    pairToken: Address,
    launchFee: bigint,
    snipeTaxExemptions: readonly Address[] = [],
  ): Promise<Hex> {
    if (snipeTaxExemptions.length > 32) {
      throw new Error("Pons v2 accepts at most 32 snipe-tax exemptions");
    }
    const write = requireWriteTransport(this.transport);
    return write({
      address: this.factory,
      abi: PONS_V2_FACTORY_ABI,
      functionName: "launchToken",
      args: snipeTaxExemptions.length === 0
        ? [params, launchConfigId, pairToken]
        : [params, launchConfigId, pairToken, snipeTaxExemptions],
      value: launchFee,
    });
  }

  async approveQuoteAsset(pairToken: Address, curve: Address, quoteIn: bigint): Promise<Hex> {
    return this.approveToken(pairToken, curve, quoteIn);
  }

  async approveToken(token: Address, spender: Address, amount: bigint): Promise<Hex> {
    return requireWriteTransport(this.transport)({
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, amount],
    });
  }

  async buy(
    curve: Address,
    quoteIn: bigint,
    minTokensOut: bigint,
    recipient: Address,
    nativeQuote: boolean,
  ): Promise<Hex> {
    return requireWriteTransport(this.transport)({
      address: curve,
      abi: PONS_V2_CURVE_ABI,
      functionName: "buy",
      args: [quoteIn, minTokensOut, recipient],
      value: nativeQuote ? quoteIn : undefined,
    });
  }

  async sell(
    curve: Address,
    tokensIn: bigint,
    minQuoteOut: bigint,
    recipient: Address,
  ): Promise<Hex> {
    return requireWriteTransport(this.transport)({
      address: curve,
      abi: PONS_V2_CURVE_ABI,
      functionName: "sell",
      args: [tokensIn, minQuoteOut, recipient],
    });
  }
}
