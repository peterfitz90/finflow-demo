// BNK-14 step 1: bank statement CSV parsing. Run: node --test "tests/*.test.mjs"
// The Revolut fee regression also runs against the real 383-row Play Area export when it is present
// locally (BANK_FIXTURES_DIR, default ~/Downloads); client files are never committed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { parseCsvRecords, readAmount, readDateDMY, readDateWise, parseStatement, checkBalances, detectFormat } from '../src/shared/bankStatementParse.js';

test('CSV: quotes, doubled quotes, commas and line breaks inside fields; BOM; blank lines', () => {
  const recs = parseCsvRecords('﻿a,b,c\r\n"x, y","say ""hi""","two\nlines"\r\n\r\n,,\n1,2,3');
  assert.deepEqual(recs.map(r => r.cells), [['a', 'b', 'c'], ['x, y', 'say "hi"', 'two\nlines'], ['', '', ''], ['1', '2', '3']]);
  assert.deepEqual(recs.map(r => r.empty), [false, false, true, false]);
});

test('amounts: printed forms read exactly; anything else is an error, never 0', () => {
  assert.equal(readAmount('1,234.56').value, 1234.56);
  assert.equal(readAmount('-12.3').value, -12.3);
  assert.equal(readAmount('€ 45').value, 45);
  assert.equal(readAmount('').value, null);
  assert.equal(readAmount('', { blank: 0 }).value, 0);
  for (const bad of ['12,34', '1.234,56', 'n/a', '12.345', '--5', '1,23,456']) assert.ok(readAmount(bad).error, bad);
});

test('dates: DD/MM/YYYY only (never MM/DD); impossible dates refused; Wise text months', () => {
  assert.equal(readDateDMY('05/01/2026').value, '2026-01-05');
  assert.ok(readDateDMY('31/02/2026').error);
  assert.ok(readDateDMY('2026-01-05').error);
  assert.equal(readDateWise('05 Jan 2026').value, '2026-01-05');
  assert.equal(readDateWise('5-1-2026').value, '2026-01-05');
});

test('layouts are recognised by their headers; other files are refused', () => {
  assert.equal(detectFormat([' Posted Account', ' Posted Transactions Date', ' Description1', ' Debit Amount', ' Credit Amount', 'Balance']), 'aib');
  assert.equal(detectFormat(['Date started (UTC)', 'Date completed (UTC)', 'ID', 'Amount', 'Fee', 'Balance']), 'revolut');
  assert.equal(detectFormat(['Date', 'Details', 'Debit', 'Credit', 'Balance']), 'boi');
  assert.equal(detectFormat(['Date', 'Transaction_Type', 'Incoming_EUR', 'Outgoing_EUR', 'Balance_EUR', 'Transaction_ID']), 'wise');
  assert.equal(detectFormat(['TransferWise ID', 'Date', 'Amount', 'Currency', 'Description', 'Running Balance']), 'wise');
  const gym = parseStatement('Date,Time,Member,Plan,Method,Amount (EUR),Status\n01/07/2026,09:00,A,Gold,Card,40.00,Paid');
  assert.equal(gym.format, null);
  assert.match(gym.refused, /bank statement/);
});

const REV_HEAD = 'Date started (UTC),Date completed (UTC),ID,Type,State,Description,Payment currency,Amount,Total amount,Fee,Balance';
test('Revolut: a fee becomes its own bank-charges line; payment + fee = Total amount; balances follow', () => {
  // newest first, as Revolut exports
  const csv = [REV_HEAD,
    '03/02/2026 10:00:00,03/02/2026 10:00:00,id-3,CARD_PAYMENT,COMPLETED,Shop,EUR,-10.00,-10.40,-0.40,989.60',
    '02/02/2026 10:00:00,02/02/2026 10:00:00,id-2,TOPUP,COMPLETED,Top up,EUR,500.00,500.00,0.00,1000.00',
    '01/02/2026 10:00:00,01/02/2026 10:00:00,id-1,CARD_PAYMENT,PENDING,Pending,EUR,-1.00,-1.00,0.00,500.00',
    '01/02/2026 09:00:00,01/02/2026 09:00:00,id-0,TOPUP,COMPLETED,Opening,EUR,500.00,500.00,0.00,500.00'].join('\n');
  const p = parseStatement(csv);
  assert.equal(p.format, 'revolut');
  assert.deepEqual(p.rows.map(r => [r.revolut_id, r.amount, r.balance]), [['id-0', 500, 500], ['id-2', 500, 1000], ['id-3', -10, 990], ['id-3-FEE', -0.4, 989.6]]);
  const fee = p.rows.find(r => r.fee_of);
  assert.deepEqual([fee.fee_of, fee.nominal_hint, fee.description], ['id-3', '6500', 'Revolut fee: Shop']);
  assert.deepEqual([p.balance.mode, p.balance.breaks.length], ['row', 0]);
  // a Total amount that is not Amount + Fee is a row error
  const bad = parseStatement(csv.replace('-10.00,-10.40,-0.40', '-10.00,-10.50,-0.40'));
  assert.equal(bad.errors.length, 1);
  assert.match(bad.errors[0].message, /Total amount/);
});

test('unreadable values are visible row errors with their line, never 0 or skipped silently', () => {
  const csv = ['Date,Details,Debit,Credit,Balance', '05/01/2026,Rent,1.200,,', '06/01/2026,Sale,,100.00,600.00', '31/02/2026,Bad date,5.00,,'].join('\n');
  const p = parseStatement(csv);
  assert.equal(p.rows.length, 1);
  assert.deepEqual(p.errors.map(e => e.line), [2, 4]);
  assert.match(p.errors[0].message, /unreadable amount "1.200"/);
  assert.match(p.errors[1].message, /invalid date/);
});

test('balances: per row, per day (one balance printed per day), and breaks reported', () => {
  const R = (id, date, amount, balance) => ({ revolut_id: id, date, amount, balance });
  assert.deepEqual(checkBalances([R('a', '2026-01-01', 0, 100), R('b', '2026-01-02', 20, 120), R('c', '2026-01-02', -5, 115)]).mode, 'row');
  // per day: the day's balance printed on its first row, not its last
  const day = checkBalances([R('a', '2026-01-01', 0, 100), R('b', '2026-01-02', 20, 115), R('c', '2026-01-02', -5, null), R('d', '2026-01-03', 10, 125)]);
  assert.deepEqual([day.mode, day.breaks.length], ['day', 0]);
  // a misread amount breaks the chain
  const broken = checkBalances([R('a', '2026-01-01', 0, 100), R('b', '2026-01-02', 21, 120), R('c', '2026-01-03', 5, 125)]);
  assert.equal(broken.breaks.length, 1);
  assert.deepEqual([broken.breaks[0].date, broken.breaks[0].expected, broken.breaks[0].printed], ['2026-01-02', 121, 120]);
});

test('Bank of Ireland: stable ids across overlapping files (no row position in the id)', () => {
  const head = 'Date,Details,Debit,Credit,Balance';
  const a = parseStatement([head, '05/01/2026,Coffee,3.00,,', '05/01/2026,Coffee,3.00,,94.00', '06/01/2026,Sale,,10.00,104.00'].join('\n'));
  const b = parseStatement([head, '04/01/2026,Opening,,100.00,100.00', '05/01/2026,Coffee,3.00,,', '05/01/2026,Coffee,3.00,,94.00'].join('\n'));
  const idsA = a.rows.map(r => r.revolut_id), idsB = b.rows.map(r => r.revolut_id);
  assert.equal(new Set(idsA).size, 3, 'two identical coffees get two ids');
  assert.deepEqual(idsB.slice(1), idsA.slice(0, 2), 'the same lines get the same ids in the other file');
});

test('Wise: money in and out columns, newest first, ids from the bank', () => {
  const csv = ['Date,Transaction_Type,Merchant_Payee,Location,Card_Ending,Incoming_EUR,Outgoing_EUR,Balance_EUR,Transaction_ID,Reference',
    '02 Feb 2026,Card transaction,Shop,Dublin,1234,,12.50,87.50,T2,',
    '01 Feb 2026,Top up,Me,,,100.00,,100.00,T1,'].join('\n');
  const p = parseStatement(csv);
  assert.deepEqual(p.rows.map(r => [r.revolut_id, r.date, r.amount]), [['WISE-T1', '2026-02-01', 100], ['WISE-T2', '2026-02-02', -12.5]]);
  assert.equal(p.balance.breaks.length, 0);
});

// Standing regression (Peter, 8 Oct 2026): the real Play Area Revolut export, 383 completed rows.
const FIX = `${process.env.BANK_FIXTURES_DIR || `${process.env.USERPROFILE || process.env.HOME}/Downloads`}/account-statement_01-Jan-2025_17-Apr-2026.csv`;
test('regression: the 383-row Revolut export balances only with the fees as their own lines', { skip: !existsSync(FIX) && 'client file not present locally' }, () => {
  const p = parseStatement(readFileSync(FIX, 'utf8'));
  const fees = p.rows.filter(r => r.fee_of);
  assert.equal(p.rows.length - fees.length, 383);
  assert.equal(fees.length, 24);
  assert.equal(Math.round(fees.reduce((t, r) => t + r.amount, 0) * 100) / 100, -25.82);
  assert.deepEqual([p.errors.length, p.balance.mode, p.balance.breaks.length], [0, 'row', 0]);
  // the old importer: Amount only, with the balance as printed (after the fee). It breaks on
  // exactly the 18 days with a fee (24 fee rows), and nowhere else.
  const feeBal = Object.fromEntries(fees.map(f => [f.fee_of, f.balance]));
  const old = p.rows.filter(r => !r.fee_of).map(r => ({ ...r, balance: feeBal[r.revolut_id] ?? r.balance }));
  const breaks = checkBalances(old).breaks;
  assert.deepEqual(new Set(breaks.map(b => b.date)), new Set(fees.map(f => f.date)));
  assert.equal(breaks.length, 18);
});
