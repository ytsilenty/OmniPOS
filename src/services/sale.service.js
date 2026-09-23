// src/services/sale.service.js — sale completion / refund logic. No DOM.

import { getDB, saveDB } from '../core/db.js';
import { uid, num } from '../core/utils.js';
import { calculateTotals } from './pricing.service.js';

function round2(v) {
  return Math.round((num(v, 0) + Number.EPSILON) * 100) / 100;
}

/** Next human-readable sale number: INV000123 style using settings.invoicePrefix + counter. */
function nextSaleNo(db) {
  db.settings.receiptCounter = num(db.settings.receiptCounter, 0) + 1;
  const prefix = String(db.settings.invoicePrefix || 'INV');
  return prefix + String(db.settings.receiptCounter).padStart(6, '0');
}

/**
 * Complete a sale.
 * payload: { cart, totals, payments, change, user, shift }
 *   cart: snapshot from cart.service (items/customer/orderDisc/coupon/tableId) OR raw items array
 *   totals: from pricing.calculateTotals (recomputed defensively if missing)
 *   payments: [{method, amount, giftId?}] in base currency
 * Returns the stored sale object.
 */
export function completeSale({ cart, totals, payments, change, user, shift }) {
  const db = getDB();
  const items = Array.isArray(cart) ? cart : cart.items || [];
  const customer = Array.isArray(cart) ? null : cart.customer || null;
  const coupon = Array.isArray(cart) ? null : cart.coupon || null;
  const tableId = Array.isArray(cart) ? null : cart.tableId || null;

  const t = totals && typeof totals.total === 'number' ? totals : calculateTotals(items, { coupon });
  const tenders = (payments || []).map((p) => ({ method: String(p.method || 'cash'), amount: round2(p.amount) })).filter((p) => p.amount > 0);
  const paid = round2(tenders.reduce((s, p) => s + p.amount, 0));

  const sale = {
    id: uid('sale'),
    no: nextSaleNo(db),
    items: items.map((it) => ({
      lineId: it.lineId || uid('ln'),
      pid: it.pid || null,
      vid: it.vid || null,
      variantName: it.variantName || null,
      name: it.name,
      sku: it.sku || '',
      price: round2(it.price),
      cost: round2(it.cost),
      qty: num(it.qty, 0),
      unit: it.unit || 'pcs',
      taxable: it.taxable !== false,
      commission: num(it.commission, 0),
      disc: it.disc ? { type: it.disc.type, value: num(it.disc.value, 0) } : null,
    })),
    sub: t.sub,
    disc: t.disc,
    itemDisc: t.itemDisc,
    orderDisc: t.orderDisc,
    couponDisc: t.couponDisc,
    tax: t.tax,
    rounding: t.rounding,
    total: t.total,
    profit: t.profit,
    payments: tenders,
    change: round2(num(change, 0)),
    customerId: customer ? customer.id : null,
    customerName: customer ? customer.name : '',
    userId: user ? user.id : null,
    userName: user ? user.name : '',
    outletId: db.settings.outletId,
    tableId: tableId || null,
    shiftId: shift ? shift.id : null,
    coupon: coupon ? coupon.code || coupon.name : null,
    at: new Date().toISOString(),
    status: 'completed',
  };

  db.sales.unshift(sale);

  // Stock decrements + inventory moves
  for (const it of sale.items) {
    if (!it.pid) continue;
    const product = db.products.find((p) => p.id === it.pid);
    if (!product || product.trackStock === false || product.isService) continue;
    product.stock = round2(num(product.stock, 0) - it.qty);
    db.moves.unshift({ id: uid('mv'), pid: it.pid, qty: -it.qty, type: 'sale', ref: sale.no, userId: sale.userId, at: sale.at });
  }

  // Customer stats + loyalty points
  if (customer) {
    const c = db.customers.find((x) => x.id === customer.id);
    if (c) {
      c.totalSpent = round2(num(c.totalSpent, 0) + sale.total);
      const earned = Math.floor(sale.total * num(db.settings.loyaltyRate, 0) / 100);
      c.points = Math.max(0, num(c.points, 0) + earned);
    }
  }

  // Gift card payments draw down balance
  for (const p of sale.payments) {
    if (p.method === 'gift' && p.giftId) {
      const gc = (db.giftCards || []).find((g) => g.id === p.giftId);
      if (gc) gc.balance = round2(Math.max(0, num(gc.balance, 0) - p.amount));
    }
  }

  // Shift tallies
  if (shift && !shift.closedAt) {
    shift.salesCount = num(shift.salesCount, 0) + 1;
    shift.salesTotal = round2(num(shift.salesTotal, 0) + sale.total);
    const cashPaid = sale.payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0);
    shift.expectedCash = round2(num(shift.openingCash, 0) + cashPaid - num(sale.change, 0));
  }

  db.auditLog.unshift({ id: uid('aud'), user: sale.userName, userId: sale.userId, action: 'sale.complete', detail: `${sale.no} — ${paid} tendered`, at: sale.at });
  saveDB();
  return sale;
}

/**
 * Refund a completed sale: restores stock, reverses customer spend/points, marks sale refunded.
 */
export function refundSale(saleId, user) {
  const db = getDB();
  const sale = db.sales.find((s) => s.id === saleId);
  if (!sale || sale.status === 'refunded') return null;

  sale.status = 'refunded';
  sale.refundedAt = new Date().toISOString();
  sale.refundedBy = user ? user.name : '';

  for (const it of sale.items) {
    if (!it.pid) continue;
    const product = db.products.find((p) => p.id === it.pid);
    if (!product || product.trackStock === false || product.isService) continue;
    product.stock = round2(num(product.stock, 0) + it.qty);
    db.moves.unshift({ id: uid('mv'), pid: it.pid, qty: it.qty, type: 'refund', ref: sale.no, userId: user ? user.id : null, at: sale.refundedAt });
  }

  if (sale.customerId) {
    const c = db.customers.find((x) => x.id === sale.customerId);
    if (c) {
      c.totalSpent = Math.max(0, round2(num(c.totalSpent, 0) - sale.total));
      const reversal = Math.floor(sale.total * num(db.settings.loyaltyRate, 0) / 100);
      c.points = Math.max(0, num(c.points, 0) - reversal);
    }
  }

  db.auditLog.unshift({ id: uid('aud'), user: user ? user.name : '', userId: user ? user.id : null, action: 'sale.refund', detail: sale.no, at: sale.refundedAt });
  saveDB();
  return sale;
}
