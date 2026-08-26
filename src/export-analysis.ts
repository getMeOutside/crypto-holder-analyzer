import { getChain } from "./config/chains.js";
import { getSnapshots } from "./storage/snapshots.js";
import { analyzeSnapshots, findSnapshotByDaysAgo } from "./analysis/analyzer.js";
import { fetchHistoricalPrices } from "./api/price-history.js";
import { HOLDER_PERIODS_DAYS } from "./constants.js";
import type { AnalysisResult } from "./types/index.js";

function serializeAnalysisResult(result: AnalysisResult): Record<string, unknown> {
  return {
    token: result.currentSnapshot.token,
    date: result.currentSnapshot.date,
    priceUsd: result.currentSnapshot.priceUsd,
    
    priceChange: result.priceChange,
    tradingActivityDiffs: result.tradingActivityDiffs ? {
      current: result.tradingActivityDiffs.current,
      entries: result.tradingActivityDiffs.entries,
    } : null,
    whaleConcentration: result.whaleConcentration,
    whaleSignals: result.whaleSignals.size > 0 
      ? Object.fromEntries(result.whaleSignals)
      : {},
    periodHolderDiffs: result.periodHolderDiffs.map(h => ({
      rank: h.rank,
      address: h.address,
      label: h.label,
      currentBalance: h.currentBalance,
      currentPercentage: h.currentPercentage,
      deltas: Object.fromEntries(h.deltas),
    })),
    topHolderChanges: result.topHolderChanges,
    summary: result.summary,
  };
}

export async function runExport(tokenAddress: string, chainInput: string): Promise<void> {
  const chain = getChain(chainInput);
  
  const allSnapshots = getSnapshots(tokenAddress, chain.name);
  if (allSnapshots.length === 0) {
    console.error(JSON.stringify({ error: "No snapshots found" }));
    process.exit(1);
  }
  
  const currentSnapshot = allSnapshots[allSnapshots.length - 1];
  const r1 = findSnapshotByDaysAgo(allSnapshots, currentSnapshot, 1);
  const previousSnapshot = r1?.snapshot ?? (allSnapshots.length >= 2 ? allSnapshots[allSnapshots.length - 2] : undefined);
  const firstSnapshot = allSnapshots.length > 0 ? allSnapshots[0] : undefined;
  
  const missingDays = [...HOLDER_PERIODS_DAYS];
  let historicalPrices: Awaited<ReturnType<typeof fetchHistoricalPrices>> | undefined;
  
  if (missingDays.length > 0) {
    try {
      historicalPrices = await fetchHistoricalPrices(tokenAddress, chain);
    } catch {
      // ignore
    }
  }
  
  const result = analyzeSnapshots(
    currentSnapshot,
    previousSnapshot,
    firstSnapshot,
    allSnapshots,
    historicalPrices,
  );
  
  const serialized = serializeAnalysisResult(result);
  console.log(JSON.stringify(serialized, null, 2));
}

const args = process.argv.slice(2);
if (args.length >= 2) {
  runExport(args[0], args[1]).catch((err) => {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  });
} else {
  console.error("Usage: export-analysis.ts <tokenAddress> <chain>");
  process.exit(1);
}
