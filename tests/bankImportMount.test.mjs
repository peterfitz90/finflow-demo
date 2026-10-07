// The statement import is mounted once (Peter, 7 Oct 2026): two copies (the Bank hub's CSV tab and
// a hidden "bank-import" route) shared one sessionStorage session and could run the same preview's
// categorisation twice. Run: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

test('BankImport is rendered in exactly one place, inside BankHub', () => {
  const mounts = [...app.matchAll(/<BankImport\s/g)];
  assert.equal(mounts.length, 1, 'one <BankImport> element in the app');
  const hub = app.slice(app.indexOf('function BankHub('), app.indexOf('function WelcomeConnectBank('));
  assert.match(hub, /<BankImport\s/, 'and it is the Bank hub\'s CSV tab');
});

test('the main app mounts one Bank hub, and the bank-import deep links open its CSV tab', () => {
  const main = app.slice(app.indexOf('{bankVisited && ('));
  assert.ok(app.includes('{bankVisited && ('), 'the hub is mounted once, after the first visit');
  assert.match(main.slice(0, 600), /tabRequest=\{page === "bank-import" \? "csv" : null\}/);
  assert.doesNotMatch(app, /page === "bank-import" \? "block" : "none"\}\}>\s*<BankImportErrorBoundary>/, 'no separate hidden copy');
  assert.equal([...app.matchAll(/page === "bank"\s+&& <BankHub/g)].length, 0, 'no second, page-conditional hub');
});
