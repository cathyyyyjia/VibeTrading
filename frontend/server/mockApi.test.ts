import { describe, expect, it, beforeEach } from 'vitest';
import {
  hashSeed,
  seededRandom,
  generateRunId,
  generateEquityCurve,
  generateTrades,
  generateKPIs,
  generateFullCode,
} from './lib/seed';
import {
  createRun,
  getRun,
  getRunStatus,
  getRunReport,
  deployRun,
} from './lib/mockRunRegistry';

// ============================================================
// Seed utilities
// ============================================================
describe('seed utilities', () => {
  it('hashSeed returns a positive integer for any string', () => {
    const h1 = hashSeed('abc');
    const h2 = hashSeed('xyz');
    expect(h1).toBeGreaterThanOrEqual(0);
    expect(h2).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(h1)).toBe(true);
  });

  it('hashSeed is deterministic', () => {
    expect(hashSeed('test123')).toBe(hashSeed('test123'));
  });

  it('seededRandom produces values in [0,1)', () => {
    const rng = seededRandom(42);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('seededRandom is deterministic for same seed', () => {
    const a = seededRandom(99);
    const b = seededRandom(99);
    for (let i = 0; i < 10; i++) {
      expect(a()).toBe(b());
    }
  });

  it('generateRunId returns an 8-char alphanumeric string', () => {
    const id = generateRunId();
    expect(id).toHaveLength(8);
    expect(/^[A-Za-z0-9]+$/.test(id)).toBe(true);
  });

  it('generateEquityCurve returns 100 points with t and v', () => {
    const curve = generateEquityCurve(12345);
    expect(curve).toHaveLength(100);
    curve.forEach((pt) => {
      expect(pt).toHaveProperty('t');
      expect(pt).toHaveProperty('v');
      expect(typeof pt.t).toBe('number');
      expect(typeof pt.v).toBe('number');
    });
  });

  it('generateEquityCurve is deterministic', () => {
    const a = generateEquityCurve(42);
    const b = generateEquityCurve(42);
    expect(a).toEqual(b);
  });

  it('generateTrades returns 12 trades', () => {
    const trades = generateTrades(42);
    expect(trades).toHaveLength(12);
    trades.forEach((t) => {
      expect(t).toHaveProperty('timestamp');
      expect(t).toHaveProperty('symbol');
      expect(t).toHaveProperty('action');
      expect(['BUY', 'SELL']).toContain(t.action);
      expect(typeof t.price).toBe('number');
    });
  });

  it('generateKPIs returns valid KPI object', () => {
    const kpis = generateKPIs(42);
    expect(kpis).toHaveProperty('returnPct');
    expect(kpis).toHaveProperty('cagrPct');
    expect(kpis).toHaveProperty('sharpe');
    expect(kpis).toHaveProperty('maxDdPct');
    expect(kpis.returnPct).toBeGreaterThan(0);
    expect(kpis.maxDdPct).toBeLessThan(0);
  });

  it('generateFullCode includes prompt text', () => {
    const code = generateFullCode('Buy BTC when MA crosses');
    expect(code).toContain('Buy BTC when MA crosses');
    expect(code).toContain('class GeneratedStrategy');
    expect(code).toContain('on_signal');
  });
});

// ============================================================
// Mock Run Registry
// ============================================================
describe('mockRunRegistry', () => {
  it('createRun returns a valid run entry', () => {
    const run = createRun('Buy BTC when RSI < 30');
    expect(run).toHaveProperty('runId');
    expect(run).toHaveProperty('prompt', 'Buy BTC when RSI < 30');
    expect(run).toHaveProperty('createdAt');
    expect(run).toHaveProperty('seed');
    expect(typeof run.shouldFail).toBe('boolean');
  });

  it('getRun retrieves a previously created run', () => {
    const run = createRun('Test prompt');
    const retrieved = getRun(run.runId);
    expect(retrieved).toBeDefined();
    expect(retrieved!.runId).toBe(run.runId);
    expect(retrieved!.prompt).toBe('Test prompt');
  });

  it('getRun returns undefined for unknown runId', () => {
    expect(getRun('nonexistent')).toBeUndefined();
  });

  it('getRunStatus returns null for unknown runId', () => {
    expect(getRunStatus('nonexistent')).toBeNull();
  });

  it('getRunStatus returns running state immediately after creation', () => {
    const run = createRun('Buy ETH on golden cross');
    // Force no failure for this test
    run.shouldFail = false;
    const status = getRunStatus(run.runId);
    expect(status).not.toBeNull();
    expect(status!.state).toBe('running');
    expect(status!.steps).toHaveLength(4);
    // First step should be running
    expect(status!.steps[0].status).toBe('running');
    // Other steps should be queued
    expect(status!.steps[1].status).toBe('queued');
    expect(status!.steps[2].status).toBe('queued');
    expect(status!.steps[3].status).toBe('queued');
  });

  it('getRunStatus extracts tags from prompt', () => {
    const run = createRun('Buy BTC when golden cross with RSI filter');
    run.shouldFail = false;
    const status = getRunStatus(run.runId);
    expect(status!.steps[0].tags).toBeDefined();
    expect(status!.steps[0].tags).toContain('Asset: BTC');
    expect(status!.steps[0].tags).toContain('Logic: Golden Cross');
    expect(status!.steps[0].tags).toContain('Filter: RSI < 30');
  });

  it('getRunStatus shows completed after enough time', () => {
    const run = createRun('Buy BTC on MA cross');
    run.shouldFail = false;
    // Simulate 15 seconds elapsed
    run.createdAt = Date.now() - 15000;
    const status = getRunStatus(run.runId);
    expect(status!.state).toBe('completed');
    expect(status!.progress).toBe(100);
    expect(status!.steps.every((s) => s.status === 'done')).toBe(true);
    expect(status!.artifacts.dsl).not.toBe('');
    expect(status!.artifacts.reportUrl).toContain(run.runId);
  });

  it('getRunStatus shows failed when shouldFail is true', () => {
    const run = createRun('Buy BTC test failure');
    run.shouldFail = true;
    run.failStep = 0;
    // Simulate enough time for step 0 to fail
    run.createdAt = Date.now() - 3000;
    const status = getRunStatus(run.runId);
    expect(status!.state).toBe('failed');
    expect(status!.steps[0].status).toBe('error');
    expect(status!.steps[0].logs.some((l) => l.includes('ERROR'))).toBe(true);
  });

  it('getRunReport returns null for unknown runId', () => {
    expect(getRunReport('nonexistent')).toBeNull();
  });

  it('getRunReport returns valid report for existing run', () => {
    const run = createRun('Buy BTC for report test');
    const report = getRunReport(run.runId);
    expect(report).not.toBeNull();
    expect(report!.kpis).toHaveProperty('returnPct');
    expect(report!.equity).toHaveLength(100);
    expect(report!.trades).toHaveLength(12);
  });

  it('getRunReport is deterministic for same run', () => {
    const run = createRun('Deterministic test');
    const r1 = getRunReport(run.runId);
    const r2 = getRunReport(run.runId);
    expect(r1).toEqual(r2);
  });

  it('deployRun returns null for unknown runId', () => {
    expect(deployRun('nonexistent', 'paper')).toBeNull();
  });

  it('deployRun returns ok for paper mode', () => {
    const run = createRun('Deploy test paper');
    const result = deployRun(run.runId, 'paper');
    expect(result).not.toBeNull();
    expect(result!.deployId).toBeDefined();
    expect(result!.status).toBe('ok');
  });

  it('deployRun returns queued for live mode', () => {
    const run = createRun('Deploy test live');
    const result = deployRun(run.runId, 'live');
    expect(result).not.toBeNull();
    expect(result!.deployId).toBeDefined();
    expect(result!.status).toBe('queued');
  });

  it('backtest progress increases over time', () => {
    const run = createRun('Progress test');
    run.shouldFail = false;
    
    // At 8 seconds - should be in backtest running
    run.createdAt = Date.now() - 8000;
    const status1 = getRunStatus(run.runId);
    expect(status1!.steps[3].status).toBe('running');
    expect(status1!.progress).toBeGreaterThan(0);
    expect(status1!.progress).toBeLessThan(100);
    
    // At 12+ seconds - should be completed
    run.createdAt = Date.now() - 13000;
    const status2 = getRunStatus(run.runId);
    expect(status2!.progress).toBe(100);
    expect(status2!.state).toBe('completed');
  });
});
