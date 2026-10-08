// BNK-14: the daily cap on statement reads. Run: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCapStatus, irishDayStart, DEFAULT_READ_LIMITS } from '../api/_read-cap.js';

const R = (status, cost, tokens = 1000) => ({ status, cost_usd: cost, tokens_in: tokens });

test('defaults: 40 reads or US$5 a day, whichever comes first', () => {
  assert.deepEqual(DEFAULT_READ_LIMITS, { max_reads_per_day: 40, max_usd_per_day: 5 });
  assert.equal(readCapStatus(Array.from({ length: 39 }, () => R('read', 0.03))).reached, false);
  assert.equal(readCapStatus(Array.from({ length: 40 }, () => R('read', 0.03))).reached, true);
  const dear = readCapStatus([R('read', 2.5), R('read', 2.5)]);
  assert.equal(dear.reached, true);
  assert.match(dear.message, /40 reads or US\$5\.00 a day; used: 2 reads, US\$5\.00\). It resets at midnight/);
});

test('only reads that called the model count; a refused scanned file before any call does not', () => {
  const s = readCapStatus([R('refused', 0, 0), R('refused', 0.02, 8800), R('failed', 0, 0), R('read', 0.03)]);
  assert.deepEqual([s.reads_today, s.usd_today], [3, 0.05]);
});

test('a company override replaces the defaults (only the fields it sets)', () => {
  assert.equal(readCapStatus([R('read', 0.03), R('read', 0.03)], { max_reads_per_day: 2, max_usd_per_day: null }).reached, true);
  assert.equal(readCapStatus(Array.from({ length: 41 }, () => R('read', 0.01)), { max_reads_per_day: 100, max_usd_per_day: 20 }).reached, false);
});

test('the Irish day starts at midnight in Dublin, summer and winter', () => {
  assert.equal(irishDayStart(new Date('2026-07-15T10:00:00Z')), '2026-07-14T23:00:00.000Z'); // IST, UTC+1
  assert.equal(irishDayStart(new Date('2026-12-15T10:00:00Z')), '2026-12-15T00:00:00.000Z'); // GMT
  assert.equal(irishDayStart(new Date('2026-07-14T23:30:00Z')), '2026-07-14T23:00:00.000Z'); // 00:30 Irish time
});
