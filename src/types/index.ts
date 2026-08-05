export interface ChainConfig {
  name: string;
  chainId: number;
  rpc: string;
  explorerApi: string;
  explorerKeyEnv: string;
  coingeckoId: string;
}

export interface TokenInfo {
  address: string;
  chain: string;
  symbol: string;
  name: string;
  decimals: number;
  totalSupply: string;
}

export interface HolderBalance {
  address: string;
  balance: string;
  balanceFormatted: number;
  percentage: number;
}

export interface HolderSnapshot {
  rank: number;
  address: string;
  balance: number;
  percentage: number;
  label?: string;
}

export interface TokenSnapshot {
  timestamp: string;
  date: string;
  token: TokenInfo;
  priceUsd: number;
  holders: HolderSnapshot[];
  totalHolders: number;
}

export interface AnalysisResult {
  currentSnapshot: TokenSnapshot;
  previousSnapshot?: TokenSnapshot;
  firstSnapshot?: TokenSnapshot;
  priceChange: PriceChange | null;
  topHolderChanges: HolderDiff[];
  exchangeFlows: ExchangeFlow[];
  redistribution: RedistributionEvent[];
  summary: string;
}

export interface PriceChange {
  current: number;
  previous: number;
  changePercent: number;
  firstPrice?: number;
  firstPriceChangePercent?: number;
}

export interface HolderDiff {
  rank: number;
  address: string;
  label?: string;
  currentBalance: number;
  previousBalance: number;
  balanceChange: number;
  changePercent: number;
  currentPercentage: number;
  previousPercentage: number;
  action: "increased" | "decreased" | "new" | "unchanged" | "exited";
}

export interface ExchangeFlow {
  exchange: string;
  address: string;
  currentBalance: number;
  previousBalance?: number;
  firstBalance?: number;
  weeklyChange: number;
  totalChange: number;
  totalChangePercent: number;
}

export interface RedistributionEvent {
  address: string;
  balance: number;
  previousBalance: number;
  changePercent: number;
  direction: "accumulating" | "distributing";
}

export const KNOWN_EXCHANGES: Record<string, string> = {
  "0x28c6c06298d514db089934071355e5743bf21d60": "Binance",
  "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance",
  "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": "Binance",
  "0x56eddb7aa87536c09ccc2793473599fd21a8b17f": "Binance",
  "0x9696f59e4d72e237be84ffd425dcad154bf96976": "Binance",
  "0xf977814e90da44bfa03b6295a0616a897441acec": "Binance",
  "0x8894e0a0c962cb723c1ef8a1b2c6d40afc8e8b2e": "Binance",
  "0xe2fc31f816a9b94326492132018c3aecc4a93ae1": "Binance",
  "0x3c783c21a0383057d128bae431894a5c19f9cf06": "Binance",
  "0xbe0eb53f46cd790cd13851d5eff43d12404d33e8": "Binance",
  "0x8103683202aa8da10536036edef04cdd865c225e": "Binance",
  "0xab83d182f3485cf1d6ccdd34c7cfef95b4c08da4": "Binance",
  "0x1151314c646ce4e0efd76d1af4760ae66a9fe30f": "Bitfinex",
  "0x742d35cc6634c0532925a3b844bc9e7595f2bd1e": "Bitfinex",
  "0x876eabf441b2ee5b5b0554fd502a8e0600950cfa": "Bitfinex",
  "0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0": "Kraken",
  "0x2910543af39aba0cd09dbb2d50200b3e800a63d2": "Kraken",
  "0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13": "Kraken",
  "0xa7efae728d2936e78bda97dc267687568dd593f3": "Coinbase",
  "0x71660c4005ba85c37ccec55d0c4493e66fe775d3": "Coinbase",
  "0x503828976d22510aad0201ac7ec88293211d23da": "Coinbase",
  "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43": "Coinbase",
  "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740": "Coinbase",
  "0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503": "OKX",
  "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": "OKX",
  "0x236f8c3b4097226171663c0844b4a14cdfe02584": "OKX",
  "0xa7efca01ffc6c0f872863f04c42e3b2e07a0da86": "Bybit",
  "0xf89d7b9c864f589bbf53a82105107622b35eaa40": "Bybit",
  "0x28c6c06298d514db089934071355e5743bf21d61": "HTX",

  // Solana exchange addresses
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1": "Raydium",
  "9W959DqEETiGZocYWCQPaJ6sBPMUzS5JiBM6b3cjk3bb": "Binance",
  AC5RDfQFmDS1VDWFC8w3S8f3d3nSEbYzVj3p95U5d625: "Coinbase",
  FpwQQhPrnh7qz94jGBs4mahTTKEm1hFKvZ6G3w9Fk9E7: "Bybit",
  "3N7LRs2Hj8RqwdPowkFPpJMKaToFQnMR33zParchXDy4": "OKX",
  u6PJ8DtQuPFnfmwHbGFULQ4u4EgjDiyXK3DgP4Mb2Ms: "HTX",
};
