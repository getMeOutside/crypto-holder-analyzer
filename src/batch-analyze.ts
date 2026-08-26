import { runAnalyze } from "./tasks/analyze.js";

function parseAddresses(envValue: string | undefined): string[] {
  if (!envValue) return [];
  return envValue
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function main() {
  const solTokens = parseAddresses(process.env.SOL_TOKENS);
  const ercTokens = parseAddresses(process.env.ERC_TOKENS);

  if (solTokens.length === 0 && ercTokens.length === 0) {
    console.log("No tokens configured. Set SOL_TOKENS and/or ERC_TOKENS in .env");
    console.log("  SOL_TOKENS=addr1,addr2");
    console.log("  ERC_TOKENS=0xaddr1,0xaddr2");
    process.exit(1);
  }

  const tasks: { address: string; chain: string }[] = [];

  for (const addr of solTokens) {
    tasks.push({ address: addr, chain: "sol" });
  }
  for (const addr of ercTokens) {
    tasks.push({ address: addr, chain: "eth" });
  }

  console.log(
    `\n📋 Batch analyze: ${tasks.length} tasks (${solTokens.length} SOL, ${ercTokens.length} ERC)\n`,
  );

  let success = 0;
  let failed = 0;

  for (const task of tasks) {
    try {
      await runAnalyze(task.address, task.chain);
      success++;
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    } catch (err) {
      failed++;
      console.error(
        `\n❌ Failed: ${task.address} (${task.chain}) — ${(err as Error).message || err}`,
      );
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Done: ${success} succeeded, ${failed} failed out of ${tasks.length} tasks`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("❌ Fatal error:", err.message || err);
  process.exit(1);
});
