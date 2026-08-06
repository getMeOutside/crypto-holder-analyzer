import { getChain } from "./config/chains.js";
import { fetchTokenInfo, fetchTopHolders } from "./api/holders.js";
import { fetchTokenPrice } from "./api/price.js";
import { fetchTradingActivity } from "./api/dexscreener.js";
import { fetchHistoricalPrices } from "./api/price-history.js";
import { saveSnapshot, getSnapshots } from "./storage/snapshots.js";
import { analyzeSnapshots, findSnapshotByDaysAgo } from "./analysis/analyzer.js";
import { generateReport } from "./report/generator.js";
import { KNOWN_EXCHANGES } from "./types/index.js";
import type { TokenSnapshot, HolderSnapshot, AnalysisResult } from "./types/index.js";

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log("Usage: bun run analyze <token_address> <chain>");
    console.log("");
    console.log("Takes a snapshot and analyzes holder changes (if previous snapshots exist).");
    console.log("");
    console.log("Supported chains: eth, bsc, sol");
    console.log("");
    console.log("Example:");
    console.log("  bun run analyze 0x0d8c86... bsc");
    process.exit(1);
  }

  const [tokenAddress, chainInput] = args;
  const chain = getChain(chainInput);

  console.log(`\n🔍 Analyzing ${tokenAddress} on ${chain.name}...\n`);

  // Fetch current data and take snapshot
  const tokenInfo = await fetchTokenInfo(tokenAddress, chain);
  console.log(`📌 Token: ${tokenInfo.symbol} (${tokenInfo.name})`);

  const [price, holders, tradingActivity] = await Promise.all([
    fetchTokenPrice(tokenAddress, chain),
    fetchTopHolders(tokenAddress, chain),
    fetchTradingActivity(tokenAddress, chain),
  ]);

  console.log(`💰 Price: $${price}`);
  console.log(`👥 Holders found: ${holders.length}`);
  if (tradingActivity) {
    console.log(
      `📈 DEX: ${tradingActivity.dex} (volume 24h: $${tradingActivity.volume24h.toLocaleString()})`,
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
  const currentSnapshot: TokenSnapshot = {
    timestamp: now.toISOString(),
    date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
    token: tokenInfo,
    priceUsd: price,
    holders: holderSnapshots,
    totalHolders: holders.length,
    tradingActivity: tradingActivity ?? undefined,
  };

  // Save current snapshot
  saveSnapshot(currentSnapshot);

  // Get all snapshots and find the closest to ~1d ago for previousSnapshot
  const allSnapshots = getSnapshots(tokenAddress, chain.name);
  const r1 = findSnapshotByDaysAgo(allSnapshots, currentSnapshot, 1);
  const previousSnapshot =
    r1?.snapshot ?? (allSnapshots.length >= 2 ? allSnapshots[allSnapshots.length - 2] : undefined);
  const firstSnapshot = allSnapshots.length > 0 ? allSnapshots[0] : undefined;

  // Check which intervals are covered by snapshots
  const snapshotDays = new Set<number>();
  for (const ds of [1, 3, 7]) {
    const r = findSnapshotByDaysAgo(allSnapshots, currentSnapshot, ds);
    if (r) snapshotDays.add(ds);
  }

  // Fetch only missing intervals from DeFiLlama
  const missingDays = [1, 3, 7].filter((d) => !snapshotDays.has(d));
  let historicalPrices: Awaited<ReturnType<typeof fetchHistoricalPrices>> | undefined;

  if (missingDays.length > 0) {
    console.log(
      `\n⏳ Fetching missing price intervals from DeFiLlama: ${missingDays.map((d) => `${d}d`).join(", ")}...`,
    );
    try {
      historicalPrices = await fetchHistoricalPrices(tokenAddress, chain);
      if (historicalPrices.prices.size > 0) {
        console.log(
          `✅ Got ${historicalPrices.prices.size} historical price(s): ${[
            ...historicalPrices.prices.keys(),
          ]
            .map((d) => `${d}d`)
            .join(", ")}`,
        );
      }
    } catch (e) {
      console.warn(`⚠️  DeFiLlama failed: ${(e as Error).message}`);
    }
  }

  // Early exit only if we have nothing to compare at all
  if (!previousSnapshot && (!historicalPrices || historicalPrices.prices.size === 0)) {
    console.log("\n⚠️  No previous snapshots and no API data. Run snapshot again later.");
    console.log("\nCurrent snapshot:");
    displaySnapshot(currentSnapshot);
    process.exit(0);
  }

  // Run analysis
  const result: AnalysisResult = analyzeSnapshots(
    currentSnapshot,
    previousSnapshot,
    firstSnapshot,
    allSnapshots,
    historicalPrices,
  );

  // Generate and display report
  const report = generateReport(result);
  console.log("\n" + report);

  // Also save report to file
  const reportPath = `data/reports/${tokenInfo.chain.toLowerCase()}_${tokenInfo.address}_${currentSnapshot.date}.md`;
  const { mkdirSync, writeFileSync, existsSync } = await import("fs");
  const { join } = await import("path");
  const reportDir = join(process.cwd(), "data", "reports");
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
  writeFileSync(reportPath, report);
  console.log(`\n📄 Report saved: ${reportPath}`);
}

function displaySnapshot(snapshot: TokenSnapshot) {
  const token = snapshot.token;
  console.log(`  ${token.symbol} — ${snapshot.date}`);
  console.log(`  Price: $${snapshot.priceUsd}`);
  console.log(`  Top holders:`);
  for (const h of snapshot.holders.slice(0, 10)) {
    const label = h.label || `${h.address.slice(0, 6)}…${h.address.slice(-4)}`;
    console.log(
      `    #${h.rank} ${label}: ${h.balance.toLocaleString()} (${h.percentage.toFixed(2)}%)`,
    );
  }
}

main().catch((err) => {
  console.error("❌ Error:", err.message || err);
  process.exit(1);
});
