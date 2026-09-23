// src/core/db.js — single source of truth for the DB shape + localStorage access.
// Never touch localStorage outside this module.

export const STORAGE_KEY = 'omnipos_v2';
export const SESSION_KEY = 'omnipos_session_v2';

let _db = null;

/** Default (empty) database shape — schema definition lives here. */
export function defaultDB() {
  return {
    version: 2,
    industry: 'retail',
    settings: {
      storeName: 'My Store',
      address: '',
      phone: '',
      email: '',
      taxId: '',
      logo: '',
      currency: { code: 'USD', symbol: '$', position: 'before', decimals: 2 },
      multiCurrency: { enabled: false, active: 'USD', currencies: [] },
      rounding: { enabled: true, nearest: 0.05, applyTo: 'total' },
      tax: { enabled: true, label: 'Tax', rate: 10, inclusive: false, preset: 'standard' },
      receipt: { header: '', footer: 'Thank you!', width: '80mm', emailFrom: '' },
      lowStock: 5,
      loyaltyRate: 1,
      theme: 'dark',
      autoLock: 0,
      outlets: [{ id: 'out_main', name: 'Main' }],
      outletId: 'out_main',
      receiptCounter: 0,
      invoicePrefix: 'INV',
      openHours: '',
      tableMode: false,
      serviceMode: false,
      tutorialSeen: false,
    },
    users: [],
    categories: [],
    products: [],
    customers: [],
    sales: [],
    moves: [],
    held: [],
    auditLog: [],
    suppliers: [],
    purchaseOrders: [],
    giftCards: [],
    shifts: [],
    promotions: [],
    tables: [],
  };
}

/** Load DB from localStorage into memory (parse or fall back to defaults). */
export function loadDB() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Shallow-merge top-level keys so new schema fields get defaults.
      _db = Object.assign(defaultDB(), parsed);
      _db.settings = Object.assign(defaultDB().settings, parsed.settings || {});
      return _db;
    }
  } catch (_) {
    /* corrupted storage → start fresh in memory */
  }
  _db = defaultDB();
  return _db;
}

/** Get the in-memory DB (loads lazily if needed). */
export function getDB() {
  if (!_db) loadDB();
  return _db;
}

/** Replace the in-memory DB (does not persist). */
export function setDB(db) {
  _db = db;
}

/** Persist the in-memory DB to localStorage. */
export function saveDB() {
  if (!_db) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(_db));
}

/** Append an audit log entry. */
export function audit(user, userId, action, detail) {
  const db = getDB();
  db.auditLog.unshift({ id: `aud_${db.auditLog.length + 1}_${Math.floor(Math.random() * 1e6)}`, user, userId, action, detail, at: new Date().toISOString() });
  if (db.auditLog.length > 2000) db.auditLog.length = 2000;
  saveDB();
}

// ── Session (current logged-in user id etc.) ────────────────────────────────

export function sessionGet() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

export function sessionSet(obj) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(obj));
  } catch (_) {
    /* storage disabled — session stays in memory only */
  }
}

export function sessionClear() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch (_) {
    /* ignore */
  }
}
