import axios from "axios";
import type { ChainConfig, TradingActivity } from "../types/index.js";

interface DexScreenerPair {
  dexId: string;
  pairAddress: string;
  url: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceUsd?: string;
  marketCap?: number;
  fdv?: number;
  volume: { h24: number; h6: number; h1: number; m5: number };
  txns: {
    h24: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    m5: { buys: number; sells: number };
  };
  liquidity?: { usd: number; base: number; quote: number };
  pairCreatedAt?: number;
  priceChange?: { h24?: number };
  info?: { imageUrl?: string };
}

export async function fetchTradingActivity(
  tokenAddress: string,
  chain: ChainConfig,
): Promise<TradingActivity | null> {
  try {
    const url = `https://api.dexscreener.com/tokens/v1/${chain.dexscreenerId}/${tokenAddress}`;
    const { data } = await axios.get<DexScreenerPair[]>(url, { timeout: 10_000 });

    if (!Array.isArray(data) || data.length === 0) return null;

    const pair = data[0];
    return {
      dex: pair.dexId,
      pairAddress: pair.pairAddress,
      pairUrl: pair.url,
      quoteToken: pair.quoteToken.symbol,
      volume24h: pair.volume.h24,
      txns24h: {
        buys: pair.txns.h24.buys,
        sells: pair.txns.h24.sells,
      },
      liquidityUsd: pair.liquidity?.usd,
      pairCreatedAt: pair.pairCreatedAt,
      priceUsd: pair.priceUsd ? parseFloat(pair.priceUsd) : undefined,
      marketCap: pair.marketCap ?? pair.fdv,
      name: pair.baseToken.name,
      symbol: pair.baseToken.symbol,
      imageUrl: pair.info?.imageUrl,
      priceChange: pair.priceChange,
    };
  } catch {
    console.warn("⚠ DexScreener: не удалось получить данные по торговой паре");
    return null;
  }
}
