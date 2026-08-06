import axios from "axios";
import { ethers } from "ethers";
import { createSolanaRpc, address as solAddress, getProgramDerivedAddress } from "@solana/kit";
import { getBase58Encoder } from "@solana/codecs-strings";
import type { ChainConfig, TokenInfo, HolderBalance } from "../types/index.js";
import { getExplorerKey, getSolanaRpcUrl } from "../config/chains.js";
import {
  DEFAULT_HOLDER_LIMIT,
  MAX_RETRY_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  EVM_BLOCKS_TO_SCAN,
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

  return largest.value.slice(0, limit).map((acc) => ({
    address: acc.address,
    balance: acc.amount,
    balanceFormatted: acc.uiAmount ?? 0,
    percentage: totalSupply > 0 ? ((acc.uiAmount ?? 0) / totalSupply) * 100 : 0,
  }));
}

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

  if (chain.explorerApi.includes("etherscan") || chain.explorerApi.includes("bscscan")) {
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
  if (!apiKey || apiKey.includes("your_")) {
    console.warn("⚠ ETHERSCAN_KEY is not set. Get a free key at https://etherscan.io/register");
    return [];
  }

  const provider = new ethers.JsonRpcProvider(chain.rpc, chain.chainId, { batchMaxCount: 1 });
  const contract = new ethers.Contract(address, ERC20_ABI, provider);

  const [totalSupply, decimals, currentBlock] = await Promise.all([
    contract.totalSupply(),
    contract.decimals(),
    provider.getBlockNumber(),
  ]);
  const totalSupplyNum = Number(ethers.formatUnits(totalSupply, decimals));

  const blocksToScan = EVM_BLOCKS_TO_SCAN;
  const fromBlock = Math.max(0, currentBlock - blocksToScan);
  const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

  const balances = new Map<string, bigint>();

  let startBlock = fromBlock;
  while (startBlock <= currentBlock) {
    const endBlock = Math.min(startBlock + 4999, currentBlock);
    const params = new URLSearchParams({
      module: "logs",
      action: "getLogs",
      address,
      fromBlock: String(startBlock),
      toBlock: String(endBlock),
      topic0: TRANSFER_TOPIC,
      chainid: String(chain.chainId),
    });
    if (apiKey) params.set("apikey", apiKey);

    const { data } = await axios.get<{ status: string; message: string; result: unknown[] }>(
      chain.explorerApi,
      { params },
    );
    if (data.status === "1" && Array.isArray(data.result)) {
      for (const log of data.result) {
        const l = log as Record<string, string>;
        const from = ethers.getAddress("0x" + l.topics[1].slice(26));
        const to = ethers.getAddress("0x" + l.topics[2].slice(26));
        const value = BigInt(l.data);

        if (from !== ethers.ZeroAddress && from !== to) {
          balances.set(from.toLowerCase(), (balances.get(from.toLowerCase()) || 0n) - value);
        }
        if (to !== ethers.ZeroAddress && from !== to) {
          balances.set(to.toLowerCase(), (balances.get(to.toLowerCase()) || 0n) + value);
        }
      }
    }

    await new Promise((r) => setTimeout(r, EVM_REQUEST_DELAY_MS));
    startBlock = endBlock + 1;
  }

  const holders: HolderBalance[] = [];
  for (const [addr, bal] of balances) {
    if (bal > 0n) {
      const formatted = Number(ethers.formatUnits(bal, decimals));
      holders.push({
        address: addr,
        balance: bal.toString(),
        balanceFormatted: formatted,
        percentage: (formatted / totalSupplyNum) * 100,
      });
    }
  }

  holders.sort((a, b) => b.balanceFormatted - a.balanceFormatted);
  return holders.slice(0, limit);
}
