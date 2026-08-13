import type {
  TokenSnapshot,
  AnalysisResult,
  PriceChange,
  HistoricalPriceEntry,
  HolderDiff,
  ExchangeFlow,
  RedistributionEvent,
  TradingActivityDiffs,
  TradingActivitySnapshot,
  WhaleConcentration,
  WhaleConcentrationEntry,
  PeriodHolderDiff,
  WhaleSignal,
} from "../types/index.js";
import { KNOWN_EXCHANGES } from "../types/index.js";
import type { HistoricalPrices } from "../api/price-history.js";
import {
  SIGNIFICANT_CHANGE_PERCENT,
  HOLDER_PERIODS_DAYS,
  UNCHANGED_THRESHOLD_PERCENT,
  WHALE_ACCUMULATION_THRESHOLD_PERCENT,
  REDISTRIBUTION_MIN_RANK,
  REDISTRIBUTION_MAX_RANK,
  REDISTRIBUTION_THRESHOLD_PERCENT,
  MS_PER_DAY,
  SNAPSHOT_TOLERANCE_MS,
  PRICE_DROP_WARNING_PERCENT,
  PRICE_GAIN_WARNING_PERCENT,
} from "../constants.js";

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
}

export function analyzeSnapshots(
  current: TokenSnapshot,
  previous?: TokenSnapshot,
  first?: TokenSnapshot,
  allSnapshots?: TokenSnapshot[],
  historicalPrices?: HistoricalPrices,
): AnalysisResult {
  const priceChange = buildPriceChange(current, previous, first, historicalPrices);
  const topHolderChanges = buildHolderDiffs(current, previous);
  const exchangeFlows = buildExchangeFlows(current, previous, first);
  const redistribution = buildRedistribution(current, previous);
  const tradingActivityDiffs = buildTradingActivityDiffs(current, previous, first, allSnapshots);
  const whaleConcentration = buildWhaleConcentration(current, previous, allSnapshots);
  const periodHolderDiffs = buildHolderPeriodDiffs(current, allSnapshots);
  const whaleSignals = buildWhaleBehaviorSignals(priceChange, whaleConcentration);
  const summary = buildSummary(
    current,
    previous,
    topHolderChanges,
    exchangeFlows,
    redistribution,
    priceChange,
    tradingActivityDiffs,
    whaleConcentration,
  );

  return {
    currentSnapshot: current,
    previousSnapshot: previous,
    firstSnapshot: first,
    priceChange,
    topHolderChanges,
    exchangeFlows,
    redistribution,
    tradingActivityDiffs,
    whaleConcentration,
    periodHolderDiffs,
    whaleSignals,
    summary,
  };
}

function buildPriceChange(
  current: TokenSnapshot,
  previous?: TokenSnapshot,
  first?: TokenSnapshot,
  historicalPrices?: HistoricalPrices,
): PriceChange | null {
  const result: PriceChange = { current: current.priceUsd };

  if (previous) {
    result.previous = previous.priceUsd;
    result.changePercent = ((current.priceUsd - previous.priceUsd) / previous.priceUsd) * 100;
  }

  if (first && first.priceUsd > 0) {
    result.firstPrice = first.priceUsd;
    result.firstPriceChangePercent = ((current.priceUsd - first.priceUsd) / first.priceUsd) * 100;
  }

  if (historicalPrices && historicalPrices.prices.size > 0) {
    const historical: HistoricalPriceEntry[] = [];
    for (const [daysAgo, price] of historicalPrices.prices) {
      const changePercent = ((current.priceUsd - price) / price) * 100;
      historical.push({
        price,
        date: `${daysAgo}д назад`,
        daysAgo,
        source: "api",
        changePercent,
      });
    }

    if (previous && !historicalPrices.prices.has(1)) {
      const changePercent = ((current.priceUsd - previous.priceUsd) / previous.priceUsd) * 100;
      historical.push({
        price: previous.priceUsd,
        date: "вчера",
        daysAgo: 1,
        source: "snapshot",
        changePercent,
      });
    }

    historical.sort((a, b) => a.daysAgo - b.daysAgo);
    result.historical = historical;
  } else if (current.tradingActivity?.priceChange?.h24 !== undefined && current.priceUsd > 0) {
    const h24Pct = current.tradingActivity.priceChange.h24;
    const inferred = current.priceUsd / (1 + h24Pct / 100);
    if (inferred > 0) {
      result.historical = [{
        price: inferred,
        date: "24ч назад",
        daysAgo: 1,
        source: "api",
        changePercent: h24Pct,
      }];
    }
  }

  if (!previous && (!historicalPrices || historicalPrices.prices.size === 0) && !result.historical) {
    return null;
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
    if (Math.abs(changePercent) > UNCHANGED_THRESHOLD_PERCENT) {
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

function buildHolderPeriodDiffs(
  current: TokenSnapshot,
  allSnapshots?: TokenSnapshot[],
): PeriodHolderDiff[] {
  const prevSnapshots = new Map<number, TokenSnapshot>();
  for (const daysAgo of HOLDER_PERIODS_DAYS) {
    const r = allSnapshots ? findSnapshotByDaysAgo(allSnapshots, current, daysAgo) : undefined;
    if (r) prevSnapshots.set(daysAgo, r.snapshot);
  }

  if (prevSnapshots.size === 0) return [];

  const result: PeriodHolderDiff[] = [];
  for (const cur of current.holders) {
    const deltas = new Map<number, { ppChange: number; balanceChange: number }>();
    for (const [daysAgo, snap] of prevSnapshots) {
      const prev = snap.holders.find((h) => h.address.toLowerCase() === cur.address.toLowerCase());
      if (prev) {
        deltas.set(daysAgo, {
          ppChange: cur.percentage - prev.percentage,
          balanceChange: cur.balance - prev.balance,
        });
      }
    }
    result.push({
      rank: cur.rank,
      address: cur.address,
      label: cur.label,
      currentBalance: cur.balance,
      currentPercentage: cur.percentage,
      deltas,
    });
  }

  return result;
}

function buildWhaleBehaviorSignals(
  priceChange: PriceChange | null,
  whaleConcentration: WhaleConcentration | null,
): Map<number, WhaleSignal> {
  const result = new Map<number, WhaleSignal>();

  if (!priceChange) return result;
  if (!whaleConcentration) return result;

  const priceHist = priceChange.historical
    ? new Map(priceChange.historical.map((h) => [h.daysAgo, h.changePercent]))
    : new Map<number, number>();

  for (const daysAgo of HOLDER_PERIODS_DAYS) {
    let priceDelta = priceChange.changePercent;
    if (daysAgo !== 1) {
      const h = priceHist.get(daysAgo);
      if (h === undefined) continue;
      priceDelta = h;
    }
    if (priceDelta === undefined) continue;

    const concEntry = whaleConcentration.entries.find((e) => e.daysAgo === daysAgo);
    if (!concEntry) {
      result.set(daysAgo, {
        emoji: "🟡",
        text: `${daysAgo}д: цена ${priceDelta >= 0 ? "+" : ""}${priceDelta.toFixed(1)}% (данных о холдерах пока нет)`,
      });
      continue;
    }

    const concDelta = whaleConcentration.currentConcentration - concEntry.concentration;
    const priceUp = priceDelta >= 0;

    const playerEmoji = priceUp ? "🟢" : "🔴";
    const playerText = priceUp
      ? `Мелкие игроки набирают (${daysAgo}д)`
      : `Мелкие игроки продают (${daysAgo}д)`;

    let whaleLine: string;
    if (concDelta > WHALE_ACCUMULATION_THRESHOLD_PERCENT) {
      whaleLine = `🟢 Киты накапливают (${daysAgo}д, +${concDelta.toFixed(1)}% supply)`;
    } else if (concDelta < -WHALE_ACCUMULATION_THRESHOLD_PERCENT) {
      whaleLine = `🔴 Киты распродают (${daysAgo}д, ${concDelta.toFixed(1)}% supply)`;
    } else {
      whaleLine = `🟡 Киты без изменений (${daysAgo}д, ${concDelta >= 0 ? "+" : ""}${concDelta.toFixed(1)}% supply)`;
    }

    result.set(daysAgo, {
      emoji: playerEmoji,
      text: `${playerText}\n  ${whaleLine}`,
    });
  }

  return result;
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

  for (const cur of current.holders.slice(REDISTRIBUTION_MIN_RANK - 1, REDISTRIBUTION_MAX_RANK)) {
    const addr = cur.address.toLowerCase();
    const prev = prevMap.get(addr);
    if (!prev) continue;

    const changePercent =
      prev.balance > 0 ? ((cur.balance - prev.balance) / prev.balance) * 100 : 0;

    if (Math.abs(changePercent) > REDISTRIBUTION_THRESHOLD_PERCENT) {
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

export function findSnapshotByDaysAgo(
  snapshots: TokenSnapshot[],
  current: TokenSnapshot,
  daysTarget: number,
): { snapshot: TokenSnapshot; daysAgo: number } | undefined {
  const now = new Date(current.timestamp).getTime();
  const target = now - daysTarget * MS_PER_DAY;
  let best: TokenSnapshot | undefined;
  let bestDiff = Infinity;
  for (const s of snapshots) {
    if (s === current) continue;
    const diff = Math.abs(new Date(s.timestamp).getTime() - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = s;
    }
  }
  if (bestDiff > SNAPSHOT_TOLERANCE_MS || !best) return undefined;
  const daysAgo = Math.round((now - new Date(best.timestamp).getTime()) / MS_PER_DAY);
  return { snapshot: best, daysAgo };
}

function buildTradingActivityDiffs(
  current: TokenSnapshot,
  previous: TokenSnapshot | undefined,
  first: TokenSnapshot | undefined,
  allSnapshots?: TokenSnapshot[],
): TradingActivityDiffs | null {
  const cur = current.tradingActivity;
  if (!cur) return null;

  const entries: TradingActivitySnapshot[] = [];
  const seen = new Set<string>();

  const addEntry = (snap: TokenSnapshot | undefined, daysAgo: number, label: string) => {
    if (!snap?.tradingActivity) return;
    if (seen.has(snap.timestamp)) return;
    seen.add(snap.timestamp);
    entries.push({
      activity: snap.tradingActivity,
      date: label,
      daysAgo,
    });
  };

  if (allSnapshots && allSnapshots.length > 1) {
    const r7 = findSnapshotByDaysAgo(allSnapshots, current, 7);
    addEntry(r7?.snapshot, r7?.daysAgo ?? 7, `${r7?.daysAgo ?? 7}д назад`);
    const r3 = findSnapshotByDaysAgo(allSnapshots, current, 3);
    addEntry(r3?.snapshot, r3?.daysAgo ?? 3, `${r3?.daysAgo ?? 3}д назад`);
  }

  addEntry(previous, 1, "вчера");

  return { current: cur, entries };
}

function buildWhaleConcentration(
  current: TokenSnapshot,
  previous: TokenSnapshot | undefined,
  allSnapshots?: TokenSnapshot[],
): WhaleConcentration | null {
  const curConcentration = current.holders.reduce((sum, h) => sum + h.percentage, 0);
  const totalSupply = Number(current.token.totalSupply);
  const mcapUsd = (totalSupply / 10 ** current.token.decimals) * current.priceUsd;

  const entries: WhaleConcentrationEntry[] = [];
  const seen = new Set<string>();

  if (allSnapshots && allSnapshots.length > 1) {
    const r7 = findSnapshotByDaysAgo(allSnapshots, current, 7);
    if (r7?.snapshot && !seen.has(r7.snapshot.timestamp)) {
      seen.add(r7.snapshot.timestamp);
      entries.push({
        concentration: r7.snapshot.holders.reduce((s, h) => s + h.percentage, 0),
        date: `${r7.daysAgo}д назад`,
        daysAgo: r7.daysAgo,
      });
    }
    const r3 = findSnapshotByDaysAgo(allSnapshots, current, 3);
    if (r3?.snapshot && !seen.has(r3.snapshot.timestamp)) {
      seen.add(r3.snapshot.timestamp);
      entries.push({
        concentration: r3.snapshot.holders.reduce((s, h) => s + h.percentage, 0),
        date: `${r3.daysAgo}д назад`,
        daysAgo: r3.daysAgo,
      });
    }
  }

  if (previous && !seen.has(previous.timestamp)) {
    entries.push({
      concentration: previous.holders.reduce((s, h) => s + h.percentage, 0),
      date: "вчера",
      daysAgo: 1,
    });
  }

  return {
    holderCount: current.holders.length,
    currentMcapUsd: mcapUsd,
    currentConcentration: curConcentration,
    entries,
  };
}

function buildSummary(
  current: TokenSnapshot,
  previous: TokenSnapshot | undefined,
  holderDiffs: HolderDiff[],
  exchangeFlows: ExchangeFlow[],
  redistribution: RedistributionEvent[],
  priceChange: PriceChange | null,
  tradingActivityDiffs: TradingActivityDiffs | null,
  whaleConcentration: WhaleConcentration | null,
): string {
  const lines: string[] = [];
  const significantChanges = holderDiffs.filter(
    (d) =>
      (d.action === "increased" || d.action === "decreased") &&
      Math.abs(d.changePercent) >= SIGNIFICANT_CHANGE_PERCENT,
  );

  if (significantChanges.length > 0) {
    const inc = significantChanges.filter((d) => d.action === "increased").length;
    const dec = significantChanges.filter((d) => d.action === "decreased").length;
    const parts: string[] = [];
    if (inc > 0) parts.push(`${inc} увеличили`);
    if (dec > 0) parts.push(`${dec} сократили`);
    lines.push(`📗 ${parts.join(", ")} позиции (подробности в таблице холдеров).`);
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

  if (priceChange && priceChange.changePercent !== undefined) {
    if (priceChange.changePercent < PRICE_DROP_WARNING_PERCENT) {
      lines.push(`⚠️ Цена упала на ${Math.abs(priceChange.changePercent).toFixed(1)}% за период`);
    } else if (priceChange.changePercent > PRICE_GAIN_WARNING_PERCENT) {
      lines.push(`✅ Цена выросла на ${priceChange.changePercent.toFixed(1)}% за период`);
    }
  } else if (priceChange?.historical && priceChange.historical.length > 0) {
    const latest = priceChange.historical[priceChange.historical.length - 1];
    if (latest.changePercent < PRICE_DROP_WARNING_PERCENT) {
      lines.push(
        `⚠️ Цена упала на ${Math.abs(latest.changePercent).toFixed(1)}% за ${latest.daysAgo}д (DeFiLlama).`,
      );
    } else if (latest.changePercent > PRICE_GAIN_WARNING_PERCENT) {
      lines.push(
        `✅ Цена выросла на ${latest.changePercent.toFixed(1)}% за ${latest.daysAgo}д (DeFiLlama).`,
      );
    }
  }

  if (tradingActivityDiffs) {
    const d = tradingActivityDiffs;
    const txns = d.current.txns24h.buys + d.current.txns24h.sells;
    lines.push(
      `📈 Volume 24h: $${fmtNum(d.current.volume24h)}, транзакций: ${fmtNum(txns)} (buy ${d.current.txns24h.buys} / sell ${d.current.txns24h.sells})`,
    );
    for (const e of d.entries) {
      if (e.activity.volume24h > 0) {
        const change = ((d.current.volume24h - e.activity.volume24h) / e.activity.volume24h) * 100;
        const arrow = change >= 0 ? "🟢" : "🔴";
        const curTxns = d.current.txns24h.buys + d.current.txns24h.sells;
        const prevTxns = e.activity.txns24h.buys + e.activity.txns24h.sells;
        const txnsChange = prevTxns > 0 ? ((curTxns - prevTxns) / prevTxns) * 100 : 0;
        lines.push(
          `  ${arrow} vs ${e.date}: volume ${change >= 0 ? "+" : ""}${change.toFixed(1)}%, txns ${txnsChange >= 0 ? "+" : ""}${txnsChange.toFixed(1)}%`,
        );
      }
    }
  }

  if (whaleConcentration && whaleConcentration.entries.length > 0) {
    const curConc = whaleConcentration.currentConcentration;
    const lastEntry = whaleConcentration.entries[whaleConcentration.entries.length - 1];
    const concChange = curConc - lastEntry.concentration;
    const arrow = concChange >= 0 ? "📈" : "📉";
    const action = concChange >= 0 ? "закупаются" : "избавляются";
    lines.push(
      `${arrow} Топ-${whaleConcentration.holderCount} киты контролируют ${curConc.toFixed(1)}% supply (${action}, ${concChange >= 0 ? "+" : ""}${concChange.toFixed(2)}% за ${lastEntry.daysAgo}д).`,
    );
  }

  return lines.join("\n");
}
