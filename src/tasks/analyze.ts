import { getChain } from "../config/chains.js";
import { fetchTokenInfo, fetchTopHolders } from "../api/holders.js";
import { fetchTokenPrice } from "../api/price.js";
import { fetchTradingActivity } from "../api/dexscreener.js";
import { fetchHistoricalPrices } from "../api/price-history.js";
import { saveSnapshot, getSnapshots } from "../storage/snapshots.js";
import { analyzeSnapshots, findSnapshotByDaysAgo } from "../analysis/analyzer.js";
import { generateReport } from "../report/generator.js";
import { KNOWN_EXCHANGES } from "../types/index.js";
import type { TokenSnapshot, HolderSnapshot, AnalysisResult } from "../types/index.js";
import { MAX_HOLDERS_IN_SNAPSHOT, HOLDER_PERIODS_DAYS } from "../constants.js";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

export async function runAnalyze(tokenAddress: string, chainInput: string): Promise<void> {
  const chain = getChain(chainInput);

  console.log(`\n🔍 Analyzing ${tokenAddress} on ${chain.name}...\n`);

  const tokenInfo = await fetchTokenInfo(tokenAddress, chain);
  console.log(`📌 Token: ${tokenInfo.symbol} (${tokenInfo.name})`);

  const [solPrice, holders, tradingActivity] = await Promise.all([
    fetchTokenPrice(tokenAddress, chain),
    fetchTopHolders(tokenAddress, chain),
    fetchTradingActivity(tokenAddress, chain),
  ]);

  const price = solPrice || tradingActivity?.priceUsd || 0;

  if (!solPrice && tradingActivity?.priceUsd) {
    console.log(`💰 Price from DexScreener: $${tradingActivity.priceUsd}`);
  }

  if (tokenInfo.symbol === "UNKNOWN" && tradingActivity) {
    if (tradingActivity.name) tokenInfo.name = tradingActivity.name;
    if (tradingActivity.symbol) tokenInfo.symbol = tradingActivity.symbol;
    console.log(`📌 Token: ${tokenInfo.symbol} (${tokenInfo.name}) [DexScreener]`);
  }

  console.log(`💰 Price: $${price}`);
  console.log(`👥 Holders found: ${holders.length}`);
  if (tradingActivity) {
    console.log(
      `📈 DEX: ${tradingActivity.dex} (volume 24h: $${tradingActivity.volume24h.toLocaleString()})`,
    );
  }

  const holderSnapshots: HolderSnapshot[] = holders
    .slice(0, MAX_HOLDERS_IN_SNAPSHOT)
    .map((h, i) => ({
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

  saveSnapshot(currentSnapshot);

  const allSnapshots = getSnapshots(tokenAddress, chain.name);
  const r1 = findSnapshotByDaysAgo(allSnapshots, currentSnapshot, 1);
  const previousSnapshot =
    r1?.snapshot ?? (allSnapshots.length >= 2 ? allSnapshots[allSnapshots.length - 2] : undefined);
  const firstSnapshot = allSnapshots.length > 0 ? allSnapshots[0] : undefined;

  const snapshotDays = new Set<number>();
  for (const ds of HOLDER_PERIODS_DAYS) {
    const r = findSnapshotByDaysAgo(allSnapshots, currentSnapshot, ds);
    if (r) snapshotDays.add(ds);
  }

  const missingDays = [...HOLDER_PERIODS_DAYS].filter((d) => !snapshotDays.has(d));
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

  if (!previousSnapshot && (!historicalPrices || historicalPrices.prices.size === 0)) {
    console.log("\n⚠️  No previous snapshots and no API data. Run snapshot again later.");
    console.log("\nCurrent snapshot:");
    displaySnapshot(currentSnapshot);
    return;
  }

  const result: AnalysisResult = analyzeSnapshots(
    currentSnapshot,
    previousSnapshot,
    firstSnapshot,
    allSnapshots,
    historicalPrices,
  );

  const report = generateReport(result);

  const reportPath = `data/reports/${tokenInfo.chain.toLowerCase()}_${tokenInfo.address}_${currentSnapshot.date}.md`;
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
