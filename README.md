# Crypto Holder Analyzer

Анализ держателей криптотокенов и генерация отчётов по динамике китов.

## Возможности

- 📊 Трекинг топ-50 держателей токена (EVM) / топ-20 (Solana)
- 💰 Цена в реальном времени через CoinGecko / DeFiLlama
- 📈 Торговая активность через DexScreener (volume 24h, txns buy/sell, дельты за 3 дня и неделю)
- 🔍 Определение входов/выходов на биржи (Binance, Coinbase, OKX и др.)
- 🔄 Динамическое отслеживание изменений держателей (порог 1%, все холдеры — не только топ-6)
- 📝 Генерация детальных Markdown-отчётов на русском

## Поддерживаемые сети

| Сеть | Ключ |
|------|------|
| Ethereum | `eth` |
| Solana | `sol` |

## Установка

```bash
bun install
cp .env.example .env
```

Добавь API-ключи в `.env`:

| Переменная | Описание | Обязательный |
|------------|----------|:---:|
| `ETHERSCAN_KEY` | Etherscan API key | — |
| `COINGECKO_KEY` | CoinGecko Pro key (опционально) | нет |

DexScreener API бесплатный и не требует ключа.

## Использование

Единая команда `analyze` делает снимок + анализ:

```bash
bun run analyze <token_address> <chain>
```

- Если_previousх снимков нет — просто сохраняет текущий снимок
- Если_previousе снимки есть — сравнивает, генерирует отчёт

Отдельный снимок без анализа:

```bash
bun run snapshot <token_address> <chain>
```

### Что включает отчёт

- **Изменения держателей** — все кошельки, изменившие баланс более чем на 1%
- **Торговая активность** — volume 24h, транзакции (buy/sell) в таблице: сейчас vs вчера vs 3 дня vs неделя
- **Exchange Flows** — потоки токенов на/с бирж
- **Перераспределение** — средние киты (топ-7–20) с >5% изменениями
- **Динамика цены** — за период и с начала мониторинга
- **Сравнение с первым днём** — все значимые изменения с момента старта

### Примеры

```bash
# Ethereum токен
bun run analyze 0x0d8c86ab... eth

# Ethereum токен
bun run analyze 0x1f9840a8... eth

# Solana токен
bun run analyze ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82 sol
```

## Рабочий процесс

```
День 1:   bun run analyze <token> <chain>   → снимок + уведомление "нет_previousх данных"
День 2+:  bun run analyze <token> <chain>   → снимок + полный отчёт

Дельты за 3 дня / неделю появляются после накопления истории.
```

## Хранение данных

```
data/
├── snapshots/
│   └── eth_0x0d8c86ab.../
│       ├── 2026-07-29.json
│       ├── 2026-08-05.json
│       └── ...
└── reports/
    └── eth_0x0d8c86ab..._2026-08-05.md
```

Каждый снимок включает: топ-холдеров, цену и данные DexScreener (volume, txns, пара).

## Архитектура

```
src/
├── index.ts              # analyze — снимок + анализ + отчёт
├── snapshot.ts           # snapshot — только сохранение снимка
├── config/
│   └── chains.ts         # конфигурация сетей (RPC, explorer API, DexScreener chain ID)
├── api/
│   ├── holders.ts        # держатели (EVM: Transfer events, Solana: getTokenLargestAccounts)
│   ├── price.ts          # цена (CoinGecko + DeFiLlama fallback)
│   └── dexscreener.ts    # торговая активность (DexScreener API, топ-пара автоматически)
├── storage/
│   └── snapshots.ts      # JSON-хранилище снимков
├── analysis/
│   └── analyzer.ts       # diff держателей, биржи, redistribution, trading activity diffs
├── report/
│   └── generator.ts      # генерация Markdown-отчёта (русский, эмодзи)
└── types/
    └── index.ts           # типы + KNOWN_EXCHANGES (адреса бирж)
```

## Ограничения

- Бесплатный tier Etherscan: 5 запросов/сек.
- EVM держатели — только из Transfer events (последние ~50k блоков). Для полного списка нужен Moralis/Alchemy.
- Solana: `getTokenLargestAccounts` возвращает топ-20 (ограничение RPC).
- Цена из CoinGecko может быть недоступна для малых токенов — тогда используется DeFiLlama.
- DexScreener: автоматически берётся топ-пара по volume. Для выбора конкретной пары — нужна доработка.
- Дельты за 3 дня / неделю появятся только после накопления нескольких снимков.
