// ============================================================
// Seeded random number generator for stable mock data
// Uses simple hash of runId to produce deterministic results
// ============================================================

export function hashSeed(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

export function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

export function generateRunId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Generate equity curve from seed
export function generateEquityCurve(seed: number): Array<{ t: number; v: number }> {
  const rng = seededRandom(seed);
  const points: Array<{ t: number; v: number }> = [];
  let value = 10000;
  const startDate = new Date('2024-01-15').getTime();

  for (let i = 0; i < 100; i++) {
    const t = startDate + i * 2.8 * 86400000;
    const trend = i * 8;
    const noise = (rng() - 0.45) * 80;
    const cycle = Math.sin(i * 0.15) * 150;
    value = 10000 + trend + noise + cycle;

    if (i >= 25 && i <= 40) {
      value -= 200 + Math.sin((i - 25) * 0.2) * 100;
    }
    if (i >= 75) {
      value += (i - 75) * 15;
    }

    points.push({ t, v: Math.round(value * 100) / 100 });
  }
  return points;
}

// Generate trades from seed
export function generateTrades(seed: number): Array<{
  timestamp: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  price: number;
  pnl: number | null;
}> {
  const rng = seededRandom(seed + 1);
  const symbols = ['BTC-USD', 'ETH-USD'];
  const trades: Array<{
    timestamp: string;
    symbol: string;
    action: 'BUY' | 'SELL';
    price: number;
    pnl: number | null;
  }> = [];

  const basePrices: Record<string, number> = { 'BTC-USD': 34000, 'ETH-USD': 1800 };
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  let month = 9; // Oct
  let day = 24;

  for (let i = 0; i < 12; i++) {
    const sym = symbols[Math.floor(rng() * symbols.length)];
    const base = basePrices[sym];
    const isBuy = i % 2 === 0;
    const price = base + (rng() - 0.3) * base * 0.08;
    const hour = Math.floor(rng() * 14) + 8;
    const min = Math.floor(rng() * 60);

    day += Math.floor(rng() * 3) + 1;
    if (day > 28) { day = day - 28; month++; }
    if (month > 11) month = 0;

    const pnl = isBuy ? null : Math.round((rng() - 0.3) * 1500 * 100) / 100;

    trades.push({
      timestamp: `${months[month]} ${String(day).padStart(2, '0')}, ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
      symbol: sym,
      action: isBuy ? 'BUY' : 'SELL',
      price: Math.round(price * 100) / 100,
      pnl,
    });
  }

  return trades;
}

// Generate KPIs from seed
export function generateKPIs(seed: number) {
  const rng = seededRandom(seed + 2);
  return {
    returnPct: Math.round((100 + rng() * 100) * 10) / 10,
    cagrPct: Math.round((20 + rng() * 30) * 10) / 10,
    sharpe: Math.round((1.2 + rng() * 1.2) * 100) / 100,
    maxDdPct: -Math.round((5 + rng() * 15) * 10) / 10,
  };
}

// Generate strategy code
export function generateFullCode(prompt: string): string {
  return `# Aipha Strategy DSL v2.4
# Generated from natural language prompt
# Prompt: "${prompt}"

import numpy as np
from aipha.core import Strategy, Signal

class GeneratedStrategy(Strategy):
    """
    Auto-generated from: ${prompt}
    """
    
    def __init__(self):
        self.sma_fast = 50
        self.sma_slow = 200
        self.rsi_period = 14
        self.rsi_threshold = 30
    
    def on_signal(self, data):
        sma50 = data.sma(self.sma_fast)
        sma200 = data.sma(self.sma_slow)
        rsi = data.rsi(self.rsi_period)
        
        if sma50 > sma200 and rsi < self.rsi_threshold:
            return Signal.LONG
        elif sma50 < sma200:
            return Signal.CLOSE
        
        return Signal.HOLD
    
    def on_risk(self, position):
        if position.unrealized_pnl_pct < -0.05:
            return Signal.CLOSE
        if position.unrealized_pnl_pct > 0.15:
            return Signal.CLOSE
        return Signal.HOLD

config = {
    "asset": "BTC-USD",
    "timeframe": "1D",
    "start_date": "2024-01-01",
    "end_date": "2024-12-31",
    "initial_capital": 10000,
    "commission": 0.001,
    "slippage": 0.0005,
}`;
}
