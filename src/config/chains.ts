import type { ChainConfig } from "../types/index.js";

type _EnvVars = "ETHERSCAN_KEY" | "BSCSCAN_KEY" | "HELIUS_KEY" | "SOLSCAN_KEY";

export const CHAINS: Record<string, ChainConfig> = {
  eth: {
    name: "Ethereum",
    chainId: 1,
    rpc: process.env.ETH_RPC_URL || "https://eth.drpc.org",
    explorerApi: "https://api.etherscan.io/v2/api",
    explorerKeyEnv: "ETHERSCAN_KEY",
    coingeckoId: "ethereum",
  },
  bsc: {
    name: "BSC",
    chainId: 56,
    rpc: process.env.BSC_RPC_URL || "https://bsc-dataseed1.binance.org",
    explorerApi: "https://api.etherscan.io/v2/api",
    explorerKeyEnv: "ETHERSCAN_KEY",
    coingeckoId: "binancecoin",
  },
  sol: {
    name: "Solana",
    chainId: 0,
    rpc: process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    explorerApi: "https://public-api.solscan.io",
    explorerKeyEnv: "SOLSCAN_KEY",
    coingeckoId: "solana",
  },
};

export function getChain(chainInput: string): ChainConfig {
  const key = chainInput.toLowerCase().trim();
  if (CHAINS[key]) return CHAINS[key];
  const found = Object.entries(CHAINS).find(([, c]) => c.name.toLowerCase() === key);
  if (found) return found[1];
  throw new Error(`Unknown chain: "${chainInput}". Supported: ${Object.keys(CHAINS).join(", ")}`);
}

export function getSolanaRpcUrl(): string {
  return process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
}

export function getExplorerKey(chain: ChainConfig): string {
  const key = process.env[chain.explorerKeyEnv];
  if (!key) {
    console.warn(`⚠ ${chain.explorerKeyEnv} not set. Using free tier (5 req/s limit).`);
    return "";
  }
  return key;
}
