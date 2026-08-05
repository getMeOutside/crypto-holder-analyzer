# Crypto Holder Analyzer

Анализ держателей криптотокенов и генерация отчётов по динамике китов.

## Возможности

- 📊 Трекинг топ-50 держателей токена на EVM-чейнах
- 💰 Цена в реальном времени через CoinGecko / DeFiLlama
- 🔍 Определение входов/выходов на биржи (Binance, Coinbase, OKX и др.)
- 📈 Сравнение снимков держателей во времени
- 📝 Генерация детальных Markdown-отчётов на русском

## Поддерживаемые сети

| Сеть | Ключ |
|------|------|
| Ethereum | `eth` |
| BSC | `bsc` |
| Solana | `sol` |

## Установка

```bash
bun install
cp .env.example .env
```

Добавь API-ключи в `.env`:

| Переменная | Описание |
|------------|----------|
| `ETHERSCAN_KEY` | Etherscan API key |
| `BSCSCAN_KEY` | BscScan API key |
| `SOLSCAN_KEY` | Solscan API key (опционально) |
| `COINGECKO_KEY` | CoinGecko Pro key (опционально) |

## Использование

### 1. Сохранить снимок (первый запуск)

```bash
bun run snapshot <token_address> <chain>
```

Собирает текущий список держателей + цену и сохраняет JSON-файл в `data/snapshots/`.

### 2. Запустить анализ (после накопления снимков)

```bash
bun run analyze <token_address> <chain>
```

Сравнивает текущий снимок с предыдущим, генерирует отчёт с изменениями:
- Топ-6 китов — кто не изменился, кто продал/купил
- Потоки токенов на биржи (Binance, Coinbase и др.)
- Перераспределение среди средних китов (топ-7–20)
- Динамика цены за период и с начала мониторинга

### Примеры

```bash
# BSC токен (UAI)
bun run snapshot 0x0d8c86ab... bsc
bun run analyze 0x0d8c86ab... bsc

# Ethereum токен
bun run snapshot 0x1f9840a8... eth
bun run analyze 0x1f9840a8... eth

# Solana токен
bun run snapshot So11111111111111111111111111111111111111112 sol
```

## Рабочий процесс

```
День 1:   bun run snapshot <token> <chain>   → сохраняется снимок
День 7:   bun run snapshot <token> <chain>   → второй снимок
          bun run analyze <token> <chain>    → отчёт с диффом

Либо одной командой:
День 7:   bun run analyze <token> <chain>    → снимок + отчёт
```

Для регулярного мониторинга рекомендуется запускать `snapshot` раз в неделю через cron, а `analyze` — когда нужен отчёт.

## Хранение данных

```
data/
├── snapshots/
│   └── bsc_0x0d8c86ab.../
│       ├── 2026-07-29.json
│       ├── 2026-08-05.json
│       └── ...
└── reports/
    └── bsc_0x0d8c86ab..._2026-08-05.md
```

## Архитектура

```
src/
├── index.ts              # analyze — основной скрипт анализа
├── snapshot.ts           # snapshot — сохранение снимка
├── config/
│   └── chains.ts         # конфигурация сетей (RPC, explorer API)
├── api/
│   ├── holders.ts        # получение держателей через Transfer events
│   └── price.ts          # цена (CoinGecko + DeFiLlama)
├── storage/
│   └── snapshots.ts      # JSON-хранилище снимков
├── analysis/
│   └── analyzer.ts       # логика: diff держателей, биржи, перераспределение
├── report/
│   └── generator.ts      # генерация Markdown-отчёта с эмодзи
└── types/
    └── index.ts           # типы + база известных адресов бирж
```

## Ограничения

- Бесплатный tier Etherscan: 5 запросов/сек.
- Для полного списка держателей EVM (не только по Transfer events) рекомендуется Moralis или Alchemy.
- Solana: топ держатели берутся через `getTokenLargestAccounts` из `@solana/kit` (макс. ~20 аккаунтов — ограничение RPC).
- Цена из CoinGecko может быть недоступна для малых токенов — тогда используется DeFiLlama.
