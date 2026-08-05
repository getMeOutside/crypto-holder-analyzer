import axios from "axios";
import type { ChainConfig } from "../types/index.js";

export async function fetchTokenPrice(tokenAddress: string, chain: ChainConfig): Promise<number> {
  try {
    return await fetchPriceCoinGecko(tokenAddress, chain);
  } catch (e) {
    console.warn(`CoinGecko failed: ${(e as Error).message}`);
  }

  try {
    return await fetchPriceDefiLlama(tokenAddress, chain);
  } catch (e) {
    console.warn(`DeFiLlama failed: ${(e as Error).message}`);
  }

  console.warn("Could not fetch price from any source");
  return 0;
}

function normalizeAddress(address: string, chainName: string): string {
  // Solana addresses are base58, case-sensitive — keep as-is
  if (chainName === "Solana") return address;
  return address.toLowerCase();
}

async function fetchPriceCoinGecko(tokenAddress: string, chain: ChainConfig): Promise<number> {
  const platformMap: Record<string, string> = {
    Ethereum: "ethereum",
    BSC: "binance-smart-chain",
    Solana: "solana",
  };

  const platform = platformMap[chain.name];
  if (!platform) throw new Error(`No CoinGecko platform for ${chain.name}`);

  const apiKey = process.env.COINGECKO_KEY;
  const baseUrl = apiKey
    ? "https://pro-api.coingecko.com/api/v3"
    : "https://api.coingecko.com/api/v3";

  const headers: Record<string, string> = {};
  if (apiKey) headers["x-cg-pro-api-key"] = apiKey;

  const addr = normalizeAddress(tokenAddress, chain.name);
  const url = `${baseUrl}/simple/token_price/${platform}?contract_addresses=${addr}&vs_currencies=usd`;

  const { data } = await axios.get<Record<string, { usd: number }>>(url, { headers });
  const price = data[addr]?.usd;

  if (!price) throw new Error("Token not found on CoinGecko");
  return price;
}

async function fetchPriceDefiLlama(tokenAddress: string, chain: ChainConfig): Promise<number> {
  const chainMap: Record<string, string> = {
    Ethereum: "ethereum",
    BSC: "bsc",
    Solana: "solana",
  };

  const llamaChain = chainMap[chain.name];
  if (!llamaChain) throw new Error(`No DeFiLlama chain for ${chain.name}`);

  const addr = normalizeAddress(tokenAddress, chain.name);
  const key = `${llamaChain}:${addr}`;
  const url = `https://coins.llama.fi/prices/current/${key}`;

  const { data } = await axios.get<{ coins: Record<string, { price: number }> }>(url);

  const price = data.coins[key]?.price;
  if (!price) throw new Error("Token not found on DeFiLlama");
  return price;
}
