// ─── Time ───

export const MS_PER_DAY = 86_400_000;
export const SECONDS_PER_DAY = 86_400;

// ─── Holders ───

export const MAX_HOLDERS_IN_SNAPSHOT = 50;
export const HOLDER_PERIODS_DAYS = [1, 3, 7] as const;
export const SIGNIFICANT_CHANGE_PERCENT = 1;
export const SNAPSHOT_TOLERANCE_MS = 2 * MS_PER_DAY;

// ─── Analyzer thresholds ───

export const UNCHANGED_THRESHOLD_PERCENT = 0.5;
export const WHALE_ACCUMULATION_THRESHOLD_PERCENT = 1;
export const REDISTRIBUTION_MIN_RANK = 7;
export const REDISTRIBUTION_MAX_RANK = 20;
export const REDISTRIBUTION_THRESHOLD_PERCENT = 5;
export const PRICE_DROP_WARNING_PERCENT = -20;
export const PRICE_GAIN_WARNING_PERCENT = 20;

// ─── EVM holder fetching ───

export const DEFAULT_HOLDER_LIMIT = 50;
export const MAX_RETRY_ATTEMPTS = 3;
export const RETRY_BASE_DELAY_MS = 1000;
export const EVM_BLOCKS_TO_SCAN = 50_000;
export const EVM_REQUEST_DELAY_MS = 250;
