import axios from "axios";
import { ethers } from "ethers";
import { createSolanaRpc, address as solAddress, getProgramDerivedAddress } from "@solana/kit";
import { getBase58Encoder, getBase58Decoder } from "@solana/codecs-strings";
import type { ChainConfig, TokenInfo, HolderBalance } from "../types/index.js";
import { getExplorerKey, getSolanaRpcUrl } from "../config/chains.js";
import {
  DEFAULT_HOLDER_LIMIT,
  MAX_RETRY_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  EVM_REQUEST_DELAY_MS,
} from "../constants.js";

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

// ─── Solana RPC (via @solana/kit) ───

function getSolanaRpc() {
  return createSolanaRpc(getSolanaRpcUrl());
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  attempts = MAX_RETRY_ATTEMPTS,
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const is429 = message.includes("429") || message.includes("Too Many Requests");
      if (!is429 || i === attempts - 1) throw err;
      const delay = RETRY_BASE_DELAY_MS * 2 ** i;
      console.warn(`⚠ ${label}: 429, retry in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(`${label}: exhausted retries`);
}

// ─── Metaplex Token Metadata helpers ───

const base58Encode = getBase58Encoder();
const base58Decode = getBase58Decoder();
const METADATA_PROGRAM_ID = solAddress("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const METADATA_PROGRAM_ID_BYTES = base58Encode.encode(METADATA_PROGRAM_ID);

async function findMetadataAddress(mint: string): Promise<string> {
  const mintBytes = base58Encode.encode(solAddress(mint));
  const [pda] = await getProgramDerivedAddress({
    programAddress: METADATA_PROGRAM_ID,
    seeds: ["metadata", METADATA_PROGRAM_ID_BYTES, mintBytes],
  });
  return pda;
}

interface MetaplexMetadata {
  name: string;
  symbol: string;
}

function parseMetaplexMetadata(buf: Uint8Array): MetaplexMetadata {
  // Layout: key(1) + updateAuthority(32) + mint(32)
  //         + nameAllocLen(4) + name(allocLen)
  //         + symbolAllocLen(4) + symbol(allocLen) + ...
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  const nameAllocLen = view.getUint32(65, true);
  const nameEnd = 69 + nameAllocLen;
  const name = new TextDecoder().decode(buf.slice(69, nameEnd)).replace(/\0/g, "").trim();

  const symbolAllocLen = view.getUint32(nameEnd, true);
  const symbolStart = nameEnd + 4;
  const symbol = new TextDecoder()
    .decode(buf.slice(symbolStart, symbolStart + symbolAllocLen))
    .replace(/\0/g, "")
    .trim();

  return { name, symbol };
}

async function fetchTokenInfoSolana(mint: string): Promise<TokenInfo> {
  const rpc = getSolanaRpc();
  const addr = solAddress(mint);
  const supplyInfo = await withRetry(() => rpc.getTokenSupply(addr).send(), "getTokenSupply");
  const { uiAmount, decimals } = supplyInfo.value;
  const supply = uiAmount ?? 0;

  let symbol = "UNKNOWN";
  let name = "Unknown Token";
  try {
    const metadataPda = solAddress(await findMetadataAddress(mint));
    const metaAccount = await withRetry(
      () => rpc.getAccountInfo(metadataPda, { encoding: "base64" }).send(),
      "getAccountInfo(metadata)",
    );
    const data = metaAccount.value?.data;
    if (Array.isArray(data) && typeof data[0] === "string") {
      const buf = Buffer.from(data[0], "base64");
      const decoded = parseMetaplexMetadata(buf);
      if (decoded.name) name = decoded.name;
      if (decoded.symbol) symbol = decoded.symbol;
    }
  } catch {
    // Metadata fetch is best-effort; defaults remain
  }

  return {
    address: mint,
    chain: "Solana",
    symbol,
    name,
    decimals,
    totalSupply: String(Math.round(supply * 10 ** decimals)),
  };
}

async function fetchTopHoldersSolana(mint: string, limit: number): Promise<HolderBalance[]> {
  const rpc = getSolanaRpc();
  const addr = solAddress(mint);

  const largest = await withRetry(
    () => rpc.getTokenLargestAccounts(addr).send(),
    "getTokenLargestAccounts",
  );

  const supplyInfo = await withRetry(() => rpc.getTokenSupply(addr).send(), "getTokenSupply");

  const totalSupply = Number(supplyInfo.value.uiAmount);
  const tokenAccounts = largest.value.slice(0, limit);

  // Resolve owner addresses from token accounts (each token account has an owner at offset 32)
  let ownerAddresses: string[];
  try {
    const accountAddresses = tokenAccounts.map((acc) => solAddress(acc.address));
    const batch = await withRetry(
      () => rpc.getMultipleAccounts(accountAddresses, { encoding: "base64" }).send(),
      "getMultipleAccounts",
    );
    ownerAddresses = batch.value.map((acc, i) => {
      if (acc?.data && Array.isArray(acc.data) && typeof acc.data[0] === "string") {
        const buf = Buffer.from(acc.data[0], acc.data[1] as BufferEncoding);
        const ownerBytes = buf.slice(SPL_TOKEN_OWNER_OFFSET, SPL_TOKEN_OWNER_OFFSET + 32);
        return base58Decode.decode(new Uint8Array(ownerBytes));
      }
      return tokenAccounts[i].address; // fallback to token account address
    });
  } catch {
    ownerAddresses = tokenAccounts.map((acc) => acc.address);
  }

  return tokenAccounts.map((acc, i) => ({
    address: ownerAddresses[i],
    balance: acc.amount,
    balanceFormatted: acc.uiAmount ?? 0,
    percentage: totalSupply > 0 ? ((acc.uiAmount ?? 0) / totalSupply) * 100 : 0,
  }));
}

// ─── SPL Token Account layout ───

const SPL_TOKEN_OWNER_OFFSET = 32;

// ─── EVM (Etherscan-style) ───

export async function fetchTokenInfo(address: string, chain: ChainConfig): Promise<TokenInfo> {
  if (chain.name === "Solana") return fetchTokenInfoSolana(address);

  const provider = new ethers.JsonRpcProvider(chain.rpc, chain.chainId, { batchMaxCount: 1 });
  const contract = new ethers.Contract(address, ERC20_ABI, provider);

  const [symbol, name, decimals, totalSupply] = await Promise.all([
    contract.symbol().catch(() => "UNKNOWN"),
    contract.name().catch(() => "Unknown Token"),
    contract.decimals().catch(() => 18n),
    contract.totalSupply(),
  ]);

  return {
    address: address.toLowerCase(),
    chain: chain.name,
    symbol,
    name,
    decimals: Number(decimals),
    totalSupply: totalSupply.toString(),
  };
}

export async function fetchTopHolders(
  address: string,
  chain: ChainConfig,
  limit: number = DEFAULT_HOLDER_LIMIT,
): Promise<HolderBalance[]> {
  if (chain.name === "Solana") return fetchTopHoldersSolana(address, limit);

  const apiKey = getExplorerKey(chain);

  if (chain.explorerApi.includes("etherscan")) {
    return fetchHoldersEtherscan(address, chain, apiKey, limit);
  }

  throw new Error(`Unsupported explorer for chain: ${chain.name}`);
}

async function fetchHoldersEtherscan(
  address: string,
  chain: ChainConfig,
  apiKey: string,
  limit: number,
): Promise<HolderBalance[]> {
  const provider = new ethers.JsonRpcProvider(chain.rpc, chain.chainId, { batchMaxCount: 1 });
  const contract = new ethers.Contract(address, ERC20_ABI, provider);

  const [decimals, totalSupplyBigInt] = await Promise.all([
    contract.decimals(),
    contract.totalSupply(),
  ]);
  const decimalsNum = Number(decimals);
  const totalSupplyFormatted = Number(ethers.formatUnits(totalSupplyBigInt, decimalsNum));

  // Try Blockscout first (free, no API key needed)
  if (chain.chainId === 1) {
    const blockscoutUrl = "https://eth.blockscout.com";
    
    const holders: HolderBalance[] = [];
    let nextPageParams: Record<string, string> | null = null;

    while (holders.length < limit) {
      try {
        const url = nextPageParams 
          ? `${blockscoutUrl}/api/v2/tokens/${address}/holders`
          : `${blockscoutUrl}/api/v2/tokens/${address}/holders`;
        
        const { data } = await axios.get<{ items: unknown[]; next_page_params: Record<string, string> | null }>(
          url,
          { params: nextPageParams || {} },
        );

        if (!data.items || data.items.length === 0) break;

        for (const item of data.items) {
          const entry = item as Record<string, unknown>;
          const addressEntry = entry.address as Record<string, string>;
          const value = entry.value || entry.token_balance;
          if (!value) continue;
          
          const balanceBigInt = BigInt(value as string);
          const balanceFormatted = Number(ethers.formatUnits(balanceBigInt, decimalsNum));

          if (balanceFormatted > 0) {
            holders.push({
              address: (addressEntry.hash || addressEntry.address || "").toLowerCase(),
              balance: value as string,
              balanceFormatted,
              percentage: (balanceFormatted / totalSupplyFormatted) * 100,
            });
          }
        }

        nextPageParams = data.next_page_params;
        if (!nextPageParams) break;
        
        await new Promise((r) => setTimeout(r, EVM_REQUEST_DELAY_MS));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`⚠ Blockscout API failed: ${message}`);
        break;
      }
    }

    if (holders.length > 0) {
      holders.sort((a, b) => b.balanceFormatted - a.balanceFormatted);
      return holders.slice(0, limit);
    }
  }

  // Fallback to Etherscan API Pro (requires paid plan)
  if (!apiKey || apiKey.includes("your_")) {
    console.warn("⚠ No API key or Blockscout failed. Results may be incomplete.");
    return [];
  }

  const holders: HolderBalance[] = [];
  const maxPages = Math.ceil(limit / 100);

  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      module: "token",
      action: "tokenholderlist",
      contractaddress: address,
      page: String(page),
      offset: "100",
      chainid: String(chain.chainId),
      apikey: apiKey,
    });

    const { data } = await axios.get<{ status: string; message: string; result: unknown[] }>(
      chain.explorerApi,
      { params },
    );

    if (data.status !== "1" || !Array.isArray(data.result)) {
      console.warn(`⚠ Etherscan API returned: ${data.result || data.message}`);
      break;
    }

    for (const item of data.result) {
      const entry = item as Record<string, string>;
      const balanceBigInt = BigInt(entry.TokenHolderQuantity);
      const balanceFormatted = Number(ethers.formatUnits(balanceBigInt, decimalsNum));

      if (balanceFormatted > 0) {
        holders.push({
          address: entry.TokenHolderAddress.toLowerCase(),
          balance: entry.TokenHolderQuantity,
          balanceFormatted,
          percentage: (balanceFormatted / totalSupplyFormatted) * 100,
        });
      }
    }

    if (data.result.length < 100) break;
    await new Promise((r) => setTimeout(r, EVM_REQUEST_DELAY_MS));
  }

  holders.sort((a, b) => b.balanceFormatted - a.balanceFormatted);
  if (holders.length > 0) return holders.slice(0, limit);

  return holders.slice(0, limit);
}
