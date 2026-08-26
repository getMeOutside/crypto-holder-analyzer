import axios from "axios";
import type { ChainConfig } from "../types/index.js";
import { HOLDER_PERIODS_DAYS, SECONDS_PER_DAY } from "../constants.js";

const chainMap: Record<string, string> = {
  Ethereum: "ethereum",
  Solana: "solana",
};

function normalizeAddress(address: string, chainName: string): string {
  if (chainName === "Solana") return address;
  return address.toLowerCase();
}

interface LlamaResponse {
  coins: Record<
    string,
    {
      symbol?: string;
      decimals?: number;
      price: number;
      timestamp: number;
      confidence?: number;
    }
  >;
}

export interface HistoricalPrices {
  prices: Map<number, number>;
}

export async function fetchHistoricalPrices(
  tokenAddress: string,
  chain: ChainConfig,
): Promise<HistoricalPrices> {
  const llamaChain = chainMap[chain.name];
  if (!llamaChain) throw new Error(`No DeFiLlama chain for ${chain.name}`);

  const addr = normalizeAddress(tokenAddress, chain.name);
  const key = `${llamaChain}:${addr}`;
  const now = Math.floor(Date.now() / 1000);

  const results = await Promise.allSettled(
    HOLDER_PERIODS_DAYS.map(async (daysAgo) => {
      const ts = now - daysAgo * SECONDS_PER_DAY;
      const url = `https://coins.llama.fi/prices/historical/${ts}/${key}`;
      const { data } = await axios.get<LlamaResponse>(url);
      const price = data.coins[key]?.price;
      return { daysAgo, price };
    }),
  );

  const prices = new Map<number, number>();
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.price > 0) {
      prices.set(r.value.daysAgo, r.value.price);
    }
  }

  return { prices };
}
