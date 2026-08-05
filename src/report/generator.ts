import type { AnalysisResult } from "../types/index.js";

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

export function generateReport(result: AnalysisResult): string {
  const { currentSnapshot: cur, previousSnapshot: prev, firstSnapshot: first } = result;
  const token = cur.token;
  const lines: string[] = [];

  lines.push(`📊 ${token.symbol} — анализ держателей (${cur.date})`);
  lines.push("");

  if (result.priceChange) {
    const pc = result.priceChange;
    lines.push(`💰 Цена: ${fmtPrice(pc.current)}`);

    if (prev) {
      const ago = daysBetween(prev.timestamp, cur.timestamp);
      lines.push(`С момента последнего обновления прошло ${ago} ${daysWord(ago)}.`);
      lines.push("");

      const arrow = pc.changePercent >= 0 ? "🟢" : "🔴";
      lines.push(
        `${arrow} За это время цена ${pc.changePercent >= 0 ? "выросла" : "упала"} с ${fmtPrice(pc.previous)} до ${fmtPrice(pc.current)} (${pc.changePercent >= 0 ? "+" : ""}${pc.changePercent.toFixed(1)}%)`,
      );
    }

    if (first && first.priceUsd > 0 && pc.firstPriceChangePercent !== undefined) {
      lines.push(
        `📈 С начала мониторинга: ${fmtPrice(first.priceUsd)} → ${fmtPrice(pc.current)} (${pc.firstPriceChangePercent >= 0 ? "+" : ""}${pc.firstPriceChangePercent.toFixed(1)}%)`,
      );
    }
    lines.push("");
  }

  lines.push("Самое интересное — что происходило с держателями.");
  lines.push("");

  const top6Unchanged = result.topHolderChanges.filter(
    (d) => d.rank <= 6 && d.action === "unchanged",
  );
  const top6Changed = result.topHolderChanges.filter(
    (d) => d.rank <= 6 && d.action !== "unchanged",
  );

  if (top6Unchanged.length === 6) {
    lines.push("🟢 Топ-6 вообще не изменились");
    lines.push("");
    lines.push("Первые шесть крупнейших кошельков не продали ни одного токена.");
    lines.push("Их доли остались абсолютно такими же:");
    lines.push("");
    for (let i = 0; i < 6; i++) {
      const h = cur.holders[i];
      if (h) {
        lines.push(
          `#${h.rank} — ${h.percentage.toFixed(2)}%  (${fmtNum(h.balance)} ${token.symbol})`,
        );
      }
    }
  } else if (top6Changed.length > 0) {
    lines.push("Изменения в топ-6:");
    for (const diff of top6Changed) {
      const label = diff.label || shortAddr(diff.address);
      if (diff.action === "decreased") {
        lines.push(
          `🔴 #${diff.rank} ${label}: ${fmtNum(diff.previousBalance)} → ${fmtNum(diff.currentBalance)} (${diff.changePercent.toFixed(1)}%)`,
        );
      } else if (diff.action === "increased") {
        lines.push(
          `🟢 #${diff.rank} ${label}: ${fmtNum(diff.previousBalance)} → ${fmtNum(diff.currentBalance)} (+${diff.changePercent.toFixed(1)}%)`,
        );
      }
    }
  }
  lines.push("");

  if (result.exchangeFlows.length > 0) {
    lines.push("Exchange Flows:");
    lines.push("");
    for (const flow of result.exchangeFlows) {
      if (flow.currentBalance > 0 || (flow.previousBalance && flow.previousBalance > 0)) {
        let line = `📌 ${flow.exchange}: ${fmtNum(flow.currentBalance)} ${token.symbol}`;

        if (flow.previousBalance !== undefined && flow.previousBalance > 0) {
          const weekChange = flow.weeklyChange;
          line += ` (${weekChange >= 0 ? "+" : ""}${fmtNum(weekChange)} за неделю)`;
        }

        if (flow.firstBalance !== undefined && flow.firstBalance > 0) {
          line += ` | с начала: ${fmtNum(flow.firstBalance)} → ${fmtNum(flow.currentBalance)} (${flow.totalChangePercent >= 0 ? "+" : ""}${flow.totalChangePercent.toFixed(1)}%)`;
        }

        lines.push(line);
      }
    }
    lines.push("");
  }

  const distributing = result.redistribution.filter((r) => r.direction === "distributing");
  const accumulating = result.redistribution.filter((r) => r.direction === "accumulating");

  if (distributing.length > 0 || accumulating.length > 0) {
    lines.push("🟡 Средние киты активно перераспределяются");
    lines.push("");
    lines.push("За неделю несколько крупных кошельков заметно изменили позиции:");
    lines.push("");

    for (const event of [...distributing, ...accumulating]) {
      const label = shortAddr(event.address);
      const arrow = event.direction === "distributing" ? "📉" : "📈";
      lines.push(
        `${arrow} ${label}: ${fmtNum(event.previousBalance)} → ${fmtNum(event.balance)} (${event.changePercent >= 0 ? "+" : ""}${event.changePercent.toFixed(1)}%)`,
      );
    }
    lines.push("");
  }

  if (first && first.date !== cur.date) {
    lines.push(`📈 Сравнение с первым днём мониторинга (${first.date}):`);
    lines.push("");

    const top6FromFirst = cur.holders
      .slice(0, 6)
      .map((h) => {
        const firstHolder = first.holders.find(
          (f) => f.address.toLowerCase() === h.address.toLowerCase(),
        );
        if (!firstHolder) return null;
        return {
          rank: h.rank,
          address: h.address,
          current: h.balance,
          first: firstHolder.balance,
          unchanged: Math.abs(h.balance - firstHolder.balance) < h.balance * 0.001,
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    const allTop6Unchanged = top6FromFirst.every((t) => t.unchanged);
    if (allTop6Unchanged) {
      lines.push("✅ Топ-6 вообще не изменились с самого начала.");
    }
    lines.push("");
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
