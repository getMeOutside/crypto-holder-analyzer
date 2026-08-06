import type {
  TokenSnapshot,
  AnalysisResult,
  PriceChange,
  HolderDiff,
  ExchangeFlow,
  RedistributionEvent,
} from "../types/index.js";
import { KNOWN_EXCHANGES } from "../types/index.js";

export const SIGNIFICANT_CHANGE_PERCENT = 1;

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
}

export function analyzeSnapshots(
  current: TokenSnapshot,
  previous?: TokenSnapshot,
  first?: TokenSnapshot,
): AnalysisResult {
  const priceChange = buildPriceChange(current, previous, first);
  const topHolderChanges = buildHolderDiffs(current, previous);
  const exchangeFlows = buildExchangeFlows(current, previous, first);
  const redistribution = buildRedistribution(current, previous);
  const summary = buildSummary(
    current,
    previous,
    topHolderChanges,
    exchangeFlows,
    redistribution,
    priceChange,
  );

  return {
    currentSnapshot: current,
    previousSnapshot: previous,
    firstSnapshot: first,
    priceChange,
    topHolderChanges,
    exchangeFlows,
    redistribution,
    summary,
  };
}

function buildPriceChange(
  current: TokenSnapshot,
  previous?: TokenSnapshot,
  first?: TokenSnapshot,
): PriceChange | null {
  if (!previous) return null;
  const changePercent = ((current.priceUsd - previous.priceUsd) / previous.priceUsd) * 100;
  const result: PriceChange = {
    current: current.priceUsd,
    previous: previous.priceUsd,
    changePercent,
  };
  if (first && first.priceUsd > 0) {
    result.firstPrice = first.priceUsd;
    result.firstPriceChangePercent = ((current.priceUsd - first.priceUsd) / first.priceUsd) * 100;
  }
  return result;
}

function buildHolderDiffs(current: TokenSnapshot, previous?: TokenSnapshot): HolderDiff[] {
  if (!previous) return [];

  const prevMap = new Map(previous.holders.map((h) => [h.address.toLowerCase(), h]));
  const diffs: HolderDiff[] = [];

  for (const cur of current.holders) {
    const addr = cur.address.toLowerCase();
    const prev = prevMap.get(addr);
    const label = cur.label || KNOWN_EXCHANGES[addr] || prev?.label;

    if (!prev) {
      diffs.push({
        rank: cur.rank,
        address: cur.address,
        label,
        currentBalance: cur.balance,
        previousBalance: 0,
        balanceChange: cur.balance,
        changePercent: 100,
        currentPercentage: cur.percentage,
        previousPercentage: 0,
        action: "new",
      });
      continue;
    }

    const balanceChange = cur.balance - prev.balance;
    const changePercent = prev.balance > 0 ? (balanceChange / prev.balance) * 100 : 0;

    let action: HolderDiff["action"] = "unchanged";
    if (Math.abs(changePercent) > 0.5) {
      action = balanceChange > 0 ? "increased" : "decreased";
    }

    diffs.push({
      rank: cur.rank,
      address: cur.address,
      label,
      currentBalance: cur.balance,
      previousBalance: prev.balance,
      balanceChange,
      changePercent,
      currentPercentage: cur.percentage,
      previousPercentage: prev.percentage,
      action,
    });
  }

  // Check for holders that exited top list
  const curAddrs = new Set(current.holders.map((h) => h.address.toLowerCase()));
  for (const prev of previous.holders) {
    if (!curAddrs.has(prev.address.toLowerCase())) {
      diffs.push({
        rank: prev.rank,
        address: prev.address,
        label: prev.label || KNOWN_EXCHANGES[prev.address.toLowerCase()],
        currentBalance: 0,
        previousBalance: prev.balance,
        balanceChange: -prev.balance,
        changePercent: -100,
        currentPercentage: 0,
        previousPercentage: prev.percentage,
        action: "exited",
      });
    }
  }

  return diffs.sort((a, b) => a.rank - b.rank);
}

function buildExchangeFlows(
  current: TokenSnapshot,
  previous?: TokenSnapshot,
  first?: TokenSnapshot,
): ExchangeFlow[] {
  const flows: ExchangeFlow[] = [];

  for (const [addr, exchangeName] of Object.entries(KNOWN_EXCHANGES)) {
    const addrLower = addr.toLowerCase();
    const curHolder = current.holders.find((h) => h.address.toLowerCase() === addrLower);
    const prevHolder = previous?.holders.find((h) => h.address.toLowerCase() === addrLower);
    const firstHolder = first?.holders.find((h) => h.address.toLowerCase() === addrLower);

    if (!curHolder && !prevHolder && !firstHolder) continue;

    const curBalance = curHolder?.balance || 0;
    const prevBalance = prevHolder?.balance;
    const firstBalance = firstHolder?.balance;

    const weeklyChange = prevBalance !== undefined ? curBalance - prevBalance : 0;
    const totalChange = firstBalance !== undefined ? curBalance - firstBalance : 0;
    const totalChangePercent =
      firstBalance && firstBalance > 0 ? (totalChange / firstBalance) * 100 : 0;

    flows.push({
      exchange: exchangeName,
      address: addr,
      currentBalance: curBalance,
      previousBalance: prevBalance,
      firstBalance,
      weeklyChange,
      totalChange,
      totalChangePercent,
    });
  }

  return flows.filter((f) => f.currentBalance > 0 || (f.previousBalance && f.previousBalance > 0));
}

function buildRedistribution(
  current: TokenSnapshot,
  previous?: TokenSnapshot,
): RedistributionEvent[] {
  if (!previous) return [];

  const prevMap = new Map(previous.holders.map((h) => [h.address.toLowerCase(), h]));
  const events: RedistributionEvent[] = [];

  for (const cur of current.holders.slice(6, 20)) {
    const addr = cur.address.toLowerCase();
    const prev = prevMap.get(addr);
    if (!prev) continue;

    const changePercent =
      prev.balance > 0 ? ((cur.balance - prev.balance) / prev.balance) * 100 : 0;

    if (Math.abs(changePercent) > 5) {
      events.push({
        address: cur.address,
        balance: cur.balance,
        previousBalance: prev.balance,
        changePercent,
        direction: changePercent > 0 ? "accumulating" : "distributing",
      });
    }
  }

  return events;
}

function buildSummary(
  current: TokenSnapshot,
  previous: TokenSnapshot | undefined,
  holderDiffs: HolderDiff[],
  exchangeFlows: ExchangeFlow[],
  redistribution: RedistributionEvent[],
  priceChange: PriceChange | null,
): string {
  const lines: string[] = [];
  const significantChanges = holderDiffs.filter(
    (d) =>
      (d.action === "increased" || d.action === "decreased") &&
      Math.abs(d.changePercent) >= SIGNIFICANT_CHANGE_PERCENT,
  );
  const unchangedOrMinor = holderDiffs.filter(
    (d) =>
      d.action === "unchanged" ||
      ((d.action === "increased" || d.action === "decreased") &&
        Math.abs(d.changePercent) < SIGNIFICANT_CHANGE_PERCENT),
  );

  if (significantChanges.length === 0) {
    lines.push("🟢 Крупные держатели не изменили позиции — киты продолжают удерживать.");
  } else {
    for (const diff of significantChanges) {
      const label = diff.label || shortAddr(diff.address);
      if (diff.action === "decreased") {
        lines.push(
          `🔴 ${label} (топ-${diff.rank}) сократил позицию на ${fmtNum(Math.abs(diff.balanceChange))} токенов (-${Math.abs(diff.changePercent).toFixed(1)}%).`,
        );
      } else if (diff.action === "increased") {
        lines.push(
          `🟢 ${label} (топ-${diff.rank}) увеличил позицию на ${fmtNum(diff.balanceChange)} токенов (+${diff.changePercent.toFixed(1)}%).`,
        );
      }
    }
  }

  for (const flow of exchangeFlows) {
    if (flow.weeklyChange !== 0) {
      const direction = flow.weeklyChange > 0 ? "поступило" : "выведено";
      lines.push(
        `🟡 ${flow.exchange}: ${direction} ${fmtNum(Math.abs(flow.weeklyChange))} токенов за неделю.`,
      );
    }
  }

  if (redistribution.length > 0) {
    lines.push(
      `🟡 Средние киты активно перераспределяются (${redistribution.length} значительных изменений).`,
    );
  }

  if (priceChange) {
    if (priceChange.changePercent < -20) {
      lines.push(`⚠️ Цена упала на ${Math.abs(priceChange.changePercent).toFixed(1)}% за период.`);
    } else if (priceChange.changePercent > 20) {
      lines.push(`✅ Цена выросла на ${priceChange.changePercent.toFixed(1)}% за период.`);
    }
  }

  return lines.join("\n");
}
