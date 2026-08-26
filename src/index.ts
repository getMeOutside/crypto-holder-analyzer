import { runAnalyze } from "./tasks/analyze.js";

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log("Usage: bun run analyze <token_address> <chain>");
    console.log("");
    console.log("Takes a snapshot and analyzes holder changes (if previous snapshots exist).");
    console.log("");
    console.log("Supported chains: eth, sol");
    console.log("");
    console.log("Example:");
    console.log("  bun run analyze 0x0d8c86... eth");
    process.exit(1);
  }

  const [tokenAddress, chainInput] = args;
  await runAnalyze(tokenAddress, chainInput);
}

main().catch((err) => {
  console.error("❌ Error:", err.message || err);
  process.exit(1);
});
