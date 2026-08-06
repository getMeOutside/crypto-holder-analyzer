import type { AnalysisResult } from "../types/index.js";
import { SIGNIFICANT_CHANGE_PERCENT } from "../analysis/analyzer.js";

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
}

function fmtPrice(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

function daysBetween(d1: string, d2: string): number {
  const date1 = new Date(d1);
  const date2 = new Date(d2);
  return Math.round(Math.abs(date2.getTime() - date1.getTime()) / 86400000);
}

function daysWord(n: number): string {
  if (n === 1) return "день";
  if (n >= 2 && n <= 4) return "дня";
  return "дней";
}

function fmtPercent(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export function generateReport(result: AnalysisResult): string {
  const { currentSnapshot: cur, previousSnapshot: prev, firstSnapshot: first } = result;
  const token = cur.token;
  const lines: string[] = [];

  lines.push(`📊 ${token.symbol} — анализ держателей (${cur.date})`);
  lines.push("");

  if (result.priceChange) {
    const pc = result.priceChange;
    lines.push(`💰 Цена: ${fmtPrice(pc.current)}`);

    if (pc.historical && pc.historical.length > 0) {
      const hasApi = pc.historical.some((h) => h.source === "api");
      const p = (s: string, n: number) => s.padEnd(n);
      const COL = 18;

      const histMap = new Map(pc.historical.map((h) => [h.daysAgo, h.price]));
      const fixedPeriods = [
        { label: "Сейчас", price: pc.current },
        { label: "вчера", price: histMap.get(1) },
        { label: "3д назад", price: histMap.get(3) },
        { label: "7д назад", price: histMap.get(7) },
      ];

      const header = fixedPeriods.map((pr) => p(pr.label, COL)).join("");
      lines.push(`  ${p("", 14)}${header}`);
      lines.push(`  ${"─".repeat(14 + fixedPeriods.length * COL)}`);

      const priceLine = fixedPeriods
        .map((pr) => p(pr.price !== undefined ? fmtPrice(pr.price) : "Нет данных", COL))
        .join("");
      lines.push(`  ${p("Цена", 14)}${priceLine}`);

      const deltas = [" ".repeat(COL)];
      for (let i = 1; i < fixedPeriods.length; i++) {
        const price = fixedPeriods[i].price;
        if (price !== undefined) {
          const change = ((pc.current - price) / price) * 100;
          const arrow = change >= 0 ? "🟢" : "🔴";
          deltas.push(p(`  ${arrow}${fmtPercent(change)}`, COL));
        } else {
          deltas.push(p("  Нет данных", COL));
        }
      }
      lines.push(`  ${p("Δ vs период", 14)}${deltas.join("")}`);

      if (hasApi) {
        lines.push("");
        lines.push("  Источник цен: DeFiLlama");
      }

      if (first && first.priceUsd > 0 && pc.firstPriceChangePercent !== undefined) {
        lines.push("");
        lines.push(
          `📈 С начала мониторинга: ${fmtPrice(first.priceUsd)} → ${fmtPrice(pc.current)} (${pc.firstPriceChangePercent >= 0 ? "+" : ""}${pc.firstPriceChangePercent.toFixed(1)}%)`,
        );
      }
    } else if (pc.previous !== undefined && pc.changePercent !== undefined) {
      const ago = prev ? daysBetween(prev.timestamp, cur.timestamp) : 1;
      if (ago > 1) {
        lines.push(`С момента последнего обновления прошло ${ago} ${daysWord(ago)}.`);
        lines.push("");
      }

      const arrow = pc.changePercent >= 0 ? "🟢" : "🔴";
      lines.push(
        `${arrow} За это время цена ${pc.changePercent >= 0 ? "выросла" : "упала"} с ${fmtPrice(pc.previous)} до ${fmtPrice(pc.current)} (${pc.changePercent >= 0 ? "+" : ""}${pc.changePercent.toFixed(1)}%)`,
      );

      if (first && first.priceUsd > 0 && pc.firstPriceChangePercent !== undefined) {
        lines.push(
          `📈 С начала мониторинга: ${fmtPrice(first.priceUsd)} → ${fmtPrice(pc.current)} (${pc.firstPriceChangePercent >= 0 ? "+" : ""}${pc.firstPriceChangePercent.toFixed(1)}%)`,
        );
      }
    }
    lines.push("");
  }

  if (result.tradingActivityDiffs) {
    const d = result.tradingActivityDiffs;
    const ta = d.current;
    const totalTxns = ta.txns24h.buys + ta.txns24h.sells;

    lines.push(`📊 Торговая активность (${ta.dex}, ${ta.quoteToken})`);
    lines.push("");

    const pct = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);
    const arrow = (v: number) => (v >= 0 ? "🟢" : "🔴");
    const pad = (s: string, w: number) => s.padEnd(w);
    const COL = 18;

    const entryMap = new Map(d.entries.map((e) => [e.daysAgo, e.activity]));
    const fixedPeriods = [
      { label: "Сейчас", activity: ta },
      { label: "вчера", activity: entryMap.get(1) },
      { label: "3д назад", activity: entryMap.get(3) },
      { label: "7д назад", activity: entryMap.get(7) },
    ];

    const header = fixedPeriods.map((p) => pad(p.label, COL)).join("");
    lines.push(`  ${pad("", 14)}${header}`);
    lines.push(`  ${"─".repeat(14 + fixedPeriods.length * COL)}`);

    const volLine = fixedPeriods
      .map((p) => pad(p.activity ? `$${fmtNum(p.activity.volume24h)}` : "Нет данных", COL))
      .join("");
    lines.push(`  ${pad("Volume 24h", 14)}${volLine}`);

    const volDeltas = [" ".repeat(COL)];
    for (let i = 1; i < fixedPeriods.length; i++) {
      const act = fixedPeriods[i].activity;
      if (act) {
        const change = pct(ta.volume24h, act.volume24h);
        if (change !== null) {
          volDeltas.push(pad(`  ${arrow(change)}${fmtPercent(change)}`, COL));
        } else {
          volDeltas.push(pad("  —", COL));
        }
      } else {
        volDeltas.push(pad("  Нет данных", COL));
      }
    }
    lines.push(`  ${pad("", 14)}${volDeltas.join("")}`);

    const txnsLine = fixedPeriods
      .map((p) => {
        if (!p.activity) return pad("Нет данных", COL);
        const t = p.activity.txns24h.buys + p.activity.txns24h.sells;
        return pad(fmtNum(t), COL);
      })
      .join("");
    lines.push(`  ${pad("Транзакции", 14)}${txnsLine}`);

    const txnsDeltas = [" ".repeat(COL)];
    for (let i = 1; i < fixedPeriods.length; i++) {
      const act = fixedPeriods[i].activity;
      if (act) {
        const prevT = act.txns24h.buys + act.txns24h.sells;
        const change = pct(totalTxns, prevT);
        if (change !== null) {
          txnsDeltas.push(pad(`  ${arrow(change)}${fmtPercent(change)}`, COL));
        } else {
          txnsDeltas.push(pad("  —", COL));
        }
      } else {
        txnsDeltas.push(pad("  Нет данных", COL));
      }
    }
    lines.push(`  ${pad("", 14)}${txnsDeltas.join("")}`);

    const buySellLine = fixedPeriods
      .map((p) =>
        pad(
          p.activity ? `${p.activity.txns24h.buys}/${p.activity.txns24h.sells}` : "Нет данных",
          COL,
        ),
      )
      .join("");
    lines.push(`  ${pad("Buy / Sell", 14)}${buySellLine}`);

    lines.push("");
    lines.push(`  🔗 ${ta.pairUrl}`);
    lines.push("");
  }

  if (result.whaleConcentration) {
    const w = result.whaleConcentration;
    const conc = w.currentConcentration;
    const mcap = w.currentMcapUsd;
    const whalesMcap = mcap * (conc / 100);

    lines.push(`🐋 Концентрация китов (топ-${w.holderCount})`);
    lines.push("");
    lines.push(`  Текущая доля:      ${conc.toFixed(2)}% supply`);
    lines.push(`  MCAP:              $${fmtNum(mcap)}`);
    lines.push(`  У китов на руках:  $${fmtNum(whalesMcap)}`);

    const p = (s: string, n: number) => s.padEnd(n);
    const COL = 18;

    const fixedPeriods = [
      { label: "Сейчас", conc },
      { label: "вчера", conc: w.entries.find((e) => e.daysAgo === 1)?.concentration },
      { label: "3д назад", conc: w.entries.find((e) => e.daysAgo === 3)?.concentration },
      { label: "7д назад", conc: w.entries.find((e) => e.daysAgo === 7)?.concentration },
    ];

    const header = fixedPeriods.map((pr) => p(pr.label, COL)).join("");
    lines.push(`  ${p("Доля supply", 14)}${header}`);
    lines.push(`  ${"─".repeat(14 + fixedPeriods.length * COL)}`);

    const concLine = fixedPeriods
      .map((pr) =>
        pr.conc !== undefined ? p(`${pr.conc.toFixed(2)}%`, COL) : p("Нет данных", COL),
      )
      .join("");
    lines.push(`  ${p("% supply", 14)}${concLine}`);

    const deltas = [" ".repeat(COL)];
    for (let i = 1; i < fixedPeriods.length; i++) {
      const prevConc = fixedPeriods[i].conc;
      if (prevConc !== undefined) {
        const diff = conc - prevConc;
        const arrow = diff >= 0 ? "🟢" : "🔴";
        deltas.push(p(`  ${arrow}${fmtPercent(diff)}`, COL));
      } else {
        deltas.push(p("  Нет данных", COL));
      }
    }
    lines.push(`  ${p("Δ vs период", 14)}${deltas.join("")}`);

    const valueDeltas = [" ".repeat(COL)];
    for (let i = 1; i < fixedPeriods.length; i++) {
      const prevConc = fixedPeriods[i].conc;
      if (prevConc !== undefined) {
        const prevMcap = mcap * (prevConc / 100);
        const diffMcap = whalesMcap - prevMcap;
        const arrow = diffMcap >= 0 ? "🟢" : "🔴";
        valueDeltas.push(p(`  ${arrow}$${fmtNum(Math.abs(diffMcap))}`, COL));
      } else {
        valueDeltas.push(p("  Нет данных", COL));
      }
    }
    lines.push(`  ${p("Δ стоимость", 14)}${valueDeltas.join("")}`);

    const lastEntry = w.entries[w.entries.length - 1];
    if (lastEntry) {
      const firstDelta = conc - lastEntry.concentration;
      const action = firstDelta >= 0 ? "накапливают" : "распродают";
      lines.push("");
      lines.push(
        `  ${firstDelta >= 0 ? "📈" : "📉"} Киты ${action} токен (${firstDelta >= 0 ? "+" : ""}${firstDelta.toFixed(2)}% за ${lastEntry.daysAgo}д)`,
      );
    }

    if (result.whaleSignals.size > 0) {
      lines.push("");
      for (const [, signal] of result.whaleSignals) {
        lines.push(`  ${signal.emoji} ${signal.text}`);
      }
    }
    lines.push("");
  }

  const ph = result.periodHolderDiffs;
  if (ph.length > 0) {
    const p = (s: string, n: number) => s.padEnd(n);
    const d = (v: number) => (v >= 0 ? "🟢" : "🔴");
    const significant = ph.filter((h) =>
      [...h.deltas.values()].some((v) => Math.abs(v) >= SIGNIFICANT_CHANGE_PERCENT),
    );
    const rows = significant.length > 0 ? significant : ph;

    const filtered = rows.filter((h) =>
      [1, 3, 7].some((da) => {
        const v = h.deltas.get(da);
        return v !== undefined && v !== 0;
      }),
    );

    if (filtered.length > 0) {
      const COL = 14;
      const PCOL = 10;
      lines.push("📊 Изменения топ-холдеров (% supply)");
      lines.push("");
      lines.push(
        `  #   ${p("Адрес", 12)}${p("% supply", PCOL)}${p("1д", COL)}${p("3д", COL)}${p("7д", COL)}`,
      );
      lines.push(`  ${"─".repeat(4 + 12 + PCOL + COL * 3)}`);

      for (const h of filtered) {
        const label = h.label || shortAddr(h.address);
        const pctCol = p(`  ${h.currentPercentage.toFixed(2)}%`, PCOL);
        const cells = [1, 3, 7].map((da) => {
          const v = h.deltas.get(da);
          if (v === undefined) return p("Нет данных", COL);
          if (v === 0) return p("  —", COL);
          const sign = v >= 0 ? "+" : "";
          return p(`  ${d(v)}${sign}${v.toFixed(2)}%`, COL);
        });
        lines.push(`  #${String(h.rank).padEnd(3)}${p(label, 12)}${pctCol}${cells.join("")}`);
      }
      lines.push("");
    }
  }

  lines.push("📌 Итог");
  lines.push("");
  lines.push(result.summary);
  lines.push("");

  if (token.chain !== "Unknown") {
    lines.push(`🔗 Chain: ${token.chain}`);
  }
  lines.push(`📍 Token: ${token.address}`);

  return lines.join("\n");
}
