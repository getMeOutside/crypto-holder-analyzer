import type { AnalysisResult } from "../types/index.js";
import { SIGNIFICANT_CHANGE_PERCENT, HOLDER_PERIODS_DAYS, MS_PER_DAY } from "../constants.js";

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
  return Math.round(Math.abs(date2.getTime() - date1.getTime()) / MS_PER_DAY);
}

function daysWord(n: number): string {
  if (n === 1) return "день";
  if (n >= 2 && n <= 4) return "дня";
  return "дней";
}

export function generateReport(result: AnalysisResult): string {
  const { currentSnapshot: cur, previousSnapshot: prev, firstSnapshot: first } = result;
  const token = cur.token;

  console.log(`📊 ${token.symbol} — анализ держателей (${cur.date})`);
  console.log("");

  if (result.priceChange) {
    const pc = result.priceChange;
    console.log(`💰 Цена: ${fmtPrice(pc.current)}`);

    if (pc.historical && pc.historical.length > 0) {
      const hasApi = pc.historical.some((h) => h.source === "api");
      const histMap = new Map(pc.historical.map((h) => [h.daysAgo, h.price]));

      const prices: (number | undefined)[] = [
        pc.current,
        histMap.get(1),
        histMap.get(3),
        histMap.get(7),
      ];
      const deltas: (string | number)[] = ["—"];
      for (let i = 1; i < prices.length; i++) {
        const price = prices[i];
        if (price !== undefined) {
          const change = ((pc.current - price) / price) * 100;
          deltas.push(`${change >= 0 ? "+" : ""}${change.toFixed(2)}%`);
        } else {
          deltas.push("Нет данных");
        }
      }

      const periodLabels = ["Сейчас", "Вчера", "3д", "7д"];
      const tableData = [
        {
          Метрика: "Цена",
          ...Object.fromEntries(
            periodLabels.map((l, i) => [
              l,
              prices[i] !== undefined ? fmtPrice(prices[i]!) : "Нет данных",
            ]),
          ),
        },
        { Метрика: "Δvs пер", ...Object.fromEntries(periodLabels.map((l, i) => [l, deltas[i]])) },
      ];
      console.table(tableData);

      if (hasApi) {
        console.log("  Источник цен: DeFiLlama");
      }

      if (first && first.priceUsd > 0 && pc.firstPriceChangePercent !== undefined) {
        console.log(
          `  📈 С начала мониторинга: ${fmtPrice(first.priceUsd)} → ${fmtPrice(pc.current)} (${pc.firstPriceChangePercent >= 0 ? "+" : ""}${pc.firstPriceChangePercent.toFixed(1)}%)`,
        );
      }
    } else if (pc.previous !== undefined && pc.changePercent !== undefined) {
      const ago = prev ? daysBetween(prev.timestamp, cur.timestamp) : 1;
      if (ago > 1) {
        console.log(`  С момента последнего обновления прошло ${ago} ${daysWord(ago)}.`);
      }
      const arrow = pc.changePercent >= 0 ? "🟢" : "🔴";
      console.log(
        `  ${arrow} За это время цена ${pc.changePercent >= 0 ? "выросла" : "упала"} с ${fmtPrice(pc.previous)} до ${fmtPrice(pc.current)} (${pc.changePercent >= 0 ? "+" : ""}${pc.changePercent.toFixed(1)}%)`,
      );
      if (first && first.priceUsd > 0 && pc.firstPriceChangePercent !== undefined) {
        console.log(
          `  📈 С начала мониторинга: ${fmtPrice(first.priceUsd)} → ${fmtPrice(pc.current)} (${pc.firstPriceChangePercent >= 0 ? "+" : ""}${pc.firstPriceChangePercent.toFixed(1)}%)`,
        );
      }
    }
    console.log("");
  }

  if (result.tradingActivityDiffs) {
    const d = result.tradingActivityDiffs;
    const ta = d.current;

    console.log(`📊 Торговая активность (${ta.dex}, ${ta.quoteToken})`);

    const pct = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);
    const entryMap = new Map(d.entries.map((e) => [e.daysAgo, e.activity]));
    const periodLabels = ["Сейчас", "Вчера", "3д", "7д"];
    const activities = [ta, entryMap.get(1), entryMap.get(3), entryMap.get(7)];

    const buildDeltRow = (
      metric: string,
      getter: (a: (typeof activities)[number]) => number | undefined,
    ) => {
      const curVal = getter(activities[0]);
      const row: Record<string, string | number> = { Метрика: metric };
      for (let i = 0; i < periodLabels.length; i++) {
        if (i === 0) row[periodLabels[i]] = "—";
        else {
          const prevVal = activities[i] ? getter(activities[i]) : undefined;
          if (prevVal !== undefined && curVal !== undefined) {
            const change = pct(curVal, prevVal);
            row[periodLabels[i]] =
              change !== null ? `${change >= 0 ? "+" : ""}${change.toFixed(1)}%` : "—";
          } else {
            row[periodLabels[i]] = "Нет данных";
          }
        }
      }
      return row;
    };

    const tableData = [
      {
        Метрика: "Volume 24h",
        ...Object.fromEntries(
          periodLabels.map((l, i) => {
            const a = activities[i];
            return [l, a ? `$${fmtNum(a.volume24h)}` : "Нет данных"];
          }),
        ),
      },
      buildDeltRow("ΔVolume", (a) => (a ? (a as typeof ta).volume24h : undefined)),
      {
        Метрика: "Транзакции",
        ...Object.fromEntries(
          periodLabels.map((l, i) => {
            const a = activities[i];
            return [l, a ? fmtNum(a.txns24h.buys + a.txns24h.sells) : "Нет данных"];
          }),
        ),
      },
      buildDeltRow("ΔTxns", (a) =>
        a ? (a as typeof ta).txns24h.buys + (a as typeof ta).txns24h.sells : undefined,
      ),
      {
        Метрика: "Buy / Sell",
        ...Object.fromEntries(
          periodLabels.map((l, i) => {
            const a = activities[i];
            return [l, a ? `${a.txns24h.buys}/${a.txns24h.sells}` : "Нет данных"];
          }),
        ),
      },
    ];
    console.table(tableData);

    console.log(`  🔗 ${ta.pairUrl}`);
    console.log("");
  }

  if (result.whaleConcentration) {
    const w = result.whaleConcentration;
    const conc = w.currentConcentration;
    const mcap = w.currentMcapUsd;
    const whalesMcap = mcap * (conc / 100);

    console.log(
      `🐋 Концентрация китов (топ-${w.holderCount}) | Доля: ${conc.toFixed(2)}% | MCAP: $${fmtNum(mcap)} | У китов: $${fmtNum(whalesMcap)}`,
    );

    const periodLabels = ["Сейчас", "Вчера", "3д", "7д"];
    const concVals: (number | undefined)[] = [
      conc,
      w.entries.find((e) => e.daysAgo === 1)?.concentration,
      w.entries.find((e) => e.daysAgo === 3)?.concentration,
      w.entries.find((e) => e.daysAgo === 7)?.concentration,
    ];

    const deltaValues: (string | number)[] = ["—"];
    const mcapDeltas: (string | number)[] = ["—"];
    for (let i = 1; i < concVals.length; i++) {
      const prevConc = concVals[i];
      if (prevConc !== undefined) {
        const diff = conc - prevConc;
        deltaValues.push(`${diff >= 0 ? "+" : ""}${diff.toFixed(2)}%`);
        const prevMcap = mcap * (prevConc / 100);
        const diffMcap = whalesMcap - prevMcap;
        mcapDeltas.push(`${diffMcap >= 0 ? "+" : "-"}$${fmtNum(Math.abs(diffMcap))}`);
      } else {
        deltaValues.push("Нет данных");
        mcapDeltas.push("Нет данных");
      }
    }

    const tableData = [
      {
        Метрика: "% supply",
        ...Object.fromEntries(
          periodLabels.map((l, i) => [
            l,
            concVals[i] !== undefined ? `${concVals[i]!.toFixed(2)}%` : "Нет данных",
          ]),
        ),
      },
      {
        Метрика: "Δvs пер",
        ...Object.fromEntries(periodLabels.map((l, i) => [l, deltaValues[i]])),
      },
      {
        Метрика: "Δ $китов",
        ...Object.fromEntries(periodLabels.map((l, i) => [l, mcapDeltas[i]])),
      },
    ];
    console.table(tableData);

    const lastEntry = w.entries[w.entries.length - 1];
    if (lastEntry) {
      const firstDelta = conc - lastEntry.concentration;
      const action = firstDelta >= 0 ? "накапливают" : "распродают";
      console.log(
        `  ${firstDelta >= 0 ? "📈" : "📉"} Киты ${action} токен (${firstDelta >= 0 ? "+" : ""}${firstDelta.toFixed(2)}% за ${lastEntry.daysAgo}д)`,
      );
    }

    if (result.whaleSignals.size > 0) {
      console.log("");
      for (const [, signal] of result.whaleSignals) {
        console.log(`  ${signal.emoji} ${signal.text}`);
      }
    }
    console.log("");
  }

  const ph = result.periodHolderDiffs;
  if (ph.length > 0) {
    const significant = ph.filter((h) =>
      [...h.deltas.values()].some((v) => Math.abs(v.ppChange) >= SIGNIFICANT_CHANGE_PERCENT),
    );
    const rows = significant.length > 0 ? significant : ph;

    const filtered = rows.filter((h) =>
      [...HOLDER_PERIODS_DAYS].some((da) => {
        const v = h.deltas.get(da);
        return v !== undefined && (v.ppChange !== 0 || v.balanceChange !== 0);
      }),
    );

    if (filtered.length > 0) {
      console.log(`📋 Изменения топ-холдеров (${token.symbol})`);
      const tableData = filtered.map((h) => {
        const label = h.label || shortAddr(h.address);
        const row: Record<string, string | number> = {
          "#": h.rank,
          Адрес: label,
          "% supply": `${h.currentPercentage.toFixed(2)}%`,
        };
        for (const da of HOLDER_PERIODS_DAYS) {
          const key = `${da}д`;
          const v = h.deltas.get(da);
          if (v === undefined) {
            row[key] = "Нет данных";
          } else if (v.ppChange === 0 && v.balanceChange === 0) {
            row[key] = "—";
          } else {
            const bs = v.balanceChange >= 0 ? "+" : "";
            const curBal =
              v.balanceChange >= 0 ? h.currentBalance : h.currentBalance - v.balanceChange;
            const pctBal =
              curBal > 0 ? ` (${((Math.abs(v.balanceChange) / curBal) * 100).toFixed(1)}%)` : "";
            row[key] =
              `${bs}${v.ppChange.toFixed(2)}pp │ ${bs}${fmtNum(Math.abs(v.balanceChange))}т${pctBal}`;
          }
        }
        return row;
      });
      console.table(tableData);
    }
  }

  console.log("📌 Итог");
  console.log("");
  console.log(result.summary);
  console.log("");

  if (token.chain !== "Unknown") {
    console.log(`🔗 Chain: ${token.chain}`);
  }
  console.log(`📍 Token: ${token.address}`);

  return [
    `📊 ${token.symbol} — анализ держателей (${cur.date})`,
    "",
    result.summary,
    "",
    token.chain !== "Unknown" ? `🔗 Chain: ${token.chain}` : null,
    `📍 Token: ${token.address}`,
  ]
    .filter(Boolean)
    .join("\n");
}
