import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useUser, useAuth, useClerk, useOrganizationList } from '@clerk/clerk-react';
import { useCompanyContext } from './shared/useCompanyContext.js';
import { goToFullSite } from './shared/viewMode.js';
import { isPending, can } from './entitlements.js';
import { SignIn } from '@clerk/clerk-react';
import { supabase } from './supabase.js';
import { useFinancialPeriods } from './shared/useFinancialPeriods.js';
import { approveApBill, confirmBankTxn, approveExpense, rejectExpense, updateExpenseNominal, updateExpenseVatCode, fetchExpenseBankNominal } from './shared/approvals.js';
import { orgRoleFor } from './shared/orgRole.js';
import { CHAT_SUGGESTIONS, buildChatContext, buildChatSystemPrompt, chatGreeting, sendChatMessage, chatPeriodLabel } from './shared/chatContext.js';
import { InboxZeroCelebration } from './shared/InboxZeroCelebration.jsx';
import { recScoreCandidate } from './shared/recScore.js';
import { daysFromToday, isLateDeadline, isCurrentDeadline, nextDeadline, applicableDeadlines } from './shared/computeDeadlines.js';
import { monthEnd, todayStr as localToday, thisMonthStr } from './shared/dates.js';
import { useHealthy } from './shared/useHealthy.js';
import { fetchCashBalance } from './shared/bankBalance.js';
import { useChartOfAccounts } from './shared/chartOfAccounts.js';
import { useTransactionRules } from './shared/txRules.js';
import { suggestExpenseAccount, expenseAccountOptions, suggestExpenseVatCode, EXPENSE_VAT_CODES, VAT_SOURCE_LABEL } from './shared/expenseSuggest.js';
import { fetchInstitutions, filterInstitutions, startBankConnect, prepareReconnect, connectionState } from './shared/bankConnect.js';
import { AutomationHero, HealthPulseDot } from './shared/AutomationHero.jsx';
import { getVATPeriods, fetchVat3PeriodData, computeVat3, vat3Blockers, buildFilingFigures, isPeriodLocked, defaultVatPeriod } from './shared/vat3.js';
import { captureError } from './sentry.js';
import {
  INV_VAT_LABELS, calcLineAmounts, calcInvTotals, vatCodeForRate,
  createInvoiceDraft, finaliseInvoice,
  creditedByInvoice, invoiceOutstanding, invoiceStatus, fetchInvoiceDocs, overdueInvoices,
} from './shared/invoice.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const fmt  = n => `€${Math.abs(Number(n)||0).toLocaleString("en-IE",{minimumFractionDigits:0,maximumFractionDigits:0})}`;
const fmtD = d => d ? new Date(d).toLocaleDateString("en-IE",{day:"2-digit",month:"short"}) : "—";


// ─── CSS ──────────────────────────────────────────────────────────────────────
const M_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Inter:wght@300;400;500;600&family=Source+Code+Pro:wght@400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --mb: #0c1210; --ms: #141b18; --mc: #1a2320; --mbd: rgba(255,255,255,0.08);
    --mt: var(--mb); --mtx: #e8edeb; --mm: #8b9591; --md: #5c6662;
    --teal: #10b981; --teal2: #34d399; --gold: #fbbf24; --red: #f87171;
    --green: #10b981; --r: 14px; --rsm: 10px;
  }
  html, body { background: var(--mb); min-height: 100%; -webkit-font-smoothing: antialiased; }
  .m-wrap { max-width: 430px; margin: 0 auto; min-height: 100svh; min-height: 100vh; background: var(--mb); display: flex; flex-direction: column; font-family: 'Inter', system-ui, sans-serif; color: var(--mtx); position: relative; }
  .m-content { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-top: env(safe-area-inset-top, 0px); padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px)); }
  .m-loading { display: flex; align-items: center; justify-content: center; min-height: 100svh; min-height: 100vh; background: var(--mb); color: var(--mm); font-family: 'Source Code Pro', monospace; font-size: 12px; letter-spacing: 0.1em; }

  /* Auth */
  .m-auth { min-height: 100svh; min-height: 100vh; background: var(--mb); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px 20px; gap: 28px; }
  .m-auth-logo-wrap { display: flex; align-items: center; gap: 12px; }
  .m-auth-logo { font-family: 'Inter', system-ui, sans-serif; font-size: 26px; font-weight: 700; color: var(--mtx); letter-spacing: -0.02em; }
  .m-auth-sub { font-size: 11px; color: var(--mm); font-family: 'Source Code Pro', monospace; letter-spacing: 0.12em; text-transform: uppercase; margin-top: -16px; }
  .m-auth-hint { font-size: 13px; color: var(--mm); text-align: center; line-height: 1.6; }
  .m-auth-link { color: var(--teal2); text-decoration: none; font-weight: 600; }

  /* Bottom nav — 5 tabs, tighter padding */
  .m-nav { position: fixed; bottom: 0; left: 50%; transform: translateX(-50%); width: 100%; max-width: 430px; background: var(--ms); border-top: 1px solid var(--mbd); display: flex; padding-bottom: env(safe-area-inset-bottom, 0px); z-index: 100; box-shadow: 0 -4px 20px rgba(0,0,0,0.4); }
  .m-nav-btn { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 9px 2px; border: none; background: none; cursor: pointer; color: var(--md); transition: color 0.14s; min-height: 54px; }
  .m-nav-btn.active { color: var(--teal2); }
  .m-nav-btn.active .m-nav-icon { filter: drop-shadow(0 0 8px rgba(16,185,129,0.5)); }
  .m-nav-icon { font-size: 18px; line-height: 1; }
  .m-nav-label { font-size: 9px; font-family: 'Source Code Pro', monospace; letter-spacing: 0.04em; }

  /* Page header */
  .m-page-hdr { padding: 20px 18px 12px; }
  .m-topbar { position: sticky; top: 0; z-index: 30; display: flex; align-items: center; gap: 8px; padding: calc(env(safe-area-inset-top, 0px) + 8px) 12px 8px; background: var(--mb); border-bottom: 1px solid var(--mbd); }
  .m-co-btn { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; background: none; border: none; color: var(--mtx); font: 600 14px 'Inter', system-ui, sans-serif; text-align: left; padding: 6px 4px; cursor: pointer; }
  .m-co-btn:disabled { cursor: default; }
  .m-co-btn-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .m-co-btn-caret { font-size: 10px; color: var(--mm); }
  .m-menu-btn { width: 40px; height: 40px; border-radius: 10px; background: var(--mc); border: 1px solid var(--mbd); color: var(--mtx); font-size: 18px; cursor: pointer; }
  .m-sheet-scrim { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 40; }
  .m-sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 50; max-width: 430px; margin: 0 auto; background: var(--ms); border-top: 1px solid var(--mbd); border-radius: 16px 16px 0 0; padding: 14px 14px calc(14px + env(safe-area-inset-bottom, 0px)); }
  .m-sheet-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--mm); font-family: 'Source Code Pro', monospace; margin: 2px 4px 10px; }
  .m-sheet-list { max-height: 55vh; overflow-y: auto; }
  .m-sheet-item { display: block; width: 100%; text-align: left; background: none; border: none; color: var(--mtx); font: 500 15px 'Inter', system-ui, sans-serif; padding: 13px 8px; border-radius: 10px; cursor: pointer; }
  .m-sheet-item.active { color: var(--teal2); }
  .m-sheet-item:active { background: var(--mc); }
  .m-banner { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 10px 12px 0; padding: 10px 12px; border-radius: 10px; font-size: 13px; }
  .m-banner.ok { background: rgba(16,185,129,0.12); color: var(--teal2); border: 1px solid rgba(16,185,129,0.3); }
  .m-banner.err { background: rgba(248,113,113,0.12); color: var(--red); border: 1px solid rgba(248,113,113,0.3); }
  .m-banner button { background: none; border: none; color: inherit; font-size: 14px; cursor: pointer; }
  .m-notice { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; text-align: center; padding: 40px 28px; }
  .m-notice-title { font-size: 17px; font-weight: 600; color: var(--mtx); }
  .m-notice-body { font-size: 13px; color: var(--mm); line-height: 1.6; max-width: 320px; }
  .m-link-btn { background: none; border: none; color: var(--teal2); font: 600 14px 'Inter', system-ui, sans-serif; cursor: pointer; padding: 8px; }
  .m-company-name { font-family: 'Playfair Display', serif; font-size: 22px; font-weight: 700; color: var(--mtx); letter-spacing: -0.01em; }
  .m-date-str { font-size: 11px; color: var(--mm); font-family: 'Source Code Pro', monospace; margin-top: 3px; }

  /* Cards */
  .m-card { background: var(--mc); border: 1px solid var(--mbd); border-radius: var(--r); padding: 18px; margin: 0 16px 12px; }
  .m-card-hdr { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .m-card-btn { font: inherit; color: inherit; text-align: left; cursor: pointer; }
  button.m-card { display: block; width: calc(100% - 32px); }
  .m-card-title { font-size: 11px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.1em; color: var(--mm); }

  /* Cash card */
  .m-cash-label { font-size: 11px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.1em; color: var(--mm); margin-bottom: 8px; }
  .m-cash-val { font-family: 'Playfair Display', serif; font-size: 40px; font-weight: 700; line-height: 1; letter-spacing: -0.02em; }
  .m-cash-trend { font-size: 12px; font-family: 'Source Code Pro', monospace; margin-top: 6px; }

  /* Pill stats */
  .m-pills { display: flex; gap: 10px; padding: 0 16px 12px; }
  .m-pill { background: var(--mc); border: 1px solid var(--mbd); border-radius: var(--r); padding: 12px 14px; flex: 1; min-width: 0; }
  .m-pill-val { font-family: 'Playfair Display', serif; font-size: 24px; font-weight: 700; line-height: 1; }
  .m-pill-lbl { font-size: 9px; color: var(--mm); font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; line-height: 1.3; }

  /* Quick action row */
  .m-quick-row { display: flex; gap: 10px; padding: 0 16px 12px; }
  .m-quick-btn { flex: 1; background: var(--mc); border: 1px solid var(--mbd); border-radius: var(--r); padding: 14px 8px 12px; display: flex; flex-direction: column; align-items: center; gap: 6px; cursor: pointer; min-height: 76px; transition: background 0.14s; }
  .m-quick-btn:active { background: rgba(16,185,129,0.12); border-color: var(--teal); }
  .m-quick-btn-icon { font-size: 22px; line-height: 1; }
  .m-quick-btn-lbl { font-size: 11px; font-weight: 600; text-align: center; color: var(--mtx); font-family: 'Source Code Pro', monospace; letter-spacing: 0.03em; }

  /* Transaction rows */
  .m-txn { display: flex; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--mbd); gap: 10px; }
  .m-txn:last-child { border-bottom: none; }
  .m-txn-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .m-txn-info { flex: 1; min-width: 0; }
  .m-txn-desc { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .m-txn-date { font-size: 10px; color: var(--mm); font-family: 'Source Code Pro', monospace; margin-top: 2px; }
  .m-txn-amt { font-family: 'Source Code Pro', monospace; font-size: 13px; font-weight: 600; flex-shrink: 0; }

  /* Refresh */
  .m-ptr { text-align: center; padding: 10px; font-size: 11px; color: var(--teal2); font-family: 'Source Code Pro', monospace; letter-spacing: 0.08em; }

  /* Section title */
  .m-sec-title { font-family: 'Playfair Display', serif; font-size: 17px; font-weight: 600; padding: 4px 18px 10px; }
  .m-empty { padding: 24px 18px; font-size: 13px; color: var(--mm); text-align: center; }

  /* Deadline rows */
  .m-dl { display: flex; align-items: center; padding: 13px 0; border-bottom: 1px solid var(--mbd); gap: 10px; }
  .m-dl:last-child { border-bottom: none; }
  .m-dl-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
  .m-dl-type { font-size: 11px; font-family: 'Source Code Pro', monospace; font-weight: 700; color: var(--teal2); width: 44px; flex-shrink: 0; }
  .m-dl-body { flex: 1; min-width: 0; }
  .m-dl-desc { font-size: 13px; }
  .m-dl-date { font-size: 10px; color: var(--mm); font-family: 'Source Code Pro', monospace; margin-top: 2px; }
  .m-dl-days { font-family: 'Playfair Display', serif; font-size: 20px; font-weight: 700; flex-shrink: 0; }

  /* Receipt upload */
  .m-upload-zone { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; margin: 0 16px 14px; height: 150px; border: 2px dashed var(--teal); border-radius: var(--r); background: rgba(16,185,129,0.05); cursor: pointer; transition: background 0.15s; }
  .m-upload-zone:active { background: rgba(16,185,129,0.12); }
  .m-upload-icon { font-size: 40px; line-height: 1; }
  .m-upload-label { font-size: 15px; font-weight: 600; color: var(--teal2); }
  .m-upload-sub { font-size: 11px; color: var(--mm); }

  .m-receipt-row { display: flex; gap: 14px; margin: 0 16px 14px; }
  .m-receipt-img { width: 80px; height: 104px; object-fit: cover; border-radius: var(--rsm); border: 1px solid var(--mbd); flex-shrink: 0; background: var(--mc); }
  .m-receipt-fields { flex: 1; display: flex; flex-direction: column; gap: 8px; }
  .m-extracting { font-size: 11px; color: var(--teal2); font-family: 'Source Code Pro', monospace; text-align: center; padding: 8px; }

  /* Form */
  .m-form { padding: 0 16px 8px; }
  .m-fgroup { margin-bottom: 12px; }
  .m-flabel { display: block; font-size: 10px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.08em; color: var(--mm); margin-bottom: 5px; }
  .m-finput { width: 100%; background: var(--ms); border: 1px solid var(--mbd); border-radius: var(--rsm); padding: 11px 13px; font-size: 14px; font-family: 'Inter', system-ui, sans-serif; color: var(--mtx); outline: none; -webkit-appearance: none; }
  .m-finput:focus { border-color: var(--teal); }
  .m-fselect { width: 100%; background: var(--ms); border: 1px solid var(--mbd); border-radius: var(--rsm); padding: 11px 13px; font-size: 14px; color: var(--mtx); outline: none; -webkit-appearance: none; }
  .m-fhint { font-size: 10px; color: var(--teal2); margin-top: 4px; font-family: 'Source Code Pro', monospace; }
  .m-seg { display: flex; gap: 6px; padding: 0 16px 10px; }
  .m-seg button { flex: 1; padding: 8px; border-radius: var(--rsm); border: 1px solid var(--mbd); background: var(--mc); color: var(--mm); font: 600 12px 'Inter', system-ui, sans-serif; cursor: pointer; }
  .m-seg button.active { color: var(--teal2); border-color: var(--teal); background: rgba(16,185,129,0.08); }
  .m-bank-logo { width: 32px; height: 32px; border-radius: 8px; background: var(--mc); border: 1px solid var(--mbd); display: flex; align-items: center; justify-content: center; font-size: 11px; color: var(--mm); overflow: hidden; flex-shrink: 0; }
  .m-bank-logo img { width: 28px; height: 28px; object-fit: contain; }
  .m-vat-due { font-size: 11px; color: var(--mm); font-family: 'Source Code Pro', monospace; margin: 8px 0 12px; }
  .m-vat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .m-vat-box { background: var(--ms); border: 1px solid var(--mbd); border-radius: var(--rsm); padding: 10px 12px; }
  .m-vat-lbl { font-size: 10px; font-weight: 700; color: var(--teal2); font-family: 'Source Code Pro', monospace; }
  .m-vat-val { font-family: 'Playfair Display', serif; font-size: 20px; font-weight: 700; margin-top: 2px; }
  .m-vat-sub { font-size: 10px; color: var(--mm); font-family: 'Source Code Pro', monospace; }
  .m-vat-notes { display: flex; flex-direction: column; gap: 4px; margin-top: 12px; font-size: 12px; line-height: 1.4; }
  .m-vat-ok { margin-top: 12px; padding: 10px 12px; border-radius: var(--rsm); background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.25); color: var(--teal2); font-size: 12px; }
  .m-vat-confirm { margin-top: 12px; padding: 12px; border-radius: var(--rsm); border: 1px solid var(--teal); background: rgba(16,185,129,0.06); font-size: 13px; }
  .m-appr-edit { display: flex; gap: 8px; margin-bottom: 12px; }
  .m-appr-edit .m-fselect { flex: 1; min-width: 0; padding: 9px 10px; font-size: 12px; }
  .m-appr-vat { flex: 0 0 92px !important; }
  .m-appr-vat-fixed { display: flex; align-items: center; justify-content: center; border: 1px dashed var(--mbd); border-radius: var(--rsm); font: 600 12px 'Source Code Pro', monospace; color: var(--mm); }
  .m-ai-btn { color: var(--teal2); font-size: 16px; }
  .m-chat { position: fixed; inset: 0; z-index: 60; max-width: 430px; margin: 0 auto; background: var(--mb); display: flex; flex-direction: column; padding: env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px); }
  .m-chat-hdr { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--mbd); }
  .m-chat-av { width: 34px; height: 34px; border-radius: 10px; background: rgba(16,185,129,0.12); color: var(--teal2); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
  .m-chat-ttl { font-weight: 600; font-size: 14px; }
  .m-chat-st { font-size: 11px; color: var(--mm); font-family: 'Source Code Pro', monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .m-chat-msgs { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 14px 12px; display: flex; flex-direction: column; gap: 8px; }
  .m-chat-msg { max-width: 85%; padding: 10px 12px; border-radius: 14px; font-size: 14px; line-height: 1.45; white-space: pre-wrap; word-wrap: break-word; }
  .m-chat-msg.a { align-self: flex-start; background: var(--mc); border: 1px solid var(--mbd); border-bottom-left-radius: 4px; }
  .m-chat-msg.u { align-self: flex-end; background: var(--teal); color: white; border-bottom-right-radius: 4px; }
  .m-chat-dim { color: var(--mm); }
  .m-chat-sugg { display: flex; gap: 6px; overflow-x: auto; padding: 0 12px 8px; }
  .m-chat-sugg button { flex-shrink: 0; background: var(--mc); border: 1px solid var(--mbd); color: var(--mtx); border-radius: 16px; padding: 7px 11px; font: 500 12px 'Inter', system-ui, sans-serif; cursor: pointer; }
  .m-chat-inp { display: flex; gap: 8px; padding: 8px 12px 12px; border-top: 1px solid var(--mbd); }
  .m-chat-inp .m-finput { flex: 1; }
  .m-chat-send { width: 44px; border-radius: var(--rsm); border: none; background: var(--teal); color: white; font-size: 18px; cursor: pointer; }
  .m-chat-send:disabled { opacity: 0.4; }
  .m-frow { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }

  /* Buttons */
  .m-btn { width: 100%; padding: 15px; border-radius: var(--rsm); font-size: 15px; font-weight: 600; font-family: 'Inter', system-ui, sans-serif; border: none; cursor: pointer; transition: opacity 0.15s; min-height: 52px; }
  .m-btn-p { background: var(--teal); color: white; }
  .m-btn-p:disabled { opacity: 0.45; }
  .m-btn-s { background: var(--mc); color: var(--mm); border: 1px solid var(--mbd); margin-top: 10px; }
  .m-btn-sm { width: auto; padding: 8px 16px; font-size: 12px; min-height: 36px; border-radius: var(--rsm); border: none; cursor: pointer; font-family: 'Inter', system-ui, sans-serif; font-weight: 600; }

  /* Pill badge */
  .m-badge { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 20px; font-size: 10px; font-weight: 600; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.04em; }

  /* Receipt list row */
  .m-rcp { display: flex; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--mbd); gap: 10px; }
  .m-rcp:last-child { border-bottom: none; }
  .m-rcp-icon { width: 36px; height: 36px; border-radius: var(--rsm); background: var(--ms); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; border: 1px solid var(--mbd); }
  .m-rcp-info { flex: 1; min-width: 0; }
  .m-rcp-supplier { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .m-rcp-meta { font-size: 10px; color: var(--mm); font-family: 'Source Code Pro', monospace; margin-top: 2px; }
  .m-rcp-amt { font-family: 'Source Code Pro', monospace; font-size: 13px; font-weight: 600; flex-shrink: 0; }

  /* Overdue invoice row */
  .m-inv { display: flex; align-items: center; padding: 11px 0; border-bottom: 1px solid var(--mbd); gap: 10px; }
  .m-inv:last-child { border-bottom: none; }
  .m-inv-info { flex: 1; min-width: 0; }
  .m-inv-client { font-size: 13px; font-weight: 500; }
  .m-inv-meta { font-size: 10px; color: var(--mm); font-family: 'Source Code Pro', monospace; margin-top: 2px; }

  /* Stub tabs */
  .m-stub { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 60px 28px; min-height: 55vh; text-align: center; }
  .m-stub-icon { font-size: 48px; line-height: 1; opacity: 0.7; }
  .m-stub-title { font-family: 'Playfair Display', serif; font-size: 22px; font-weight: 600; }
  .m-stub-sub { font-size: 13px; color: var(--mm); line-height: 1.65; max-width: 280px; }

  /* Colours */
  .c-red   { color: var(--red); }
  .c-gold  { color: var(--gold); }
  .c-green { color: var(--green); }
  .c-teal  { color: var(--teal2); }
  .c-dim   { color: var(--mm); }

  /* ── QuickInvoice tab ───────────────────────────────────────────── */
  .qi-line-card { margin: 0 16px 8px; background: var(--mc); border: 1px solid var(--mbd); border-radius: var(--r); padding: 12px 14px; }
  .qi-line-del { background: none; border: none; color: var(--md); font-size: 18px; cursor: pointer; padding: 2px 6px; line-height: 1; flex-shrink: 0; }
  .qi-line-del:active { color: var(--red); }
  .qi-line-gross { font-family: 'Source Code Pro', monospace; font-size: 13px; font-weight: 600; color: var(--teal2); white-space: nowrap; padding-left: 8px; flex-shrink: 0; }
  .qi-add-line { display: block; width: calc(100% - 32px); margin: 0 16px 10px; background: none; border: 1px dashed var(--mbd); border-radius: var(--r); padding: 12px; font-size: 13px; font-weight: 600; color: var(--mm); font-family: 'Inter', system-ui, sans-serif; cursor: pointer; text-align: center; }
  .qi-add-line:active { background: rgba(16,185,129,0.06); border-color: var(--teal); color: var(--teal2); }
  .qi-total-bar { margin: 0 16px 14px; padding: 14px 18px; background: rgba(16,185,129,0.07); border: 1px solid rgba(16,185,129,0.25); border-radius: var(--r); display: flex; justify-content: space-between; align-items: center; }
  .qi-total-lbl { font-size: 11px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.08em; color: var(--mm); }
  .qi-total-sub { font-size: 10px; color: var(--mm); font-family: 'Source Code Pro', monospace; margin-top: 3px; }
  .qi-total-val { font-family: 'Playfair Display', serif; font-size: 30px; font-weight: 700; color: var(--teal2); letter-spacing: -0.01em; }
  .qi-done-card { margin: 0 16px 14px; padding: 24px 20px; background: rgba(52,211,153,0.06); border: 1px solid rgba(52,211,153,0.2); border-radius: var(--r); text-align: center; }
  .qi-done-num { font-family: 'Playfair Display', serif; font-size: 36px; font-weight: 700; color: var(--green); letter-spacing: -0.02em; }
  .qi-done-who { font-size: 14px; color: var(--mtx); font-weight: 500; margin-top: 6px; }
  .qi-done-sub { font-size: 11px; color: var(--mm); font-family: 'Source Code Pro', monospace; margin-top: 4px; letter-spacing: 0.03em; }
  .qi-cust-row { display: flex; gap: 8px; align-items: stretch; }
  .qi-cust-sel { flex: 1; background: var(--ms); border: 1px solid var(--mbd); border-radius: var(--rsm); padding: 11px 13px; font-size: 14px; color: var(--mtx); outline: none; -webkit-appearance: none; min-height: 46px; }
  .qi-cust-sel:focus { border-color: var(--teal); }
  .qi-new-btn { background: var(--mc); border: 1px solid var(--teal); border-radius: var(--rsm); padding: 11px 14px; font-size: 12px; font-weight: 700; color: var(--teal2); cursor: pointer; font-family: 'Inter', system-ui, sans-serif; white-space: nowrap; flex-shrink: 0; min-height: 46px; }
  .qi-err { margin: 0 16px 12px; padding: 12px 14px; background: rgba(248,113,113,0.08); border: 1px solid rgba(248,113,113,0.2); border-radius: 10px; font-size: 12px; color: var(--red); line-height: 1.5; }
  .qi-ok  { margin: 0 16px 10px; padding: 10px 14px; background: rgba(52,211,153,0.08); border: 1px solid rgba(52,211,153,0.2); border-radius: 10px; font-size: 12px; color: var(--green); }
`;

// ─── Auth screen ──────────────────────────────────────────────────────────────
function MobileAuth() {
  return (
    <div className="m-auth">
      <div className="m-auth-logo-wrap">
        <svg width="36" height="36" viewBox="0 0 100 100" fill="none">
          <rect x="22" y="12" width="16" height="76" rx="8" fill="#e8edeb"/>
          <rect x="22" y="72" width="56" height="16" rx="8" fill="#e8edeb"/>
          <rect x="46" y="24" width="13" height="46" rx="6.5" fill="#10b981"/>
          <rect x="46" y="57" width="32" height="13" rx="6.5" fill="#10b981"/>
        </svg>
        <div className="m-auth-logo">Ledgrly</div>
      </div>
      <div className="m-auth-sub">Mobile · Finance OS</div>
      <p className="m-auth-hint">Sign in to access your dashboard, deadlines, and expense capture on the go.</p>
      <SignIn routing="hash" afterSignInUrl="/mobile" afterSignUpUrl="/mobile" appearance={{ variables: { colorBackground: '#141b18', colorText: '#e8edeb', colorInputBackground: '#1a2320', colorInputText: '#e8edeb', colorPrimary: '#10b981' } }} />
      <button type="button" className="m-auth-link m-link-btn" onClick={goToFullSite}>← View full site</button>
    </div>
  );
}

// ─── Bottom nav ───────────────────────────────────────────────────────────────
function BottomNav({ tab, setTab }) {
  const TABS = [
    { id: 'home',       icon: '◈',  label: 'Home' },
    { id: 'approvals',  icon: '⊛',  label: 'Approvals' },
    { id: 'cash',       icon: '◎',  label: 'Cash' },
    { id: 'compliance', icon: '⊙',  label: 'Compliance' },
    { id: 'invoice',    icon: '◨',  label: 'Invoices' },
  ];
  return (
    <nav className="m-nav">
      {TABS.map(t => (
        <button key={t.id} className={`m-nav-btn${tab===t.id?' active':''}`} onClick={() => setTab(t.id)}>
          <span className="m-nav-icon">{t.icon}</span>
          <span className="m-nav-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

// ─── Shared figures (UX-03 Stage 1) ───────────────────────────────────────────
// Same sources and rules as the full app, so a number on the phone matches the one on the
// desktop: cash = ledger balance of the active bank accounts (Overview / Practice Dashboard),
// overdue = the Invoices page's rule, deadlines = the Practice Dashboard's applicability rule.

// Invoices (fetchInvoiceDocs / overdueInvoices), deadlines (daysFromToday, isLateDeadline,
// isCurrentDeadline, nextDeadline, applicableDeadlines) and the VAT period default come from the
// shared modules — the same rules the desktop and the AI chat context use.
const fetchOverdueInvoices = async companyId => overdueInvoices(await fetchInvoiceDocs(supabase, companyId));

// The company's deadlines that actually apply — VAT3 only if VAT-registered and that period
// isn't filed, P30/P35 only if PAYE-registered, no CT1 for a sole trader (deadlineApplies).
// null while the filed VAT periods load. Filed periods come from the get_locked_periods RPC, not
// vat_returns: that table's SELECT is accountant-only, so for a business_owner a direct query is
// silently empty and every filed period would show as late.
function useApplicableDeadlines(company) {
  const companyId = company?.id;
  const fyPeriods = useFinancialPeriods(companyId); // recorded periods: CT1 follows their ends
  const [locked, setLocked] = useState(null); // [{ period_start, period_end }]
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    supabase.rpc('get_locked_periods', { p_company_id: companyId })
      .then(({ data }) => { if (!cancelled) setLocked(data || []); });
    return () => { cancelled = true; };
  }, [companyId]);
  return useMemo(() => {
    if (!company || !locked) return null;
    return applicableDeadlines(company, locked, fyPeriods);
  }, [company, locked, fyPeriods]);
}

const isLate = isLateDeadline;
const isCurrent = isCurrentDeadline;

const dueLabel = dl => { const n = daysFromToday(dl.due); return n < 0 ? `${-n}d late` : n === 0 ? 'Today' : `${n}d`; };
const dueColour = dl => { const n = daysFromToday(dl.due); return n <= 7 ? 'var(--red)' : n <= 14 ? 'var(--gold)' : 'var(--teal2)'; };

// Cash to the cent, with its sign (fmt drops both).
const fmtCash = n => `${Number(n) < 0 ? '−' : ''}€${Math.abs(Number(n) || 0).toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ─── Home tab ─────────────────────────────────────────────────────────────────
function HomeTab({ companyId, company, setTab }) {
  const [cash, setCash]               = useState(null);   // number | null (unavailable)
  const [overdueInvs, setOverdueInvs] = useState([]);
  const [pending, setPending]         = useState(0);
  const [txns, setTxns]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const deadlines = useApplicableDeadlines(company);

  const load = useCallback(async () => {
    if (!companyId) return;
    const today = localToday();
    const [bal, overdue, exp, recent] = await Promise.all([
      fetchCashBalance(companyId, today).catch(() => null),
      fetchOverdueInvoices(companyId).catch(() => []),
      supabase.from('expenses').select('id').eq('company_id', companyId).eq('status','submitted'),
      supabase.from('bank_transactions').select('date,description,amount').eq('company_id', companyId).order('date',{ascending:false}).limit(4),
    ]);
    setCash(bal);
    setOverdueInvs(overdue);
    if (exp.data)    setPending(exp.data.length);
    if (recent.data) setTxns(recent.data);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const { healthy, loading: healthLoading } = useHealthy(companyId);

  const dateStr = new Date().toLocaleDateString('en-IE', { weekday:'long', day:'numeric', month:'long' });
  const nextDl = deadlines && nextDeadline(deadlines);
  const overdueTotal = overdueInvs.reduce((s, r) => s + r.owed, 0);

  return (
    <div>
      <div className="m-page-hdr">
        <div className="m-company-name">{company?.name || 'My Company'}</div>
        <div className="m-date-str">{dateStr}</div>
      </div>

      {/* Cash — the ledger balance Overview shows */}
      <button type="button" className="m-card m-card-btn" onClick={() => setTab('cash')}>
        <div className="m-cash-label">Cash in bank</div>
        {loading ? <div style={{ height:40, background:'var(--ms)', borderRadius:8, opacity:0.4 }} /> : (
          <div className="m-cash-val" style={{ color: cash === null ? 'var(--mm)' : cash >= 0 ? 'var(--mtx)' : 'var(--red)' }}>
            {cash === null ? '—' : fmtCash(cash)}
          </div>
        )}
      </button>

      {/* Stat pills */}
      <div className="m-pills">
        <div className="m-pill">
          <div className={`m-pill-val ${overdueInvs.length > 0 ? 'c-red' : 'c-green'}`}>{loading ? '…' : overdueInvs.length}</div>
          <div className="m-pill-lbl">{!loading && overdueInvs.length > 0 ? `Overdue · ${fmt(overdueTotal)}` : 'Overdue invoices'}</div>
        </div>
        <button type="button" className="m-pill m-card-btn" onClick={() => setTab('compliance')}>
          <div className="m-pill-val" style={{ color: nextDl ? dueColour(nextDl) : 'var(--mm)' }}>
            {deadlines === null ? '…' : nextDl ? dueLabel(nextDl) : '—'}
          </div>
          <div className="m-pill-lbl">{nextDl ? `Next · ${nextDl.type}` : 'Next deadline'}</div>
        </button>
        <div className="m-pill">
          <div className={`m-pill-val ${pending > 0 ? 'c-gold' : 'c-dim'}`}>{loading ? '…' : pending}</div>
          <div className="m-pill-lbl">Expenses pending</div>
        </div>
      </div>

      {/* Health indicator */}
      {!healthLoading && healthy !== null && (
        <div style={{ display:'flex', alignItems:'center', gap:6, padding:'2px 18px 10px', fontSize:11, fontFamily:'Source Code Pro,monospace', color:'var(--mm)', letterSpacing:'0.04em' }}>
          <HealthPulseDot healthy={healthy} size={8} />
          <span>{healthy ? 'Books healthy' : 'Needs attention'}</span>
        </div>
      )}

      {/* 30-day automation hero */}
      <AutomationHero companyId={companyId} theme="dark" />

      {/* Quick actions */}
      <div className="m-sec-title">Quick Actions</div>
      <div className="m-quick-row">
        <button className="m-quick-btn" onClick={() => setTab('approvals')}>
          <span className="m-quick-btn-icon">📷</span>
          <span className="m-quick-btn-lbl">Scan Receipt</span>
        </button>
        <button className="m-quick-btn" onClick={() => setTab('cash')}>
          <span className="m-quick-btn-icon">◎</span>
          <span className="m-quick-btn-lbl">Cash Position</span>
        </button>
        <button className="m-quick-btn" onClick={() => setTab('compliance')}>
          <span className="m-quick-btn-icon">⊙</span>
          <span className="m-quick-btn-lbl">Deadlines</span>
        </button>
      </div>

      {/* Overdue invoices */}
      {!loading && overdueInvs.length > 0 && (
        <>
          <div className="m-sec-title">Overdue Invoices</div>
          <div className="m-card">
            {overdueInvs.slice(0, 3).map(inv => (
              <div key={inv.id} className="m-inv">
                <div className="m-inv-info">
                  <div className="m-inv-client">{inv.client}</div>
                  <div className="m-inv-meta">{inv.invoice_ref} · Due {fmtD(inv.due)}</div>
                </div>
                <span style={{ fontFamily:'Source Code Pro,monospace', fontSize:13, fontWeight:600, color:'var(--red)' }}>{fmt(inv.owed)}</span>
              </div>
            ))}
            {overdueInvs.length > 3 && <div className="m-inv-meta" style={{ paddingTop: 10 }}>+ {overdueInvs.length - 3} more</div>}
          </div>
        </>
      )}

      {/* Recent transactions */}
      <div className="m-sec-title">Recent Transactions</div>
      <div className="m-card">
        {loading ? <div className="m-empty">Loading…</div> :
         txns.length === 0 ? <div className="m-empty">No transactions yet</div> :
         txns.map((t, i) => {
           const pos = Number(t.amount) >= 0;
           return (
             <div key={i} className="m-txn">
               <div className="m-txn-dot" style={{ background: pos ? 'var(--green)' : 'var(--red)' }} />
               <div className="m-txn-info">
                 <div className="m-txn-desc">{t.description || '—'}</div>
                 <div className="m-txn-date">{fmtD(t.date)}</div>
               </div>
               <div className={`m-txn-amt ${pos ? 'c-green' : 'c-red'}`}>
                 {pos ? '+' : '-'}{fmt(Math.abs(Number(t.amount)))}
               </div>
             </div>
           );
         })}
      </div>
    </div>
  );
}

// ─── Cash tab ─────────────────────────────────────────────────────────────────
function CashTab({ companyId, company }) {
  const [cash, setCash]         = useState(null);
  const [cashLm, setCashLm]     = useState(null);   // balance at the end of last month
  const [txns, setTxns]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef(null);
  const touchY    = useRef(0);

  const load = useCallback(async () => {
    if (!companyId) return;
    const now   = new Date();
    const lmEnd = monthEnd(now.getFullYear(), now.getMonth()); // last day of the previous month (1-based m = getMonth())
    // Ledger balances (the Overview figure), not a sum of raw bank-feed rows — the feed misses
    // opening balances, manual journals and anything posted outside the feed.
    const [bal, balLm, recent] = await Promise.all([
      fetchCashBalance(companyId, localToday()).catch(() => null),
      fetchCashBalance(companyId, lmEnd).catch(() => null),
      supabase.from('bank_transactions').select('date,description,amount').eq('company_id', companyId).order('date',{ascending:false}).limit(20),
    ]);
    setCash(bal);
    setCashLm(balLm);
    if (recent.data) setTxns(recent.data);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const handleTouchStart = e => { touchY.current = e.touches[0].clientY; };
  const handleTouchEnd   = async e => {
    const dy = e.changedTouches[0].clientY - touchY.current;
    if (dy > 65 && (scrollRef.current?.scrollTop || 0) === 0) {
      setRefreshing(true); await load(); setRefreshing(false);
    }
  };

  const cashColour = cash === null ? 'var(--mtx)' : cash >= 0 ? 'var(--green)' : 'var(--red)';
  const change = cash !== null && cashLm !== null ? Math.round((cash - cashLm) * 100) / 100 : null;
  const lmLabel = new Date(new Date().getFullYear(), new Date().getMonth(), 0).toLocaleDateString('en-IE', { day:'numeric', month:'short' });

  return (
    <div ref={scrollRef} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      {refreshing && <div className="m-ptr">↻ Refreshing…</div>}

      <div className="m-page-hdr">
        <div className="m-company-name">Cash</div>
        <div className="m-date-str">Bank position · pull to refresh</div>
      </div>

      <div className="m-card" style={{ borderTop: `3px solid ${cashColour}` }}>
        <div className="m-cash-label">Cash Position</div>
        {loading ? <div style={{ height:48, background:'var(--ms)', borderRadius:8, opacity:0.4 }} /> : (
          <>
            <div className="m-cash-val" style={{ color: cashColour }}>
              {cash === null ? '—' : fmtCash(cash)}
            </div>
            {change !== null && (
              <div className={`m-cash-trend ${change >= 0 ? 'c-green' : 'c-red'}`}>
                {change >= 0 ? '▲' : '▼'} {fmtCash(Math.abs(change))} since {lmLabel}
              </div>
            )}
          </>
        )}
      </div>

      <BankFeeds companyId={companyId} company={company} />

      <div className="m-sec-title">Transactions</div>
      <div className="m-card">
        {loading ? <div className="m-empty">Loading…</div> :
         txns.length === 0 ? <div className="m-empty">No transactions yet</div> :
         txns.map((t, i) => {
           const pos = Number(t.amount) >= 0;
           return (
             <div key={i} className="m-txn">
               <div className="m-txn-dot" style={{ background: pos ? 'var(--green)' : 'var(--red)' }} />
               <div className="m-txn-info">
                 <div className="m-txn-desc">{t.description || '—'}</div>
                 <div className="m-txn-date">{fmtD(t.date)}</div>
               </div>
               <div className={`m-txn-amt ${pos ? 'c-green' : 'c-red'}`}>
                 {pos ? '+' : '-'}{fmt(Math.abs(Number(t.amount)))}
               </div>
             </div>
           );
         })}
      </div>
    </div>
  );
}

// ─── Receipt capture (reusable sub-component) ─────────────────────────────────
function ReceiptCapture({ companyId, user, isBusinessOwner }) {
  const blankForm = () => ({ supplier:'', description:'', receipt_date: localToday(), amount:'', vat_amount:'0', nominal_account:'6600', nominal_name:'Sundry Expenses', category:'Overheads', vat_code:'', vat_rate:null, payment_method:'company_card', notes:'' });
  const [extracting, setExtracting] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);
  const [saveError, setSaveError]   = useState(null);
  const [form, setForm] = useState(blankForm);
  // Category — same as the full app's Expenses form: the company's chart of accounts, a
  // suggestion from the transaction rules (suggestExpenseAccount) that never overrides a
  // category the user picked (nominalTouched), and Sundry when nothing matches.
  const { accounts: coaAccounts } = useChartOfAccounts(companyId);
  const { rules: txRules }        = useTransactionRules(companyId);
  const acctOptions = expenseAccountOptions(coaAccounts);
  const [nominalTouched, setNominalTouched] = useState(false);
  const [suggestedLabel, setSuggestedLabel] = useState(null);
  // VAT code — follows the suggestion (rule → account default → receipt rate) until an accountant
  // picks one; a business_owner sees the suggestion, read-only (the database enforces the same).
  const [vatTouched, setVatTouched] = useState(false);
  const [lastRule, setLastRule]     = useState(null);
  const [vatSuggestion, setVatSuggestion] = useState(null);
  const fileRef = useRef(null);
  const ff = f => e => setForm(p => ({ ...p, [f]: e.target.value }));

  const setNominal = code => {
    const acct = acctOptions.find(a => a.code === code);
    if (!acct) return;
    setForm(p => ({ ...p, nominal_account: code, nominal_name: acct.name, category: acct.category || acct.type || '' }));
    setNominalTouched(true); setSuggestedLabel(null);
  };

  const applySuggestion = (supplier, description, amount) => {
    if (nominalTouched) return;
    const acct = suggestExpenseAccount(supplier, description, amount, txRules, coaAccounts);
    if (!acct) return;
    setForm(p => ({ ...p, nominal_account: acct.code, nominal_name: acct.name, category: acct.category }));
    setSuggestedLabel(acct.name);
    setLastRule({ nominal: acct.code, vatCode: acct.ruleVatCode });
  };

  useEffect(() => {
    const sug = suggestExpenseVatCode({
      ruleVatCode: lastRule?.nominal === form.nominal_account ? lastRule.vatCode : null,
      nominal: form.nominal_account, coaAccounts, vatAmount: form.vat_amount, total: form.amount, vatRate: form.vat_rate,
    });
    setVatSuggestion(sug);
    if (!vatTouched) setForm(p => (p.vat_code === (sug?.code || '') ? p : { ...p, vat_code: sug?.code || '' }));
  }, [form.nominal_account, form.vat_amount, form.amount, form.vat_rate, form.vat_code, lastRule, coaAccounts, vatTouched]); // vat_code: re-suggest after the form is reset

  const reset = () => {
    setReceiptUrl(null); setForm(blankForm()); setNominalTouched(false); setSuggestedLabel(null); setSaveError(null);
    setVatTouched(false); setLastRule(null);
  };

  const handleFile = async file => {
    if (!file) return;
    setReceiptUrl(URL.createObjectURL(file));
    setSubmitted(false);
    if (!file.type.startsWith('image/')) return;
    setExtracting(true);
    try {
      const b64 = await new Promise((res, rej) => {
        const rd = new FileReader();
        rd.onload = e => res(e.target.result.split(',')[1]);
        rd.onerror = rej;
        rd.readAsDataURL(file);
      });
      const resp = await fetch('/api/extract-receipt', {
        method:'POST', headers:{'Content-Type':'application/json', 'Authorization': `Bearer ${await window.Clerk?.session?.getToken()}`},
        body: JSON.stringify({ base64: b64, mediaType: file.type, company_id: companyId }),
      });
      const d = await resp.json();
      setForm(p => ({
        ...p,
        supplier:     d.supplier     || p.supplier,
        description:  d.description  || p.description,
        receipt_date: d.date         || p.receipt_date,
        amount:       d.total_amount ? String(d.total_amount) : p.amount,
        vat_amount:   d.vat_amount   ? String(d.vat_amount)   : p.vat_amount,
        vat_rate:     d.vat_rate ?? p.vat_rate,
      }));
      applySuggestion(d.supplier || form.supplier, d.description || form.description, d.total_amount || form.amount);
    } catch (e) { console.error('[mobile receipts]', e); }
    setExtracting(false);
  };

  const submit = async () => {
    if (!form.supplier || !form.amount || !companyId) return;
    setSubmitting(true); setSaveError(null);
    const byName = user?.firstName ? `${user.firstName} ${user.lastName??''}`.trim() : user?.emailAddresses?.[0]?.emailAddress || 'Unknown';
    const { error } = await supabase.from('expenses').insert({
      company_id: companyId, submitted_by_clerk_id: user?.id || '',
      submitted_by_name: byName, receipt_date: form.receipt_date,
      supplier: form.supplier, description: form.description, amount: parseFloat(form.amount)||0,
      vat_amount: parseFloat(form.vat_amount)||0,
      net_amount: (parseFloat(form.amount)||0) - (parseFloat(form.vat_amount)||0),
      nominal_account: form.nominal_account, nominal_name: form.nominal_name, category: form.category,
      vat_code: form.vat_code || null,
      payment_method: form.payment_method, status: 'submitted', notes: form.notes,
    });
    setSubmitting(false);
    if (error) { setSaveError(`Couldn't submit: ${error.message}`); return; }
    reset();
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div style={{ margin:'0 16px 12px', padding:'12px 16px', background:'rgba(52,211,153,0.1)', border:'1px solid rgba(52,211,153,0.25)', borderRadius:'var(--r)', fontSize:13, color:'var(--green)' }}>
        ✓ Expense submitted for approval
        <button style={{ marginLeft:12, background:'none', border:'none', color:'var(--teal2)', fontSize:12, cursor:'pointer', fontWeight:600 }}
          onClick={() => setSubmitted(false)}>Scan another →</button>
      </div>
    );
  }

  if (!receiptUrl) {
    return (
      <>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" style={{ display:'none' }}
          onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); }} />
        <div className="m-upload-zone" onClick={() => fileRef.current?.click()}>
          <div className="m-upload-icon">📷</div>
          <div className="m-upload-label">Scan Receipt</div>
          <div className="m-upload-sub">Take a photo or choose from library</div>
        </div>
      </>
    );
  }

  return (
    <>
      {extracting && <div className="m-extracting">AI extracting receipt data…</div>}
      <div className="m-receipt-row">
        <img className="m-receipt-img" src={receiptUrl} alt="Receipt" onError={e => { e.target.style.display='none'; }} />
        <div className="m-receipt-fields">
          <div className="m-fgroup">
            <label className="m-flabel">Supplier</label>
            <input className="m-finput" value={form.supplier} onChange={ff('supplier')}
              onBlur={() => applySuggestion(form.supplier, form.description, form.amount)} placeholder="Supplier name" />
          </div>
          <div className="m-fgroup">
            <label className="m-flabel">Date</label>
            <input className="m-finput" type="date" value={form.receipt_date} onChange={ff('receipt_date')} />
          </div>
        </div>
      </div>
      <div className="m-form">
        <div className="m-fgroup">
          <label className="m-flabel">Description</label>
          <input className="m-finput" value={form.description} onChange={ff('description')}
            onBlur={() => applySuggestion(form.supplier, form.description, form.amount)} placeholder="What was purchased" />
        </div>
        <div className="m-frow">
          <div className="m-fgroup">
            <label className="m-flabel">Total (€)</label>
            <input className="m-finput" type="number" step="0.01" value={form.amount} onChange={ff('amount')} placeholder="0.00" />
          </div>
          <div className="m-fgroup">
            <label className="m-flabel">VAT (€)</label>
            <input className="m-finput" type="number" step="0.01" value={form.vat_amount} onChange={ff('vat_amount')} placeholder="0.00" />
          </div>
        </div>
        <div className="m-fgroup">
          <label className="m-flabel">Category</label>
          <select className="m-fselect" value={form.nominal_account} onChange={e => setNominal(e.target.value)}>
            {!acctOptions.some(a => a.code === form.nominal_account) && <option value={form.nominal_account}>{form.nominal_account} — {form.nominal_name}</option>}
            {acctOptions.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
          </select>
          {suggestedLabel && <div className="m-fhint">Suggested: {suggestedLabel}</div>}
        </div>
        <div className="m-fgroup">
          <label className="m-flabel">VAT code</label>
          <select className="m-fselect" value={form.vat_code} disabled={isBusinessOwner}
            onChange={e => { setForm(p => ({ ...p, vat_code: e.target.value })); setVatTouched(true); }}>
            <option value="">— none —</option>
            {EXPENSE_VAT_CODES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {isBusinessOwner ? <div className="m-fhint" style={{ color: 'var(--mm)' }}>Set by your accountant{form.vat_code ? ` — suggested ${form.vat_code}` : ''}</div>
            : vatSuggestion && form.vat_code === vatSuggestion.code && <div className="m-fhint">Suggested {VAT_SOURCE_LABEL[vatSuggestion.source]}</div>}
        </div>
        <div className="m-fgroup">
          <label className="m-flabel">Payment Method</label>
          <select className="m-fselect" value={form.payment_method} onChange={ff('payment_method')}>
            <option value="company_card">Company Card</option>
            <option value="personal_card">Personal Card</option>
            <option value="cash">Cash</option>
            <option value="bank_transfer">Bank Transfer</option>
          </select>
        </div>
        <div className="m-fgroup">
          <label className="m-flabel">Notes</label>
          <input className="m-finput" value={form.notes} onChange={ff('notes')} placeholder="Optional notes…" />
        </div>
        {saveError && <div className="qi-err" style={{ margin:'0 0 10px' }}>{saveError}</div>}
        <button className="m-btn m-btn-p" onClick={submit} disabled={!form.supplier || !form.amount || submitting}>
          {submitting ? 'Submitting…' : 'Submit for Approval'}
        </button>
        <button className="m-btn m-btn-s" onClick={reset}>Cancel</button>
      </div>
    </>
  );
}

// ─── Approval card ─────────────────────────────────────────────────────────────
// Bills: the nominal is editable by anyone who can approve; the VAT code only by the accountant —
// the desktop bill form's rule, which approve_ap_bill also enforces server-side (a
// business_owner's VAT code is ignored and the bill's own kept).
const BILL_VAT_CODES = ['STD23', 'RED13', 'RED9', 'ZERO', 'EXEMPT', 'NONE']; // the desktop bill form's list

function ApprovalCard({ item, approving, onApprove, onReview, acctOptions, canEditVat }) {
  const isBill = item._type === 'ap_bill';
  const isIn   = Number(item.amount) >= 0;
  const busy   = approving === item.id;
  const [nominal, setNominal] = useState(item.suggestedNominal);
  const [vatCode, setVatCode] = useState(item.vatCode || 'STD23');

  return (
    <div style={{ margin:'0 16px 10px', background:'var(--mc)', border:'1px solid var(--mbd)', borderRadius:'var(--r)', padding:'14px 16px' }}>
      {/* Header row */}
      <div style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:10 }}>
        <div style={{ width:34, height:34, borderRadius:8, background: isBill ? 'rgba(16,185,129,0.1)' : 'rgba(52,211,153,0.07)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>
          {isBill ? '🧾' : '🏦'}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {item.description}
          </div>
          <div style={{ fontSize:10, color:'var(--mm)', fontFamily:'Source Code Pro,monospace', marginTop:2 }}>
            {item.subtitle}
          </div>
        </div>
        <div style={{ fontSize:14, fontWeight:700, fontFamily:'Source Code Pro,monospace', color: !isBill && !isIn ? 'var(--red)' : 'var(--mtx)', flexShrink:0 }}>
          {!isBill && !isIn ? '-' : ''}{fmt(Math.abs(Number(item.amount)))}
        </div>
      </div>

      {isBill ? (
        <div className="m-appr-edit">
          <select className="m-fselect" value={nominal} onChange={e => setNominal(e.target.value)} aria-label="Nominal account" disabled={!!approving}>
            {!acctOptions.some(a => a.code === nominal) && <option value={nominal}>{nominal}{item.nominalName ? ` — ${item.nominalName}` : ''}</option>}
            {acctOptions.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
          </select>
          {canEditVat ? (
            <select className="m-fselect m-appr-vat" value={vatCode} onChange={e => setVatCode(e.target.value)} aria-label="VAT rate" disabled={!!approving}>
              {!BILL_VAT_CODES.includes(vatCode) && <option value={vatCode}>{vatCode}</option>}
              {BILL_VAT_CODES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : (
            <div className="m-appr-vat m-appr-vat-fixed" title="VAT rate is set by your accountant">{vatCode}</div>
          )}
        </div>
      ) : (
        /* AI suggestion pill */
        <div style={{ background:'var(--ms)', borderRadius:8, padding:'7px 10px', marginBottom:12, display:'flex', flexWrap:'wrap', gap:'4px 8px', fontSize:11, alignItems:'center' }}>
          <span style={{ color:'var(--mm)', fontFamily:'Source Code Pro,monospace' }}>Category</span>
          <span style={{ color:'var(--teal2)', fontWeight:600, fontFamily:'Source Code Pro,monospace' }}>{item.suggestedNominal}</span>
          {item.nominalName && <span style={{ color:'var(--mm)' }}>{item.nominalName}</span>}
          {item.vatCode && item.vatCode !== 'NONE' && (
            <span style={{ color:'var(--mm)', fontFamily:'Source Code Pro,monospace' }}>· {item.vatCode}</span>
          )}
          {item.confidence != null && (
            <span style={{ marginLeft:'auto', fontFamily:'Source Code Pro,monospace', color: item.confidence >= 80 ? 'var(--green)' : 'var(--gold)', fontWeight:600 }}>
              {item.confidence}%
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      <div style={{ display:'flex', gap:10 }}>
        <button onClick={onReview} disabled={!!approving}
          style={{ flex:1, padding:'10px', background:'var(--ms)', border:'1px solid var(--mbd)', borderRadius:'var(--rsm)', fontSize:13, fontWeight:600, color:'var(--mm)', cursor:'pointer', fontFamily:'Inter,system-ui,sans-serif', opacity: approving ? 0.5 : 1 }}>
          Review on web
        </button>
        <button onClick={() => onApprove(isBill ? { nominal, vatCode } : undefined)} disabled={!!approving}
          style={{ flex:2, padding:'10px', background: busy ? 'rgba(16,185,129,0.5)' : 'var(--teal)', border:'none', borderRadius:'var(--rsm)', fontSize:13, fontWeight:600, color:'white', cursor: busy ? 'default' : 'pointer', fontFamily:'Inter,system-ui,sans-serif' }}>
          {busy ? '…' : '✓ Approve'}
        </button>
      </div>
    </div>
  );
}

// ─── Expense card (admins — the Expenses page's isAdmin rule) ───────────────────
// A submitted expense: category editable (persists at once, as on desktop), Approve posts the
// Expenses page's journal (src/shared/approvals.js), Reject marks it rejected.
const PM_LABEL = { company_card: 'Company card', personal_card: 'Personal card', cash: 'Cash', bank_transfer: 'Bank transfer' };

function ExpenseCard({ exp, busy, onCategory, onVatCode, onApprove, onReject, acctOptions, canEditVat }) {
  const [confirmReject, setConfirmReject] = useState(false);
  return (
    <div style={{ margin:'0 16px 10px', background:'var(--mc)', border:'1px solid var(--mbd)', borderRadius:'var(--r)', padding:'14px 16px' }}>
      <div style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:10 }}>
        <div style={{ width:34, height:34, borderRadius:8, background:'rgba(251,191,36,0.1)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>🧾</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{exp.supplier}</div>
          <div style={{ fontSize:10, color:'var(--mm)', fontFamily:'Source Code Pro,monospace', marginTop:2 }}>
            {[fmtD(exp.receipt_date), exp.submitted_by_name, PM_LABEL[exp.payment_method] || exp.payment_method].filter(Boolean).join(' · ')}
          </div>
          {exp.description && <div style={{ fontSize:11, color:'var(--mm)', marginTop:2 }}>{exp.description}</div>}
        </div>
        <div style={{ fontSize:14, fontWeight:700, fontFamily:'Source Code Pro,monospace', flexShrink:0 }}>{fmtCash(exp.amount)}</div>
      </div>
      <div className="m-appr-edit">
        <select className="m-fselect" value={exp.nominal_account} onChange={e => onCategory(exp, e.target.value)} aria-label="Category" disabled={busy}>
          {!acctOptions.some(a => a.code === exp.nominal_account) && <option value={exp.nominal_account}>{exp.nominal_account} — {exp.nominal_name}</option>}
          {acctOptions.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
        </select>
        {canEditVat ? (
          <select className="m-fselect m-appr-vat" value={exp.vat_code || ''} onChange={e => onVatCode(exp, e.target.value)} aria-label="VAT code" disabled={busy}>
            <option value="">no VAT</option>
            {EXPENSE_VAT_CODES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : <div className="m-appr-vat m-appr-vat-fixed" title="VAT code is set by your accountant">{exp.vat_code || 'no VAT'}</div>}
      </div>
      {confirmReject ? (
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <span style={{ flex:1, fontSize:12, color:'var(--mm)' }}>Reject this expense?</span>
          <button className="m-btn-sm" style={{ background:'var(--red)', color:'white' }} disabled={busy} onClick={() => onReject(exp)}>Reject</button>
          <button className="m-btn-sm" style={{ background:'var(--ms)', color:'var(--mm)', border:'1px solid var(--mbd)' }} disabled={busy} onClick={() => setConfirmReject(false)}>Keep</button>
        </div>
      ) : (
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={() => setConfirmReject(true)} disabled={busy}
            style={{ flex:1, padding:'10px', background:'var(--ms)', border:'1px solid var(--mbd)', borderRadius:'var(--rsm)', fontSize:13, fontWeight:600, color:'var(--red)', cursor:'pointer', fontFamily:'Inter,system-ui,sans-serif' }}>
            ✗ Reject
          </button>
          <button onClick={() => onApprove(exp)} disabled={busy}
            style={{ flex:2, padding:'10px', background: busy ? 'rgba(16,185,129,0.5)' : 'var(--teal)', border:'none', borderRadius:'var(--rsm)', fontSize:13, fontWeight:600, color:'white', cursor: busy ? 'default' : 'pointer', fontFamily:'Inter,system-ui,sans-serif' }}>
            {busy ? '…' : '✓ Approve & post'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Approvals tab ────────────────────────────────────────────────────────────
function ApprovalsTab({ companyId, user, isBusinessOwner, isAdmin }) {
  const { accounts: coaAccounts } = useChartOfAccounts(companyId);
  const acctOptions = expenseAccountOptions(coaAccounts);
  const [expenses, setExpenses]       = useState([]);   // submitted expenses (admins only)
  const [bankNominal, setBankNominal] = useState('1000');
  const [expBusy, setExpBusy]         = useState(null);
  const [items, setItems]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [loadErr, setLoadErr]       = useState(null);
  const [approving, setApproving]   = useState(null); // id of item being approved
  const [actionErr, setActionErr]   = useState(null);
  const [justCleared, setJustCleared] = useState(false);

  useEffect(() => { if (items.length > 0) setJustCleared(false); }, [items.length]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setLoadErr(null);
    try {
      // ── 1. AP bills needing review ──────────────────────────────────────────
      const { data: bills, error: bErr } = await supabase
        .from('ap_invoices')
        .select('id, company_id, supplier, invoice_ref, invoice_date, due_date, amount, gross_amount, net_amount, vat_amount, suggested_nominal, nominal_code, vat_code, status')
        .eq('company_id', companyId)
        .eq('status', 'needs_review')
        .order('invoice_date', { ascending: false })
        .limit(30);
      if (bErr) throw bErr;

      // ── 2. Bank transactions needing category confirmation ─────────────────
      // Start from the bank_matches side so we only fetch txns that are already
      // in the categorise queue (matched_type='journal', status='suggested').
      const { data: journalMatches } = await supabase
        .from('bank_matches')
        .select('id, bank_transaction_id, confidence, matched_id')
        .eq('company_id', companyId)
        .eq('status', 'suggested')
        .eq('matched_type', 'journal')
        .order('confidence', { ascending: false })
        .limit(40);

      let txnItems = [];
      if (journalMatches?.length) {
        // Best match per transaction (highest confidence)
        const bestMatch = {};
        for (const m of journalMatches) {
          if (!bestMatch[m.bank_transaction_id] || m.confidence > bestMatch[m.bank_transaction_id].confidence)
            bestMatch[m.bank_transaction_id] = m;
        }
        const btIds = Object.keys(bestMatch);

        // Fetch the bank rows + open AP/AR invoices in parallel
        const [{ data: bts }, { data: openAP }, { data: openAR }] = await Promise.all([
          supabase.from('bank_transactions')
            .select('id, date, description, amount')
            .in('id', btIds)
            .eq('company_id', companyId)
            .eq('reconciled', false), // safety guard: never show already-reconciled

          // Open AP bills: potential settlement candidates for outgoing txns
          supabase.from('ap_invoices')
            .select('id, invoice_ref, supplier, amount, gross_amount, amount_paid, invoice_date')
            .eq('company_id', companyId)
            .in('status', ['pending', 'approved', 'part_paid']),

          // Open AR invoices: potential settlement candidates for incoming txns
          supabase.from('invoices')
            .select('id, invoice_number, invoice_ref, client, total, amount, amount_paid, issue_date, invoice_date')
            .eq('company_id', companyId)
            .in('status', ['sent', 'part_paid']),
        ]);

        // Shape open invoices the same way the matching engine does
        const mapAP = x => { const tot = Number(x.gross_amount||x.amount||0); const outs = Math.max(0, tot - Number(x.amount_paid||0)); return { ...x, _type:'ap_invoice', _date:x.invoice_date, amount:tot, outstanding:outs }; };
        const mapAR = x => { const tot = Number(x.total||x.amount||0); const outs = Math.max(0, tot - Number(x.amount_paid||0)); return { ...x, _type:'invoice', _date:x.issue_date||x.invoice_date, amount:tot, outstanding:outs }; };
        const apCands = (openAP||[]).map(mapAP).filter(x => x.outstanding > 0.005);
        const arCands = (openAR||[]).map(mapAR).filter(x => x.outstanding > 0.005);

        // Fetch journal nominals for the suggestion chips
        const jIds = Object.values(bestMatch).map(m => m.matched_id).filter(Boolean);
        const { data: journals } = jIds.length
          ? await supabase.from('journals').select('id, debit_account, credit_account, vat_code').in('id', jIds)
          : { data: [] };
        const jMap = Object.fromEntries((journals || []).map(j => [j.id, j]));

        txnItems = (bts || [])
          .filter(bt => {
            // needsCategorisation: exclude any txn that strongly matches an open invoice
            // (settlement candidate → belongs in web settlement flow, not mobile categorise)
            const isIn  = Number(bt.amount) > 0;
            const isOut = Number(bt.amount) < 0;
            const cands = [...(isIn ? arCands : []), ...(isOut ? apCands : [])];
            return !cands.some(c => recScoreCandidate(bt, c) >= 60);
          })
          .map(bt => {
            const match = bestMatch[bt.id];
            const j     = jMap[match.matched_id];
            const isIn  = Number(bt.amount) >= 0;
            return {
              _type:           'bank_txn',
              id:              bt.id,
              matchId:         match.id,
              company_id:      companyId,
              description:     bt.description,
              subtitle:        fmtD(bt.date),
              amount:          bt.amount,
              suggestedNominal:(isIn ? j?.credit_account : j?.debit_account) ?? '6600',
              vatCode:         j?.vat_code ?? null,
              confidence:      match.confidence,
              nominalName:     '',
              _raw:            bt,
            };
          });
      }

      // ── 3. Fetch COA names for all suggested nominals ───────────────────────
      const apItems = (bills || []).map(b => ({
        _type:    'ap_bill',
        id:       b.id,
        company_id: b.company_id,
        description:      b.supplier,
        subtitle:         [b.invoice_ref, fmtD(b.invoice_date)].filter(Boolean).join(' · '),
        amount:           b.gross_amount ?? b.amount ?? 0,
        suggestedNominal: b.suggested_nominal ?? b.nominal_code ?? '6600',
        vatCode:          b.vat_code ?? 'STD23',
        confidence:       null,
        nominalName:      '',
        _raw:             b,
      }));

      const allCodes = [...new Set([...apItems, ...txnItems].map(i => i.suggestedNominal).filter(Boolean))];
      if (allCodes.length) {
        const { data: coa } = await supabase
          .from('chart_of_accounts')
          .select('code, name')
          .eq('company_id', companyId)
          .in('code', allCodes);
        const nameMap = Object.fromEntries((coa || []).map(a => [a.code, a.name]));
        apItems.forEach(i => { i.nominalName = nameMap[i.suggestedNominal] ?? ''; });
        txnItems.forEach(i => { i.nominalName = nameMap[i.suggestedNominal] ?? ''; });
      }

      setItems([...apItems, ...txnItems]);
    } catch (e) {
      setLoadErr(e.message ?? 'Load failed');
    }
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  // Submitted expenses — approve / reject / re-code: the Expenses page's isAdmin rule and journal.
  const loadExpenses = useCallback(async () => {
    if (!companyId || !isAdmin) { setExpenses([]); return; }
    const [{ data, error }, nominal] = await Promise.all([
      supabase.from('expenses').select('*').eq('company_id', companyId).eq('status', 'submitted').order('receipt_date', { ascending: false }),
      fetchExpenseBankNominal(companyId),
    ]);
    if (error) setActionErr(`Couldn't load expenses: ${error.message}`);
    setExpenses(data || []);
    setBankNominal(nominal);
  }, [companyId, isAdmin]);
  useEffect(() => { loadExpenses(); }, [loadExpenses]);

  const expCategory = async (exp, code) => {
    const acct = acctOptions.find(a => a.code === code);
    if (!acct) return;
    setExpBusy(exp.id); setActionErr(null);
    const r = await updateExpenseNominal(exp, acct);
    if (!r.ok) setActionErr(r.message);
    else setExpenses(p => p.map(e => e.id === exp.id ? { ...e, nominal_account: code, nominal_name: acct.name } : e));
    setExpBusy(null);
  };
  const expVatCode = async (exp, code) => {
    setExpBusy(exp.id); setActionErr(null);
    const r = await updateExpenseVatCode(exp, code);
    if (!r.ok) setActionErr(r.message);
    else setExpenses(p => p.map(e => e.id === exp.id ? { ...e, vat_code: code || null } : e));
    setExpBusy(null);
  };
  const expApprove = async (exp) => {
    setExpBusy(exp.id); setActionErr(null);
    const r = await approveExpense(companyId, exp, bankNominal);
    if (!r.ok) setActionErr(r.message);
    else setExpenses(p => { const next = p.filter(e => e.id !== exp.id); if (!next.length && !items.length) setJustCleared(true); return next; });
    setExpBusy(null);
  };
  const expReject = async (exp) => {
    setExpBusy(exp.id); setActionErr(null);
    const r = await rejectExpense(exp);
    if (!r.ok) setActionErr(r.message);
    else setExpenses(p => p.filter(e => e.id !== exp.id));
    setExpBusy(null);
  };

  const handleApprove = async (item, overrides) => {
    setApproving(item.id); setActionErr(null);
    try {
      if (item._type === 'ap_bill') {
        // Nominal as chosen on the card; VAT code only the accountant's choice (the server keeps
        // the bill's own for a business_owner regardless).
        await approveApBill({ ...item._raw,
          suggested_nominal: overrides?.nominal ?? item.suggestedNominal,
          vat_code: isBusinessOwner ? item._raw.vat_code : (overrides?.vatCode ?? item._raw.vat_code) });
      } else {
        await confirmBankTxn(item.company_id, item.matchId, item.id);
      }
      setItems(prev => {
        const next = prev.filter(i => i.id !== item.id);
        if (next.length === 0 && prev.length > 0) setJustCleared(true);
        return next;
      });
    } catch (e) {
      console.error('[approvals] approve failed:', e.message);
      setActionErr(`Couldn't approve ${item.description || 'item'}: ${e.message}`);
    }
    setApproving(null);
  };

  // Defer to web — remove from local mobile view, no DB change
  const handleReview = (item) => {
    setItems(prev => prev.filter(i => i.id !== item.id));
  };

  const dateStr = new Date().toLocaleDateString('en-IE', { weekday:'long', day:'numeric', month:'short' });

  return (
    <div>
      <div className="m-page-hdr">
        <div className="m-company-name">Approvals</div>
        <div className="m-date-str">
          {loading ? 'Loading…' : items.length + expenses.length === 0 ? dateStr : `${items.length + expenses.length} item${items.length + expenses.length !== 1 ? 's' : ''} need your review`}
        </div>
      </div>

      {actionErr && <div className="qi-err">{actionErr}</div>}
      {loadErr && (
        <div style={{ margin:'0 16px 12px', padding:'12px', background:'rgba(248,113,113,0.08)', border:'1px solid rgba(248,113,113,0.2)', borderRadius:10, fontSize:12, color:'var(--red)' }}>
          {loadErr}
        </div>
      )}

      {loading ? (
        <div className="m-empty">Loading queue…</div>
      ) : items.length + expenses.length === 0 ? (
        <>
          {/* Celebration / calm empty state */}
          <InboxZeroCelebration companyId={companyId} justCleared={justCleared} theme="dark" />
          {/* Receipt capture always accessible */}
          <div className="m-sec-title">Capture a Receipt</div>
          <ReceiptCapture companyId={companyId} user={user} isBusinessOwner={isBusinessOwner} />
        </>
      ) : (
        <>
          {expenses.length > 0 && <div className="m-sec-title">Expenses to approve</div>}
          {expenses.map(exp => (
            <ExpenseCard key={exp.id} exp={exp} busy={expBusy === exp.id} acctOptions={acctOptions} canEditVat={!isBusinessOwner}
              onCategory={expCategory} onVatCode={expVatCode} onApprove={expApprove} onReject={expReject} />
          ))}
          {expenses.length > 0 && items.length > 0 && <div className="m-sec-title">Bills &amp; bank</div>}
          {items.map(item => (
            <ApprovalCard key={item.id} item={item} approving={approving} acctOptions={acctOptions} canEditVat={!isBusinessOwner}
              onApprove={overrides => handleApprove(item, overrides)} onReview={() => handleReview(item)} />
          ))}

          {/* Receipt capture below queue */}
          <div className="m-sec-title" style={{ marginTop:12 }}>Capture a Receipt</div>
          <ReceiptCapture companyId={companyId} user={user} isBusinessOwner={isBusinessOwner} />
        </>
      )}
    </div>
  );
}

// ─── VAT return (UX-03) — Compliance tab card ─────────────────────────────────
// The period's VAT3 figures and blockers, from the desktop VAT Returns screen's own functions
// (src/shared/vat3.js), and — for a business_owner — Request Filing: the same
// request_vat_filing RPC and figures snapshot desktop sends. No adjustment / E1–ES2 / PA entry
// on the phone: those go as zero, exactly what desktop sends when nobody touches those fields;
// a return that needs them is done on the full site. Accountants file on the full site.
const VAT_INPUTS_UNTOUCHED = { paCustomsValue: '0', paVatAmount: '0', adjT1: '', adjT2: '' };
const fmtVat = n => `€${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function VatReturnCard({ company, isBusinessOwner }) {
  const companyId = company?.id;
  const periods = useMemo(() => getVATPeriods(company?.vat_period || 'bimonthly', company?.ros_efiler || false),
    [company?.vat_period, company?.ros_efiler]);
  const [locked, setLocked]     = useState(null);       // get_locked_periods rows
  const [selVal, setSelVal]     = useState(null);
  const [data, setData]         = useState(null);       // fetchVat3PeriodData result
  const [loadErr, setLoadErr]   = useState(null);
  const [request, setRequest]   = useState(undefined);  // latest filing request | null; undefined = loading
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending]   = useState(false);
  const [sendErr, setSendErr]   = useState(null);
  const today = localToday();

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    supabase.rpc('get_locked_periods', { p_company_id: companyId })
      .then(({ data: rows, error }) => { if (!cancelled) setLocked(error ? [] : (rows || [])); });
    return () => { cancelled = true; };
  }, [companyId]);

  // Default to the latest period that has ended and isn't filed — the one a return is due
  // for — else the current one (the desktop screen's default).
  useEffect(() => {
    if (selVal || !locked || !periods.length) return;
    setSelVal(defaultVatPeriod(periods, locked, today)?.val ?? null);
  }, [locked, periods, selVal, today]);

  const vatPeriod = periods.find(p => p.val === selVal) || null;

  useEffect(() => {
    if (!companyId || !vatPeriod) return;
    let cancelled = false;
    setData(null); setLoadErr(null); setRequest(undefined); setConfirming(false); setSendErr(null);
    fetchVat3PeriodData(companyId, vatPeriod)
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setLoadErr(e.message); });
    // Most recent filing request for this period (same query as desktop).
    supabase.from('vat_filing_requests')
      .select('status, requested_at, figures, vat_control_balance, vat_control_delta')
      .eq('company_id', companyId).eq('period_val', vatPeriod.val)
      .order('requested_at', { ascending: false }).limit(1)
      .then(({ data: rows }) => { if (!cancelled) setRequest(rows?.[0] ?? null); });
    return () => { cancelled = true; };
  }, [companyId, vatPeriod?.val]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!company?.vat_registered) return null;

  const v = data ? computeVat3(data.journals, VAT_INPUTS_UNTOUCHED) : null;
  const isBizLocked = isPeriodLocked(vatPeriod, locked);
  const b = data && request !== undefined
    ? vat3Blockers({ pendingBills: data.pendingBills, unreconciledBt: data.unreconciledBt, isLocked: isBizLocked, isBizLocked, existingRequest: request })
    : null;
  const notEnded = vatPeriod && vatPeriod.end >= today;

  const send = async () => {
    if (!v || !b?.canRequest || sending) return;
    setSending(true); setSendErr(null);
    const figures = buildFilingFigures({ ...v, adjT1Comment: '', adjT2Comment: '', e1: '0', e2: '0', es1: '0', es2: '0' });
    const { data: res, error } = await supabase.rpc('request_vat_filing', {
      p_company_id: companyId, p_period_val: vatPeriod.val,
      p_period_start: vatPeriod.start, p_period_end: vatPeriod.end, p_figures: figures,
    });
    if (error) {
      captureError(error, { company_id: companyId, operation: 'vat-request-filing-mobile', period: vatPeriod.val });
      setSendErr(error.message);
    } else {
      setRequest({ status: 'pending', requested_at: res?.requested_at, figures,
        vat_control_balance: res?.vat_control_balance, vat_control_delta: res?.vat_control_delta });
    }
    setSending(false); setConfirming(false);
  };

  const box = (label, sub, val, colour) => (
    <div className="m-vat-box">
      <div className="m-vat-lbl">{label}</div>
      <div className="m-vat-val" style={{ color: colour }}>{v ? fmtVat(val) : '…'}</div>
      <div className="m-vat-sub">{sub}</div>
    </div>
  );

  return (
    <>
      <div className="m-sec-title">VAT return</div>
      <div className="m-card">
        <select className="m-fselect" value={selVal || ''} onChange={e => setSelVal(e.target.value)} aria-label="VAT period">
          {periods.map(p => <option key={p.val} value={p.val}>{p.label}{isPeriodLocked(p, locked) ? ' — filed' : ''}</option>)}
        </select>
        <div className="m-vat-due">
          {isBizLocked ? '✓ Filed — this period is locked'
            : vatPeriod ? `Due ${vatPeriod.due}${notEnded ? ' · period not ended yet — figures will change' : ''}` : ''}
        </div>

        {loadErr ? <div className="qi-err" style={{ margin: '10px 0 0' }}>{loadErr}</div> : (
          <>
            <div className="m-vat-grid">
              {/* Final figures — what the desktop screen shows and what gets filed (T3 = T1 − T2 after rounding) */}
              {box('T1', 'VAT on sales', v?.t1Final, 'var(--mtx)')}
              {box('T2', 'VAT on purchases', v?.t2Final, 'var(--mtx)')}
              {box('T3', 'Payable', v?.t3Final, v && v.t3Final > 0 ? 'var(--gold)' : 'var(--mm)')}
              {box('T4', 'Repayable', v?.t4Final, v && v.t4Final > 0 ? 'var(--teal2)' : 'var(--mm)')}
            </div>
            {v && <div className="m-vat-sub" style={{ marginTop: 6 }}>{plural(v.t1DrillRows.length, 'sales journal')} · {plural(v.t2DrillRows.length, 'purchase journal')}</div>}

            {data && (b?.hardBlockCount > 0 || data.pendingExpenses.length > 0 || data.draftArInvoices.length > 0 || v.codeExceptions.length > 0 || v.rcExceptions.length > 0) && (
              <div className="m-vat-notes">
                {data.pendingBills.length > 0 && <div className="c-red">⚠ {plural(data.pendingBills.length, 'bill')} awaiting review — blocks filing</div>}
                {data.unreconciledBt.length > 0 && <div className="c-red">⚠ {plural(data.unreconciledBt.length, 'bank line')} not reconciled — blocks filing</div>}
                {data.pendingExpenses.length > 0 && <div className="c-gold">{plural(data.pendingExpenses.length, 'expense')} not yet approved — not in these figures</div>}
                {data.draftArInvoices.length > 0 && <div className="c-gold">{plural(data.draftArInvoices.length, 'draft invoice')} — not in these figures until finalised</div>}
                {v.codeExceptions.length > 0 && <div className="c-dim">{plural(v.codeExceptions.length, 'journal')} with no VAT code — may affect T1/T2</div>}
                {v.rcExceptions.length > 0 && <div className="c-dim">{plural(v.rcExceptions.length, 'reverse-charge item')} — declared separately on ROS</div>}
              </div>
            )}

            {isBusinessOwner ? (
              isBizLocked ? null
              : request === undefined || !b ? <div className="m-empty" style={{ padding: '12px 0 0' }}>Loading…</div>
              : b.hasPendingRequest ? (
                <div className="m-vat-ok">✓ Filing requested{request?.requested_at ? ` ${new Date(request.requested_at).toLocaleDateString('en-IE')}` : ''} — awaiting accountant review</div>
              ) : confirming ? (
                <div className="m-vat-confirm">
                  <div>Send the {vatPeriod.label} return to your accountant to file?</div>
                  <div className="m-vat-sub" style={{ marginTop: 4 }}>
                    {v.t4Final > 0 ? `${fmtVat(v.t4Final)} repayable` : `${fmtVat(v.t3Final)} payable`} · T1 {fmtVat(v.t1Final)} · T2 {fmtVat(v.t2Final)}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button type="button" className="m-btn m-btn-p" style={{ flex: 2, minHeight: 44, padding: 10 }} onClick={send} disabled={sending}>{sending ? 'Sending…' : 'Confirm request'}</button>
                    <button type="button" className="m-btn m-btn-s" style={{ flex: 1, minHeight: 44, padding: 10, marginTop: 0 }} onClick={() => setConfirming(false)} disabled={sending}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="m-btn m-btn-p" style={{ marginTop: 12 }} disabled={!b.canRequest} onClick={() => { setSendErr(null); setConfirming(true); }}>
                  Request filing
                </button>
              )
            ) : !isBizLocked && (
              <div className="m-vat-sub" style={{ marginTop: 12 }}>
                {request?.status === 'pending' && (
                  <div className="m-vat-ok" style={{ marginTop: 0, marginBottom: 8 }}>
                    Filing requested by client{request.requested_at ? ` ${new Date(request.requested_at).toLocaleDateString('en-IE')}` : ''} — review and file on the full site.
                  </div>
                )}
                Review and file this return on the full site. <button type="button" className="m-link-btn" style={{ padding: 0, fontSize: 12 }} onClick={goToFullSite}>View full site</button>
              </div>
            )}
            {sendErr && <div className="qi-err" style={{ margin: '10px 0 0' }}>{sendErr}</div>}
          </>
        )}
      </div>
    </>
  );
}

// ─── Compliance tab ───────────────────────────────────────────────────────────
function ComplianceTab({ company, isBusinessOwner }) {
  const [expanded, setExpanded] = useState(null);
  const deadlines = useApplicableDeadlines(company);
  const shown = (deadlines || []).filter(isCurrent).slice(0, 12);

  return (
    <div>
      <div className="m-page-hdr">
        <div className="m-company-name">Compliance</div>
        <div className="m-date-str">Tax · CRO · Revenue deadlines</div>
      </div>
      <VatReturnCard company={company} isBusinessOwner={isBusinessOwner} />
      <div className="m-sec-title">Deadlines</div>
      <div className="m-card">
        {deadlines === null
          ? <div className="m-empty">Loading…</div>
          : shown.length === 0
          ? <div className="m-empty">No upcoming deadlines</div>
          : shown.map((dl, i) => {
            const c = dueColour(dl);
            const isExp = expanded === i;
            return (
              <div key={`${dl.type}-${+dl.due}`}>
                <div className="m-dl" style={{ cursor: 'pointer' }} onClick={() => setExpanded(isExp ? null : i)}>
                  <div className="m-dl-dot" style={{ background: c }} />
                  <div className="m-dl-type">{dl.type}</div>
                  <div className="m-dl-body">
                    <div className="m-dl-desc">{dl.desc}</div>
                    {isExp && <div className="m-dl-date" style={{ marginTop: 4 }}>Due: {dl.due.toLocaleDateString('en-IE',{day:'numeric',month:'long',year:'numeric'})}</div>}
                  </div>
                  <div className="m-dl-days" style={{ color: c }}>{dueLabel(dl)}</div>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

// ─── QuickInvoice tab ─────────────────────────────────────────────────────────
function QuickInvoiceTab({ companyId, company }) {
  const defaultVc = vatCodeForRate(company?.sales_vat_rate) || 'STD23';

  function mkBlank(vc) {
    return { _id: Math.random().toString(36).slice(2), description: '', quantity: 1, unit_price: '', vat_code: vc || 'STD23', line_total: 0, vat_amount: 0, gross_total: 0 };
  }

  // ── Data ──────────────────────────────────────────────────────────────────
  const [customers,   setCustomers]   = useState([]);
  const [invSettings, setInvSettings] = useState(null);
  const [loadingData, setLoadingData] = useState(true);

  // ── Form ──────────────────────────────────────────────────────────────────
  const [selectedCustId, setSelectedCustId] = useState('');
  const [addingCust,     setAddingCust]     = useState(false);
  const [newName,        setNewName]        = useState('');
  const [newEmail,       setNewEmail]       = useState('');
  const [custSaving,     setCustSaving]     = useState(false);
  const [lines,          setLines]          = useState([mkBlank('STD23')]);

  // ── Submission ────────────────────────────────────────────────────────────
  const [saving,       setSaving]       = useState(false);
  const [err,          setErr]          = useState(null);
  const [result,       setResult]       = useState(null); // { id, numStr } after finalise
  const [sending,      setSending]      = useState(false);
  const [sentTo,       setSentTo]       = useState(null);
  const [downloading,  setDownloading]  = useState(false);

  useEffect(() => {
    if (!companyId) return;
    Promise.all([
      supabase.from('customers').select('id,name,email').eq('company_id', companyId).eq('is_active', true).order('name'),
      supabase.from('invoice_settings').select('*').eq('company_id', companyId).maybeSingle(),
    ]).then(([custRes, setRes]) => {
      if (custRes.data) setCustomers(custRes.data);
      if (setRes.data)  setInvSettings(setRes.data);
      setLoadingData(false);
    });
  }, [companyId]);

  // ── Line helpers ──────────────────────────────────────────────────────────
  const updateLine = (idx, field, val) => setLines(prev => {
    const next = [...prev];
    next[idx] = calcLineAmounts({ ...next[idx], [field]: val });
    return next;
  });

  const computedLines = lines.map(l => calcLineAmounts(l));
  const totals = calcInvTotals(computedLines);
  const fmtE   = v => `€${Number(v || 0).toFixed(2)}`;

  // ── Add customer inline ───────────────────────────────────────────────────
  const addCustomer = async () => {
    if (!newName.trim()) return;
    setCustSaving(true);
    const { data, error } = await supabase.from('customers')
      .insert({ company_id: companyId, name: newName.trim(), email: newEmail.trim() || null, is_active: true })
      .select('id,name,email').single();
    if (!error && data) {
      setCustomers(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedCustId(data.id);
      setAddingCust(false); setNewName(''); setNewEmail('');
    }
    setCustSaving(false);
  };

  // ── Finalise ──────────────────────────────────────────────────────────────
  const canFinalise = !!selectedCustId && computedLines.some(l => l.description.trim()) && !saving;

  const handleFinalise = async () => {
    if (!canFinalise || !companyId) return;
    setSaving(true); setErr(null);
    try {
      const todayStr = localToday();
      const currency = company?.base_currency || 'EUR';
      const inv = {
        type: 'invoice',
        customer_id: selectedCustId,
        issue_date: todayStr,
        payment_terms: Number(invSettings?.payment_terms ?? 30),
        credit_note_for: null,
        reference: null,
        notes: null,
      };
      // Step 1: create draft (finaliseInvoice requires inv.id)
      const draftId = await createInvoiceDraft(supabase, companyId, inv, computedLines, customers, invSettings, currency);
      // Step 2: claim number → upsert lines → post journals → stamp sent
      const { numStr } = await finaliseInvoice(supabase, companyId, { ...inv, id: draftId }, computedLines, customers, invSettings);
      setResult({ id: draftId, numStr });
    } catch (e) {
      setErr(e.message);
    }
    setSaving(false);
  };

  // ── Send / PDF ────────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!result) return;
    setSending(true); setErr(null);
    try {
      const r = await fetch('/api/send-invoice', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await window.Clerk?.session?.getToken()}` },
        body: JSON.stringify({ invoice_id: result.id, company_id: companyId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Send failed');
      setSentTo(d.to);
    } catch (e) { setErr(e.message); }
    setSending(false);
  };

  const handleDownload = async () => {
    if (!result) return;
    setDownloading(true); setErr(null);
    try {
      const r = await fetch('/api/invoice-pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await window.Clerk?.session?.getToken()}` },
        body: JSON.stringify({ invoice_id: result.id, company_id: companyId }),
      });
      if (!r.ok) throw new Error('PDF generation failed');
      const blob = await r.blob();
      const url  = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `${result.numStr}.pdf` });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { setErr(e.message); }
    setDownloading(false);
  };

  const reset = () => {
    setResult(null); setSelectedCustId(''); setLines([mkBlank(defaultVc)]);
    setErr(null); setSentTo(null); setAddingCust(false); setNewName(''); setNewEmail('');
  };

  // ── Success screen ────────────────────────────────────────────────────────
  if (result) {
    const cust = customers.find(c => c.id === selectedCustId);
    return (
      <div>
        <div className="m-page-hdr">
          <div className="m-company-name">Invoice</div>
          <div className="m-date-str">Finalised · Journal posted</div>
        </div>

        <div className="qi-done-card">
          <div className="qi-done-num">{result.numStr}</div>
          <div className="qi-done-who">{cust?.name}</div>
          <div className="qi-done-sub">{fmtE(totals.total)} · DR 1100 / CR 4000</div>
        </div>

        {err    && <div className="qi-err">{err} <span style={{float:'right',cursor:'pointer'}} onClick={() => setErr(null)}>✕</span></div>}
        {sentTo && <div className="qi-ok">✓ Sent to {sentTo}</div>}

        <div className="m-form">
          {cust?.email && !sentTo ? (
            <button className="m-btn m-btn-p" onClick={handleSend} disabled={sending}>
              {sending ? 'Sending…' : `Email to ${cust.email}`}
            </button>
          ) : !cust?.email ? (
            <div style={{ padding:'10px 0', fontSize:13, color:'var(--mm)', textAlign:'center' }}>
              No email on file — add one in the web app to send
            </div>
          ) : null}
          <button className="m-btn m-btn-s" onClick={handleDownload} disabled={downloading}>
            {downloading ? 'Generating PDF…' : '↓  Download PDF'}
          </button>
          <button className="m-btn m-btn-s" style={{ marginTop: 8 }} onClick={reset}>
            + New Invoice
          </button>
        </div>
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="m-page-hdr">
        <div className="m-company-name">Quick Invoice</div>
        <div className="m-date-str">{new Date().toLocaleDateString('en-IE', { day:'numeric', month:'long', year:'numeric' })}</div>
      </div>

      {err && <div className="qi-err" onClick={() => setErr(null)}>{err} ✕</div>}

      {/* Customer */}
      <div className="m-form">
        <div className="m-fgroup">
          <label className="m-flabel">Customer</label>
          {!addingCust ? (
            <div className="qi-cust-row">
              <select className="qi-cust-sel" value={selectedCustId}
                onChange={e => setSelectedCustId(e.target.value)} disabled={loadingData}>
                <option value="">{loadingData ? 'Loading…' : '— select customer —'}</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button className="qi-new-btn" onClick={() => setAddingCust(true)}>+ New</button>
            </div>
          ) : (
            <div className="m-card" style={{ margin: 0, marginBottom: 8 }}>
              <div className="m-fgroup">
                <label className="m-flabel">Name</label>
                <input className="m-finput" value={newName} onChange={e => setNewName(e.target.value)}
                  placeholder="Customer name" autoFocus />
              </div>
              <div className="m-fgroup" style={{ marginBottom: 12 }}>
                <label className="m-flabel">Email</label>
                <input className="m-finput" type="email" inputMode="email" value={newEmail}
                  onChange={e => setNewEmail(e.target.value)} placeholder="email@example.com" />
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button className="m-btn m-btn-p" style={{ flex:2, padding:'12px', fontSize:14, minHeight:46 }}
                  onClick={addCustomer} disabled={!newName.trim() || custSaving}>
                  {custSaving ? 'Saving…' : 'Add Customer'}
                </button>
                <button style={{ flex:1, padding:'12px', background:'var(--ms)', border:'1px solid var(--mbd)', borderRadius:'var(--rsm)', fontSize:13, color:'var(--mm)', cursor:'pointer', fontFamily:'Inter,system-ui,sans-serif', minHeight:46 }}
                  onClick={() => { setAddingCust(false); setNewName(''); setNewEmail(''); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Line items */}
      {lines.map((line, idx) => (
        <div key={line._id} className="qi-line-card">
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:9 }}>
            <input className="m-finput" style={{ flex:1 }} value={line.description}
              onChange={e => updateLine(idx, 'description', e.target.value)}
              placeholder={`Line ${idx + 1} description`} />
            {lines.length > 1 && (
              <button className="qi-line-del" onClick={() => setLines(prev => prev.filter((_, i) => i !== idx))}>✕</button>
            )}
          </div>
          <div className="m-frow" style={{ marginBottom: 9 }}>
            <div>
              <label className="m-flabel">Qty</label>
              <input className="m-finput" type="number" inputMode="decimal" min="0" step="any"
                value={line.quantity} onChange={e => updateLine(idx, 'quantity', e.target.value)} />
            </div>
            <div>
              <label className="m-flabel">Unit Price (€)</label>
              <input className="m-finput" type="number" inputMode="decimal" min="0" step="0.01"
                value={line.unit_price} onChange={e => updateLine(idx, 'unit_price', e.target.value)}
                placeholder="0.00" />
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <select className="m-fselect" style={{ flex:1 }} value={line.vat_code}
              onChange={e => updateLine(idx, 'vat_code', e.target.value)}>
              {Object.entries(INV_VAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <span className="qi-line-gross">{fmtE(line.gross_total)}</span>
          </div>
        </div>
      ))}

      <button className="qi-add-line" onClick={() => setLines(prev => [...prev, mkBlank(defaultVc)])}>
        + Add Line
      </button>

      {/* Running total */}
      <div className="qi-total-bar">
        <div>
          <div className="qi-total-lbl">Gross Total</div>
          {totals.vat_total > 0 && (
            <div className="qi-total-sub">incl. {fmtE(totals.vat_total)} VAT</div>
          )}
        </div>
        <div className="qi-total-val">{fmtE(totals.total)}</div>
      </div>

      <div className="m-form">
        <button className="m-btn m-btn-p" onClick={handleFinalise} disabled={!canFinalise}>
          {saving ? 'Finalising…' : 'Finalise Invoice'}
        </button>
        {!selectedCustId && (
          <div style={{ textAlign:'center', fontSize:12, color:'var(--mm)', marginTop:8 }}>Select a customer to continue</div>
        )}
      </div>
    </div>
  );
}

// ─── Invoices tab (UX-03 Stage 2) ─────────────────────────────────────────────
// The company's invoices with status — the Invoices page's rule (src/shared/invoice.js), same
// as Home's overdue count — plus Quick Invoice for creating one. Read-only list: void / delete /
// mark paid stay on the full site.
const INV_BADGE = {
  overdue:   { label: 'Overdue',   color: 'var(--red)' },
  part_paid: { label: 'Part paid', color: 'var(--gold)' },
  paid:      { label: 'Paid',      color: 'var(--green)' },
  draft:     { label: 'Draft',     color: 'var(--mm)' },
  void:      { label: 'Void',      color: 'var(--md)' },
  credited:  { label: 'Credited',  color: 'var(--md)' },
  chased:    { label: 'Chased',    color: 'var(--teal2)' },
  sent:      { label: 'Sent',      color: 'var(--teal2)' },
};
const OPEN_STATUSES = new Set(['overdue', 'part_paid', 'sent', 'chased', 'pending']);

function InvoicesTab({ companyId, company }) {
  const [mode, setMode]       = useState('list');   // list | new
  const [rows, setRows]       = useState(null);     // null while loading
  const [loadErr, setLoadErr] = useState(null);
  const [show, setShow]       = useState('open');   // open | all

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoadErr(null);
    try {
      const [docs, cust] = await Promise.all([
        fetchInvoiceDocs(supabase, companyId),
        supabase.from('customers').select('id,name').eq('company_id', companyId),
      ]);
      const credited = creditedByInvoice(docs);
      const custName = Object.fromEntries((cust.data || []).map(c => [c.id, c.name]));
      const today = new Date();
      setRows(docs.filter(d => d.type === 'invoice').map(inv => ({
        inv,
        st:   invoiceStatus(inv, credited, today),
        owed: invoiceOutstanding(inv, credited),
        who:  custName[inv.customer_id] || inv.client || '—',
      })).sort((a, b) => String(b.inv.issue_date || b.inv.invoice_date || '').localeCompare(String(a.inv.issue_date || a.inv.invoice_date || ''))));
    } catch (e) { setLoadErr(e.message); setRows([]); }
  }, [companyId]);

  useEffect(() => { if (mode === 'list') load(); }, [mode, load]);

  if (mode === 'new') {
    return (
      <>
        <div style={{ padding: '10px 10px 0' }}>
          <button type="button" className="m-link-btn" onClick={() => setMode('list')}>← Invoices</button>
        </div>
        <QuickInvoiceTab companyId={companyId} company={company} />
      </>
    );
  }

  const open = (rows || []).filter(r => OPEN_STATUSES.has(r.st));
  const shown = show === 'open' ? open : (rows || []);
  const outstanding = open.reduce((s, r) => s + r.owed, 0);
  const overdue = open.filter(r => r.st === 'overdue').reduce((s, r) => s + r.owed, 0);

  return (
    <div>
      <div className="m-page-hdr" style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', gap:10 }}>
        <div>
          <div className="m-company-name">Invoices</div>
          <div className="m-date-str">{rows === null ? 'Loading…' : `${fmtCash(outstanding)} outstanding${overdue > 0 ? ` · ${fmtCash(overdue)} overdue` : ''}`}</div>
        </div>
        <button type="button" className="m-btn-sm" style={{ background:'var(--teal)', color:'white' }} onClick={() => setMode('new')}>+ New</button>
      </div>

      <div className="m-seg">
        <button type="button" className={show === 'open' ? 'active' : ''} onClick={() => setShow('open')}>Open{rows ? ` (${open.length})` : ''}</button>
        <button type="button" className={show === 'all' ? 'active' : ''} onClick={() => setShow('all')}>All{rows ? ` (${rows.length})` : ''}</button>
      </div>

      {loadErr && <div className="qi-err">{loadErr}</div>}
      <div className="m-card">
        {rows === null ? <div className="m-empty">Loading…</div> :
         shown.length === 0 ? <div className="m-empty">{show === 'open' ? 'No open invoices' : 'No invoices yet'}</div> :
         shown.map(({ inv, st, owed, who }) => {
           const b = INV_BADGE[st] || { label: st, color: 'var(--mm)' };
           const due = inv.due_date_calc || inv.due_date;
           const isOpen = OPEN_STATUSES.has(st);
           return (
             <div key={inv.id} className="m-inv">
               <div className="m-inv-info">
                 <div className="m-inv-client">{who}</div>
                 <div className="m-inv-meta">
                   {inv.invoice_number || inv.invoice_ref || 'Draft'} · {fmtD(inv.issue_date || inv.invoice_date)}{isOpen && due ? ` · due ${fmtD(due)}` : ''}
                 </div>
               </div>
               <div style={{ textAlign:'right', flexShrink:0 }}>
                 <div style={{ fontFamily:'Source Code Pro,monospace', fontSize:13, fontWeight:600 }}>{fmtCash(isOpen ? owed : inv.total)}</div>
                 <span className="m-badge" style={{ color: b.color, border: `1px solid ${b.color}`, marginTop: 4 }}>{b.label}</span>
               </div>
             </div>
           );
         })}
      </div>
    </div>
  );
}

// ─── Bank feeds (UX-03 Stage 2) — Cash tab section ────────────────────────────
// Connect / reconnect a bank through Yapily's hosted consent (src/shared/bankConnect.js, the
// same flow as the full app's Bank Feeds). The callback lands on /?bank_connected=…, which
// main.jsx routes back to /mobile, where Mobile shows the result banner. Importing the feed
// (preview → import) and disconnecting stay on the full site.
const fmtDateLong = d => d ? new Date(d).toLocaleDateString('en-IE', { day:'2-digit', month:'short', year:'numeric' }) : '—';
const TONE = { accent: 'var(--teal2)', warn: 'var(--gold)', danger: 'var(--red)', faint: 'var(--md)' };

function BankFeeds({ companyId, company }) {
  const [conns, setConns]           = useState(null);
  const [error, setError]           = useState(null);
  const [picker, setPicker]         = useState(false);
  const [institutions, setInsts]    = useState([]);
  const [instLoading, setInstLoading] = useState(false);
  const [search, setSearch]         = useState('');
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    supabase.from('bank_connections')
      .select('id, institution_id, status, consent_expires_at, yapily_reconfirm_by, account_refs, created_at')
      .eq('company_id', companyId).neq('status', 'revoked').order('created_at', { ascending: false })
      .then(({ data, error: e }) => { if (!cancelled) { if (e) setError(e.message); setConns(data || []); } });
    return () => { cancelled = true; };
  }, [companyId]);

  if (!can(company, 'bank_feeds')) return null; // plan without bank feeds — same gate as the full app

  const loadInstitutions = async () => {
    if (institutions.length) return institutions;
    setInstLoading(true);
    try { const { institutions: list } = await fetchInstitutions('IE'); setInsts(list); return list; }
    catch (e) { setError(e.message); setPicker(false); return []; }
    finally { setInstLoading(false); }
  };
  const openPicker = () => { setPicker(true); setSearch(''); setError(null); loadInstitutions(); };
  const connect = async inst => {
    setPicker(false); setConnecting(true); setError(null);
    try { window.location.href = await startBankConnect(companyId, inst); }
    catch (e) { setError(e.message); setConnecting(false); }
  };
  const reconnect = async conn => {
    setConnecting(true); setError(null);
    try { connect(await prepareReconnect(conn, await loadInstitutions())); }
    catch (e) { setError(e.message); setConnecting(false); }
  };

  return (
    <>
      <div className="m-sec-title">Bank feeds</div>
      <div className="m-card">
        {conns === null ? <div className="m-empty">Loading…</div> :
         conns.length === 0 ? <div className="m-empty" style={{ padding:'8px 0 14px' }}>No bank connected yet</div> :
         conns.map(c => {
           const st = connectionState(c, fmtDateLong);
           const accts = Array.isArray(c.account_refs) ? c.account_refs.map(a => a.name || a.id).join(', ') : '';
           return (
             <div key={c.id} className="m-inv">
               <div className="m-inv-info">
                 <div className="m-inv-client">{c.institution_id}</div>
                 <div className="m-inv-meta">{accts || '—'}</div>
               </div>
               <div style={{ textAlign:'right', flexShrink:0 }}>
                 <span className="m-badge" style={{ color: TONE[st.tone], border: `1px solid ${TONE[st.tone]}` }}>{st.label}</span>
                 {(st.key === 'expired' || st.key === 'expiring') && (
                   <div><button type="button" className="m-link-btn" style={{ fontSize:12, padding:'6px 0 0' }} disabled={connecting} onClick={() => reconnect(c)}>Reconnect</button></div>
                 )}
               </div>
             </div>
           );
         })}
        {error && <div className="qi-err" style={{ margin:'10px 0 0' }}>{error}</div>}
        <button type="button" className="m-btn m-btn-p" style={{ marginTop: 12 }} onClick={openPicker} disabled={connecting}>
          {connecting ? 'Redirecting to your bank…' : '+ Connect a bank'}
        </button>
      </div>

      {picker && (
        <>
          <div className="m-sheet-scrim" onClick={() => setPicker(false)} />
          <div className="m-sheet" role="listbox" aria-label="Choose your bank">
            <div className="m-sheet-title">Choose your bank</div>
            <input className="m-finput" placeholder="Search banks…" value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 8 }} />
            <div className="m-sheet-list">
              {instLoading ? <div className="m-empty">Loading banks…</div> :
               filterInstitutions(institutions, search).length === 0 ? <div className="m-empty">No banks match “{search}”</div> :
               filterInstitutions(institutions, search).map(inst => (
                 <button key={inst.id} type="button" role="option" className="m-sheet-item" onClick={() => connect(inst)}
                   style={{ display:'flex', alignItems:'center', gap:12 }}>
                   <span className="m-bank-logo">
                     {inst.logo ? <img src={inst.logo} alt="" onError={e => { e.target.style.display = 'none'; }} /> : inst.name.slice(0, 2).toUpperCase()}
                   </span>
                   <span style={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{inst.name}</span>
                   {inst.id === 'modelo-sandbox' && <span className="m-badge" style={{ color:'var(--gold)', border:'1px solid var(--gold)' }}>Sandbox</span>}
                 </button>
               ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ─── Ask AI (UX-03 Stage 3) — full-screen chat from the top bar ───────────────
// The full app's chat panel on the phone: the same live-data context, system prompt, greeting and
// /api/chat request (src/shared/chatContext.js), for the current month — what the desktop panel
// sends for its default period.
function MobileChat({ company, onClose }) {
  const companyId = company?.id;
  const companyName = company?.name || '';
  const selPeriod = thisMonthStr();
  const period = chatPeriodLabel(selPeriod);
  const [ctxLoading, setCtxLoading] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [msgs, setMsgs]     = useState([]);
  const [inp, setInp]       = useState('');
  const [typing, setTyping] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, typing]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCtxLoading(true);
      const ctx = await buildChatContext({ companyId, company, companyName, period, selPeriod });
      if (cancelled) return;
      setSystemPrompt(buildChatSystemPrompt({ companyName, ctx, page: 'Mobile' }));
      setMsgs([{ role: 'assistant', text: chatGreeting(period) }]);
      setCtxLoading(false);
    })();
    return () => { cancelled = true; };
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (text) => {
    const msg = text || inp;
    if (!msg.trim() || ctxLoading || typing) return;
    const history = msgs;
    setInp(''); setMsgs(p => [...p, { role: 'user', text: msg }]); setTyping(true);
    const reply = await sendChatMessage({ companyId, systemPrompt, history, msg });
    setMsgs(p => [...p, { role: 'assistant', text: reply }]);
    setTyping(false);
  };

  return (
    <div className="m-chat" role="dialog" aria-label="Ledgrly AI">
      <div className="m-chat-hdr">
        <div className="m-chat-av">✦</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="m-chat-ttl">Ledgrly AI</div>
          <div className="m-chat-st">{ctxLoading ? 'Loading your data…' : `${companyName} · ${period}`}</div>
        </div>
        <button type="button" className="m-menu-btn" aria-label="Close" onClick={onClose}>✕</button>
      </div>
      <div className="m-chat-msgs">
        {ctxLoading ? <div className="m-chat-msg a m-chat-dim">Loading your account data…</div>
          : msgs.map((m, i) => <div key={i} className={`m-chat-msg ${m.role === 'assistant' ? 'a' : 'u'}`}>{m.text}</div>)}
        {typing && <div className="m-chat-msg a m-chat-dim">…</div>}
        <div ref={endRef} />
      </div>
      {!ctxLoading && msgs.length <= 1 && (
        <div className="m-chat-sugg">
          {CHAT_SUGGESTIONS.map((s, i) => <button key={i} type="button" onClick={() => send(s)}>{s}</button>)}
        </div>
      )}
      <form className="m-chat-inp" onSubmit={e => { e.preventDefault(); send(); }}>
        <input className="m-finput" value={inp} onChange={e => setInp(e.target.value)}
          placeholder={ctxLoading ? 'Loading…' : 'Ask about your accounts…'} disabled={ctxLoading} enterKeyHint="send" />
        <button type="submit" className="m-chat-send" disabled={ctxLoading || typing || !inp.trim()} aria-label="Send">↑</button>
      </form>
    </div>
  );
}

// ─── Main Mobile component ────────────────────────────────────────────────────
// ─── Top bar: company switcher + menu (UX-03 Stage 0) ─────────────────────────
function MobileTopBar({ companies, company, onSwitch, onOpenChat }) {
  const { signOut } = useClerk();
  const [picker, setPicker] = useState(false);
  const [menu, setMenu]     = useState(false);
  const [q, setQ]           = useState('');
  const many = companies.length > 1;
  const shown = q.trim()
    ? companies.filter(c => (c.name || '').toLowerCase().includes(q.trim().toLowerCase()))
    : companies;
  const close = () => { setPicker(false); setMenu(false); setQ(''); };
  return (
    <>
      <div className="m-topbar">
        <button type="button" className="m-co-btn" onClick={() => { if (many) { setPicker(p => !p); setMenu(false); } }}
          aria-haspopup={many ? 'listbox' : undefined} aria-expanded={many ? picker : undefined} disabled={!many}>
          <span className="m-co-btn-name">{company?.name || '—'}</span>
          {many && <span className="m-co-btn-caret">▾</span>}
        </button>
        {onOpenChat && <button type="button" className="m-menu-btn m-ai-btn" aria-label="Ask Ledgrly AI" onClick={() => { onOpenChat(); close(); }}>✦</button>}
        <button type="button" className="m-menu-btn" aria-label="Menu" aria-expanded={menu}
          onClick={() => { setMenu(m => !m); setPicker(false); }}>⋯</button>
      </div>
      {(picker || menu) && <div className="m-sheet-scrim" onClick={close} />}
      {picker && (
        <div className="m-sheet" role="listbox" aria-label="Switch company">
          <div className="m-sheet-title">Switch company</div>
          {companies.length >= 6 && (
            <input className="m-finput" autoFocus placeholder={`Search ${companies.length} companies…`} value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 8 }} />
          )}
          <div className="m-sheet-list">
            {shown.map(c => (
              <button key={c.id} type="button" role="option" aria-selected={c.id === company?.id}
                className={`m-sheet-item${c.id === company?.id ? ' active' : ''}`}
                onClick={() => { onSwitch(c); close(); }}>
                {c.id === company?.id ? '✓ ' : ''}{c.name}
              </button>
            ))}
            {shown.length === 0 && <div className="m-empty">No matching companies</div>}
          </div>
        </div>
      )}
      {menu && (
        <div className="m-sheet" role="menu" aria-label="Menu">
          <button type="button" role="menuitem" className="m-sheet-item" onClick={goToFullSite}>🖥  View full site</button>
          <button type="button" role="menuitem" className="m-sheet-item" onClick={() => signOut({ redirectUrl: '/mobile' })}>⏻  Sign out</button>
        </div>
      )}
    </>
  );
}

// Full-screen message states (loading / access being set up / no company / not yet active).
function MobileNotice({ title, body, children }) {
  return (
    <div className="m-notice">
      {title && <div className="m-notice-title">{title}</div>}
      {body && <div className="m-notice-body">{body}</div>}
      {children}
    </div>
  );
}

const MOBILE_COMPANY_KEY = 'ledgrly_mobile_company'; // last company chosen on this device

export default function Mobile() {
  const { isLoaded, isSignedIn } = useAuth();
  const [tab, setTab] = useState('home');
  // One source of truth for company / role / access, shared with the full app — this is what
  // makes /mobile work for business owners (access via user_company_access, not ownership).
  const { user, companies, company, setCompany, onboarding, companyLoading, zeroCompanyCheck, isBusinessOwner } = useCompanyContext();
  // Desktop's colleague read-only rule (src/shared/orgRole.js) — gates expense approval.
  const { userMemberships } = useOrganizationList({ userMemberships: { pageSize: 50 } });
  const isAdmin = orgRoleFor(company, user?.id, userMemberships?.data) !== 'org:member';
  const [chatOpen, setChatOpen] = useState(false);
  const canChat = !!company && can(company, 'ai_chat'); // same gate as the full app's chat
  const companyId = company?.id ?? null;
  const [bankMsg, setBankMsg] = useState(null); // { ok, text } from the Yapily callback

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(e => console.warn('[SW]', e));
    }
  }, []);

  // Bank-connection callback (/mobile?bank_connected=1&company_id=… or ?bank_error=…) — routed
  // here from / by main.jsx so a phone flow doesn't land on the desktop app. Show the outcome,
  // remember which company it was for, and clean the URL.
  const callbackCompanyRef = useRef(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (!p.has('bank_connected') && !p.has('bank_error')) return;
    if (p.get('bank_connected') === '1') setBankMsg({ ok: true, text: 'Bank account connected.' });
    else setBankMsg({ ok: false, text: `Bank connection failed: ${p.get('bank_error')}` });
    callbackCompanyRef.current = p.get('company_id');
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  // Pick the company: the one a bank callback was for, else the last one chosen on this device.
  const pickedRef = useRef(false);
  useEffect(() => {
    if (pickedRef.current || !companies.length) return;
    pickedRef.current = true;
    let wanted = callbackCompanyRef.current;
    if (!wanted) { try { wanted = localStorage.getItem(MOBILE_COMPANY_KEY); } catch { /* ignore */ } }
    const c = wanted && companies.find(x => x.id === wanted);
    if (c) setCompany(c);
  }, [companies, setCompany]);

  const switchCompany = (c) => {
    setCompany(c);
    try { localStorage.setItem(MOBILE_COMPANY_KEY, c.id); } catch { /* ignore */ }
  };

  if (!isLoaded) return (<><style>{M_CSS}</style><div className="m-loading">LOADING…</div></>);
  if (!isSignedIn) return (<><style>{M_CSS}</style><MobileAuth /></>);

  const shell = (body) => (
    <>
      <style>{M_CSS}</style>
      <div className="m-wrap">{body}</div>
    </>
  );
  const fullSiteLink = <button type="button" className="m-link-btn" onClick={goToFullSite}>View full site</button>;

  // Same gates as the full app, in the same order.
  if (onboarding && (zeroCompanyCheck === null || zeroCompanyCheck === 'pending'))
    return shell(<MobileNotice title="Setting up your access…" />);
  if (onboarding && zeroCompanyCheck === 'has_access')
    return shell(<MobileNotice title="Having trouble loading your account"
      body="This can happen right after accepting an invite. Try again, or sign out and back in.">
      <button type="button" className="m-btn m-btn-p" onClick={() => window.location.reload()}>Try again</button>
    </MobileNotice>);
  if (onboarding)
    return shell(<MobileNotice title="No company yet" body="Set up your first company on the full site — it takes a few minutes, then everything is available here too.">{fullSiteLink}</MobileNotice>);
  if (companyLoading && !company) return (<><style>{M_CSS}</style><div className="m-loading">LOADING…</div></>);
  if (company && isPending(company))
    return shell(<>
      <MobileTopBar companies={companies} company={company} onSwitch={switchCompany} />
      <MobileNotice title="Awaiting activation" body={`${company.name} isn't active yet. You'll get access to everything once it's activated.`}>{fullSiteLink}</MobileNotice>
    </>);

  return shell(
    <>
      <MobileTopBar companies={companies} company={company} onSwitch={switchCompany} onOpenChat={canChat ? () => setChatOpen(true) : undefined} />
      {chatOpen && company && <MobileChat key={companyId} company={company} onClose={() => setChatOpen(false)} />}
      {bankMsg && (
        <div className={`m-banner ${bankMsg.ok ? 'ok' : 'err'}`} role="status">
          <span>{bankMsg.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setBankMsg(null)}>✕</button>
        </div>
      )}
      <div className="m-content">
        {tab === 'home'       && <HomeTab          key={companyId} companyId={companyId} company={company} setTab={setTab} />}
        {tab === 'approvals'  && <ApprovalsTab     key={companyId} companyId={companyId} user={user} isBusinessOwner={isBusinessOwner} isAdmin={isAdmin} />}
        {tab === 'cash'       && <CashTab          key={companyId} companyId={companyId} company={company} />}
        {tab === 'compliance' && <ComplianceTab    key={companyId} company={company} isBusinessOwner={isBusinessOwner} />}
        {tab === 'invoice'    && <InvoicesTab      key={companyId} companyId={companyId} company={company} />}
      </div>
      <BottomNav tab={tab} setTab={setTab} />
    </>
  );
}
