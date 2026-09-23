// src/services/cart.service.js — in-memory current-sale cart with pub/sub. No DOM.

import { getDB, saveDB } from '../core/db.js';
import { uid, num } from '../core/utils.js';
import { calculateTotals } from './pricing.service.js';

const _state = {
  items: [], // [{lineId, pid, vid, variantName, name, sku, price, cost, qty, unit, taxable, commission, disc}]
  customer: null, // customer object or null
  orderDisc: null, // {type:'percent'|'amount', value}
  coupon: null, // promotion object
  tableId: null,
};

const _subs = new Set();

function emit() {
  for (const fn of _subs) {
    try {
      fn();
    } catch (_) {
      /* one bad subscriber must not break the rest */
    }
  }
}

/** Subscribe to cart changes. Returns an unsubscribe function. */
export function subscribe(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

export const getItems = () => _state.items;
export const getCustomer = () => _state.customer;
export const getOrderDisc = () => _state.orderDisc;
export const getCoupon = () => _state.coupon;
export const getTableId = () => _state.tableId;

/** Add a product (or its variant) to the cart; merges with existing identical line. */
export function addItem(product, opts = {}) {
  const qty = Math.max(0.001, num(opts.qty, 1));
  const variant = opts.variantId ? (product.variants || []).find((v) => v.id === opts.variantId) : null;
  const price = variant ? num(variant.price, num(product.price, 0)) : num(product.price, 0);
  const key = `${product.id}|${variant ? variant.id : ''}`;

  const existing = _state.items.find((it) => it.pid === product.id && (it.vid || '') === (variant ? variant.id : ''));
  if (existing) {
    existing.qty = num(existing.qty, 0) + qty;
  } else {
    _state.items.push({
      lineId: uid('ln'),
      _key: key,
      pid: product.id,
      vid: variant ? variant.id : null,
      variantName: variant ? variant.name : null,
      name: product.name + (variant ? ` — ${variant.name}` : ''),
      sku: variant ? variant.sku || product.sku : product.sku,
      price,
      cost: num(product.cost, 0),
      qty,
      unit: product.unit || 'pcs',
      taxable: product.taxable !== false,
      commission: num(product.commission, 0),
      disc: null,
    });
  }
  emit();
}

/** Add a freehand/custom line item (open price). */
export function addCustomItem({ name, price, qty = 1 }) {
  _state.items.push({
    lineId: uid('ln'),
    pid: null,
    vid: null,
    variantName: null,
    name: String(name || 'Custom item'),
    sku: '',
    price: num(price, 0),
    cost: 0,
    qty: Math.max(0.001, num(qty, 1)),
    unit: 'pcs',
    taxable: true,
    commission: 0,
    disc: null,
  });
  emit();
}

function findLine(lineId) {
  return _state.items.find((it) => it.lineId === lineId);
}

export function setQty(lineId, qty) {
  const it = findLine(lineId);
  if (!it) return;
  const q = num(qty, 0);
  if (q <= 0) {
    removeItem(lineId);
    return;
  }
  it.qty = q;
  emit();
}

export function incrementQty(lineId, by = 1) {
  const it = findLine(lineId);
  if (!it) return;
  setQty(lineId, num(it.qty, 0) + by);
}

export function decrementQty(lineId, by = 1) {
  const it = findLine(lineId);
  if (!it) return;
  setQty(lineId, num(it.qty, 0) - by);
}

export function setPrice(lineId, price) {
  const it = findLine(lineId);
  if (!it) return;
  it.price = Math.max(0, num(price, 0));
  emit();
}

/** Set a per-line discount: {type:'percent'|'amount', value}. Pass null to clear. */
export function setLineDiscount(lineId, disc) {
  const it = findLine(lineId);
  if (!it) return;
  it.disc = disc && (disc.type === 'percent' || disc.type === 'amount') ? { type: disc.type, value: num(disc.value, 0) } : null;
  emit();
}

export function removeItem(lineId) {
  const idx = _state.items.findIndex((it) => it.lineId === lineId);
  if (idx >= 0) {
    _state.items.splice(idx, 1);
    emit();
  }
}

/** Clear the whole cart (items + customer + discounts). */
export function clear() {
  _state.items = [];
  _state.customer = null;
  _state.orderDisc = null;
  _state.coupon = null;
  _state.tableId = null;
  emit();
}

export function setCustomer(customer) {
  _state.customer = customer || null;
  emit();
}

/** Set order-level discount: {type, value} or null to clear. */
export function setOrderDiscount(disc) {
  _state.orderDisc = disc && (disc.type === 'percent' || disc.type === 'amount') ? { type: disc.type, value: num(disc.value, 0) } : null;
  emit();
}

/** Attach a coupon promotion object (looked up by code elsewhere), or null to clear. */
export function setCoupon(coupon) {
  _state.coupon = coupon || null;
  emit();
}

export function setTable(tableId) {
  _state.tableId = tableId || null;
  emit();
}

/** Totals for the current cart state. */
export function totals() {
  return calculateTotals(_state.items, {
    orderDisc: _state.orderDisc,
    coupon: _state.coupon,
  });
}

/** Hold the current cart as a named ticket in db.held, then clear the cart. */
export function hold(name) {
  if (!_state.items.length) return null;
  const db = getDB();
  const ticket = {
    id: uid('hold'),
    name: String(name || `Order ${db.held.length + 1}`).slice(0, 60),
    at: new Date().toISOString(),
    items: JSON.parse(JSON.stringify(_state.items)),
    customerId: _state.customer ? _state.customer.id : null,
    orderDisc: _state.orderDisc ? { ..._state.orderDisc } : null,
    coupon: _state.coupon ? { ..._state.coupon } : null,
    tableId: _state.tableId,
  };
  db.held.unshift(ticket);
  saveDB();
  clear();
  return ticket;
}

/** Recall a held ticket by id, replacing the current cart contents. */
export function recall(holdId) {
  const db = getDB();
  const idx = db.held.findIndex((h) => h.id === holdId);
  if (idx < 0) return false;
  const ticket = db.held[idx];
  db.held.splice(idx, 1);
  saveDB();

  _state.items = JSON.parse(JSON.stringify(ticket.items || []));
  _state.orderDisc = ticket.orderDisc || null;
  _state.coupon = ticket.coupon || null;
  _state.tableId = ticket.tableId || null;
  _state.customer = ticket.customerId ? (db.customers || []).find((c) => c.id === ticket.customerId) || null : null;
  emit();
  return true;
}

/** Immutable snapshot of the cart for passing into sale completion. */
export function snapshot() {
  return {
    items: JSON.parse(JSON.stringify(_state.items)),
    customer: _state.customer ? { ..._state.customer } : null,
    orderDisc: _state.orderDisc ? { ..._state.orderDisc } : null,
    coupon: _state.coupon ? { ..._state.coupon } : null,
    tableId: _state.tableId,
    totals: totals(),
  };
}
