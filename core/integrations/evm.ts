export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export interface ContractReadRequest {
  address: Address;
  abi: readonly string[];
  functionName: string;
  args?: readonly unknown[];
}

export interface ContractWriteRequest extends ContractReadRequest {
  value?: bigint;
}

/**
 * Small adapter boundary for viem, ethers, or an injected wallet provider.
 * Keeping the integration transport-agnostic lets web, desktop, and agents
 * share the same Robinhood Chain logic without importing a wallet library.
 */
export interface EvmTransport {
  readContract<T>(request: ContractReadRequest): Promise<T>;
  writeContract?(request: ContractWriteRequest): Promise<Hex>;
}

export function requireWriteTransport(
  transport: EvmTransport,
): NonNullable<EvmTransport["writeContract"]> {
  if (!transport.writeContract) {
    throw new Error("This operation requires a wallet-enabled EVM transport");
  }
  return transport.writeContract.bind(transport);
}
