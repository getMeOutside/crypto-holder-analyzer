import { getChain } from "./config/chains.js";
import { fetchTokenInfo, fetchTopHolders } from "./api/holders.js";
import { fetchTokenPrice } from "./api/price.js";
import { saveSnapshot, getSnapshots } from "./storage/snapshots.js";
import { analyzeSnapshots } from "./analysis/analyzer.js";
import { generateReport } from "./report/generator.js";
import { KNOWN_EXCHANGES } from "./types/index.js";
import type { TokenSnapshot, HolderSnapshot, AnalysisResult } from "./types/index.js";

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log("Usage: bun run analyze <token_address> <chain>");
    console.log("");
    console.log("commands:");
    console.log("  bun run snapshot <token> <chain>  — save a new snapshot");
    console.log("  bun run analyze <token> <chain>   — generate analysis report");
    console.log("");
    console.log("Supported chains: eth, bsc, sol");
    console.log("");
    console.log("Example:");
    console.log("  bun run snapshot 0x0d8c86... bsc");
    console.log("  bun run analyze 0x0d8c86... bsc");
    process.exit(1);
  }

  const [tokenAddress, chainInput] = args;
  const chain = getChain(chainInput);

  console.log(`\n🔍 Analyzing ${tokenAddress} on ${chain.name}...\n`);

  // Fetch current data and take snapshot
  const tokenInfo = await fetchTokenInfo(tokenAddress, chain);
  console.log(`📌 Token: ${tokenInfo.symbol} (${tokenInfo.name})`);

  const [price, holders] = await Promise.all([
    fetchTokenPrice(tokenAddress, chain),
    fetchTopHolders(tokenAddress, chain),
  ]);

  console.log(`💰 Price: $${price}`);
  console.log(`👥 Holders found: ${holders.length}`);

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
  };

  // Save current snapshot
  saveSnapshot(currentSnapshot);

  // Get previous snapshots for comparison
  const allSnapshots = getSnapshots(tokenAddress, chain.name);
  const previousSnapshot =
    allSnapshots.length >= 2 ? allSnapshots[allSnapshots.length - 2] : undefined;
  const firstSnapshot = allSnapshots.length > 0 ? allSnapshots[0] : undefined;

  if (!previousSnapshot) {
    console.log("\n⚠️  No previous snapshot found. Run snapshot again later to enable comparison.");
    console.log("\nCurrent snapshot:");
    displaySnapshot(currentSnapshot);
    process.exit(0);
  }

  // Run analysis
  const result: AnalysisResult = analyzeSnapshots(currentSnapshot, previousSnapshot, firstSnapshot);

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
