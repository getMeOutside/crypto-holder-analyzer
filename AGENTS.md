# AGENTS.md — Crypto Holder Analyzer

## О проекте

CLI-инструмент на Bun + TypeScript для анализа держателей криптотокенов. Собирает снимки топ-50 держателей, сравнивает их во времени и генерирует отчёты с выявлением паттернов: неподвижные киты, потоки на биржи, перераспределение.

## Стек

- **Runtime:** Bun (не Node.js)
- **Язык:** TypeScript (strict mode, ESNext)
- **Зависимости:** ethers v6 (EVM on-chain), @solana/kit (Solana RPC), axios (цены, DexScreener)
- **Хранение:** JSON-файлы в `data/`

## Как запускать

```bash
bun install
bun run snapshot <token_address> <chain>
bun run analyze <token_address> <chain>
```

## Структура кода

| Модуль | Файл | Ответственность |
|--------|------|-----------------|
| Types | `src/types/index.ts` | Все типы, `KNOWN_EXCHANGES` (адреса бирж) |
| Constants | `src/constants.ts` | Все магические числа и конфигурационные значения |
| Config | `src/config/chains.ts` | RPC, explorer API, CoinGecko ID для каждой сети |
| Holders API | `src/api/holders.ts` | Fetch токена (ERC-20 для ETH/BSC, SPL для Solana через @solana/kit) |
| Price API | `src/api/price.ts` | Цена через CoinGecko → DeFiLlama (fallback) |
| DexScreener API | `src/api/dexscreener.ts` | Торговая активность: volume 24h, txns 24h, пара, DEX |
| Storage | `src/storage/snapshots.ts` | CRUD JSON-снимков в `data/snapshots/` |
| Analysis | `src/analysis/analyzer.ts` | Diff держателей, распознавание бирж, redistribution, summary |
| Report | `src/report/generator.ts` | Markdown-отчёт на русском с эмодзи |
| Entry | `src/index.ts` | `analyze` команда: fetch → snapshot → analyze → report |
| Entry | `src/snapshot.ts` | `snapshot` команда: fetch → snapshot |

## Правила для агентов

### При изменении кода

1. **После правок запусти `npx tsc --noEmit`** — проект в strict mode, ошибки типов не допускаются.
2. **Не меняй структуру `data/`** — снимки уже существуют, формат должен быть обратно совместимым.
3. **Не удаляй адреса из `KNOWN_EXCHANGES`** без обсуждения — это ломает аналитику для существующих снимков.
4. **Все магические числа выноси в `src/constants.ts`** — пороги, лимиты, размеры колонок, периоды.

### При добавлении новой сети

1. Добавь конфиг в `src/config/chains.ts` (rpc, explorerApi, explorerKeyEnv, coingeckoId, dexscreenerId).
2. Добавь платформу в `src/api/price.ts` → `platformMap` (CoinGecko) и `chainMap` (DeFiLlama).
3. Для EVM: `fetchHoldersEtherscan()` в `src/api/holders.ts` — использует Transfer events через ethers.
4. Для Solana: `fetchTopHoldersSolana()` в `src/api/holders.ts` — использует `getTokenLargestAccounts` через `@solana/kit` (`createSolanaRpc`).
5. Обнови `src/config/chains.ts` → `getExplorerKey()` если нужно.

### При изменении логики анализа

- `src/analysis/analyzer.ts` — чистые функции, не трогают I/O.
- `KNOWN_EXCHANGES` используется для маркировки адресов бирж в отчёте.
- Порог redistribution: 5% изменения баланса (`buildRedistribution`, см. `REDISTRIBUTION_THRESHOLD_PERCENT`).
- Порог "unchanged": <0.5% изменения (`buildHolderDiffs`, см. `UNCHANGED_THRESHOLD_PERCENT`).
- `buildTradingActivityDiffs` — дельты volume/txns из истории снепшотов (3 дня, неделя).

### При изменении отчёта

- `src/report/generator.ts` — только генерация строк, не содержит логики анализа.
- Текст на русском. Формат: эмодзи-заголовок → секции с данными → итог.

## Зависимости

```
ethers@6 — on-chain чтение (EVM: RPC, ERC-20, Transfer events)
@solana/kit — Solana RPC (getTokenSupply, getTokenLargestAccounts, getAccountInfo)
axios — CoinGecko, DeFiLlama, DexScreener
@types/bun — типы для Bun runtime
typescript — компилятор
```

## Сети

- `eth` — Ethereum (Etherscan API + Transfer events)
- `bsc` — BSC (BscScan API + Transfer events)
- `sol` — Solana (Solana RPC `getTokenLargestAccounts` через @solana/kit)

## Известные ограничения

- EVM держатели получаются только из Transfer events (последние ~50k блоков). Для полного списка нужен Moralis/Alchemy.
- Solana: `getTokenLargestAccounts` возвращает топ-20 по балансу в токен-аккаунтах.
- Бесплатный tier Etherscan: 5 req/s.
- `KNOWN_EXCHANGES` — не полный список бирж, только основные.
