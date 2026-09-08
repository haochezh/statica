import type { Address } from "./evm";

export interface EvmChainConfig {
  id: number;
  name: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: { default: { http: readonly string[]; webSocket?: readonly string[] } };
  blockExplorers: { default: { name: string; url: string } };
  testnet?: boolean;
}

export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_CHAIN_TESTNET_ID = 46630;

export const robinhoodChain = {
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://rpc.mainnet.chain.robinhood.com"],
      webSocket: ["wss://feed.mainnet.chain.robinhood.com"],
    },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Chain Explorer",
      url: "https://robinhoodchain.blockscout.com",
    },
  },
} as const satisfies EvmChainConfig;

export const robinhoodChainTestnet = {
  id: ROBINHOOD_CHAIN_TESTNET_ID,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Chain Testnet Explorer",
      url: "https://explorer.testnet.chain.robinhood.com",
    },
  },
  testnet: true,
} as const satisfies EvmChainConfig;

export const ROBINHOOD_STOCK_TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
  "function balanceOfUI(address account) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function totalSupplyUI() view returns (uint256)",
  "function uiMultiplier() view returns (uint256)",
  "function newUIMultiplier() view returns (uint256)",
  "function effectiveAt() view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address recipient, uint256 amount) returns (bool)",
  "event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp)",
  "event TransferWithScaledUI(address indexed from, address indexed to, uint256 value, uint256 uiValue)",
] as const;

export const CHAINLINK_AGGREGATOR_V3_ABI = [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
] as const;

export interface StockTokenDeployment {
  contractAddress: Address;
  chainId: number;
}

export type StockTokenAssetStatus =
  | "ASSET_STATUS_UNSPECIFIED"
  | "ASSET_STATUS_ACTIVE"
  | "ASSET_STATUS_INACTIVE";

export interface StockTokenTradingCapabilities {
  fractionalTradability: string | null;
  allDayTradability: string | null;
  extendedHoursFractionalTradability: boolean | null;
}

export interface StockTokenAsset {
  id: HexString;
  tokenSymbol: string;
  tokenName: string;
  deployments: StockTokenDeployment[];
  currentMultiplier: string;
  pendingMultiplier: string;
  pendingMultiplierEffectiveTime?: string;
  logoUrl: string;
  tradingCapabilities?: StockTokenTradingCapabilities | null;
  status: StockTokenAssetStatus;
}

export interface StockTokenQuote {
  tokenSymbol: string;
  deployments: StockTokenDeployment[];
  bid: string;
  ask: string;
  currency: string;
  dailyTradingVolume: string;
  isTradingHalt: boolean;
  generatedAt: string;
}

export interface StockTokenCorporateAction {
  id: HexString;
  type: string;
  status: string;
  processDate: { year: number; month: number; day: number } | null;
  tokenSymbol: string;
  deployments: StockTokenDeployment[];
  details: Record<string, unknown>;
}

type HexString = `0x${string}`;
type Fetcher = typeof fetch;

export interface RobinhoodStockTokenClientOptions {
  baseUrl?: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
}

export class RobinhoodApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(message);
    this.name = "RobinhoodApiError";
  }
}

export class RobinhoodStockTokenClient {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(options: RobinhoodStockTokenClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "https://api.robinhood.com/rhj").replace(/\/$/, "");
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async listAssets(): Promise<StockTokenAsset[]> {
    const response = await this.get<{ assets: StockTokenAsset[] }>("/assets");
    return response.assets;
  }

  async getPrices(symbol: string): Promise<StockTokenQuote[]> {
    const normalized = symbol.trim().toUpperCase();
    if (!/^[A-Z0-9.-]{1,16}$/.test(normalized)) {
      throw new Error("Stock token symbol contains unsupported characters");
    }
    const response = await this.get<{ quotes: StockTokenQuote[] }>(
      `/prices/${encodeURIComponent(normalized)}`,
    );
    return response.quotes;
  }

  async listCorporateActions(): Promise<StockTokenCorporateAction[]> {
    const response = await this.get<{ corpActions: StockTokenCorporateAction[] }>(
      "/corporate-actions",
    );
    return response.corpActions;
  }

  private async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text();
        throw new RobinhoodApiError(
          `Robinhood Stock Token API request failed (${response.status})`,
          response.status,
          body,
        );
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function applyStockTokenMultiplier(rawAmount: bigint, multiplier: bigint): bigint {
  return (rawAmount * multiplier) / 10n ** 18n;
}
