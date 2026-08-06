import { getChain } from "./config/chains.js";
import { fetchTokenInfo, fetchTopHolders } from "./api/holders.js";
import { fetchTokenPrice } from "./api/price.js";
import { fetchTradingActivity } from "./api/dexscreener.js";
import { saveSnapshot } from "./storage/snapshots.js";
import { KNOWN_EXCHANGES } from "./types/index.js";
import type { TokenSnapshot, HolderSnapshot } from "./types/index.js";

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log("Usage: bun run snapshot <token_address> <chain>");
    console.log("Example: bun run snapshot 0x0d8c86... bsc");
    console.log("");
    console.log("Supported chains: eth, bsc, sol");
    process.exit(1);
  }

  const [tokenAddress, chainInput] = args;
  const chain = getChain(chainInput.toLowerCase());

  console.log(`\n🔍 Fetching token info for ${tokenAddress} on ${chain.name}...`);

  const tokenInfo = await fetchTokenInfo(tokenAddress, chain);
  console.log(`📌 Token: ${tokenInfo.symbol} (${tokenInfo.name})`);

  console.log(`\n💰 Fetching price...`);
  const price = await fetchTokenPrice(tokenAddress, chain);
  console.log(`💰 Price: $${price}`);

  console.log(`\n👥 Fetching top holders...`);
  const holders = await fetchTopHolders(tokenAddress, chain);
  console.log(`✅ Found ${holders.length} holders`);

  console.log(`\n📈 Fetching trading activity...`);
  const tradingActivity = await fetchTradingActivity(tokenAddress, chain);
  if (tradingActivity) {
    console.log(
      `✅ DEX: ${tradingActivity.dex} (volume 24h: $${tradingActivity.volume24h.toLocaleString()})`,
    );
  }

  const holderSnapshots: HolderSnapshot[] = holders.slice(0, 50).map((h, i) => ({
    rank: i + 1,
    address: h.address,
    balance: h.balanceFormatted,
    percentage: h.percentage,
    label: KNOWN_EXCHANGES[h.address] || KNOWN_EXCHANGES[h.address.toLowerCase()],
  }));

  const now = new Date();
  const snapshot: TokenSnapshot = {
    timestamp: now.toISOString(),
    date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
    token: tokenInfo,
    priceUsd: price,
    holders: holderSnapshots,
    totalHolders: holders.length,
    tradingActivity: tradingActivity ?? undefined,
  };

  saveSnapshot(snapshot);
  console.log(`\n✅ Snapshot saved for ${snapshot.date}`);
}

main().catch((err) => {
  console.error("❌ Error:", err.message || err);
  process.exit(1);
});
