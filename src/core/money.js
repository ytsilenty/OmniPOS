// src/core/money.js — currency formatting & conversion. All display goes through money().

import { getDB } from './db.js';
import { num } from './utils.js';

let _getDb = getDB;

/** Allow tests / boot to override the DB getter. */
export function setDbGetter(fn) {
  _getDb = fn;
}

function settings() {
  try {
    return _getDb().settings;
  } catch (_) {
    return null;
  }
}

/** The active currency descriptor {code, symbol, position, decimals}. */
export function activeCur() {
  const s = settings();
  if (!s) return { code: 'USD', symbol: '$', position: 'before', decimals: 2 };
  if (s.multiCurrency && s.multiCurrency.enabled) {
    const cur = (s.multiCurrency.currencies || []).find((c) => c.code === s.multiCurrency.active);
    if (cur) return cur;
  }
  return s.currency || { code: 'USD', symbol: '$', position: 'before', decimals: 2 };
}

/** Format a base-currency amount into the active currency's string form. */
export function money(amount) {
  const cur = activeCur();
  const v = toActive(num(amount, 0));
  const s = Math.abs(v).toFixed(cur.decimals ?? 2);
  return cur.position === 'after' ? `${s} ${cur.symbol}` : `${cur.symbol}${s}`;
}

/** Convert a base-currency amount to an active-currency numeric value. */
export function toActive(baseAmount) {
  const s = settings();
  if (!s || !s.multiCurrency || !s.multiCurrency.enabled) return num(baseAmount, 0);
  const cur = (s.multiCurrency.currencies || []).find((c) => c.code === s.multiCurrency.active);
  if (!cur || !num(cur.rate, 1)) return num(baseAmount, 0);
  return num(baseAmount, 0) * num(cur.rate, 1);
}

/** Convert an active-currency amount back to base currency. */
export function fromActive(amount) {
  const s = settings();
  if (!s || !s.multiCurrency || !s.multiCurrency.enabled) return num(amount, 0);
  const cur = (s.multiCurrency.currencies || []).find((c) => c.code === s.multiCurrency.active);
  if (!cur || !num(cur.rate, 1)) return num(amount, 0);
  return num(amount, 0) / num(cur.rate, 1);
}

/** Round a base amount per DB rounding settings (returns base units). */
export function baseMoney(amount) {
  const s = settings();
  const v = num(amount, 0);
  if (!s || !s.rounding || !s.rounding.enabled) {
    return Math.round(v * 100) / 100;
  }
  const nearest = num(s.rounding.nearest, 0);
  if (nearest <= 0) return Math.round(v * 100) / 100;
  return Math.round(v / nearest) * nearest;
}
