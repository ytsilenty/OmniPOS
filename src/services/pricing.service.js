// src/services/pricing.service.js — pure pricing math. No DOM, no ui imports.

import { getDB } from '../core/db.js';
import { num } from '../core/utils.js';
import { baseMoney } from '../core/money.js';

/**
 * Compute the line discount amount (in base currency) for a cart line.
 * disc: {type:'percent'|'amount', value}
 */
export function lineDiscount(price, qty, disc) {
  if (!disc) return 0;
  const gross = num(price, 0) * num(qty, 0);
  if (disc.type === 'percent') {
    return Math.min(gross, round2(gross * (num(disc.value, 0) / 100)));
  }
  if (disc.type === 'amount') {
    // value is per-line total discount (not per unit)
    return Math.max(0, Math.min(gross, num(disc.value, 0)));
  }
  return 0;
}

/**
 * Coupon discount for an order given a promotion object and order subtotal.
 * Supports percent/amount coupons with minSpend.
 */
export function couponDiscount(coupon, sub) {
  if (!coupon || !coupon.active) return 0;
  if (num(coupon.minSpend, 0) > num(sub, 0)) return 0;
  if (coupon.discountType === 'percent' || coupon.type === 'percent') {
    return round2(num(sub, 0) * (num(coupon.value, 0) / 100));
  }
  return Math.min(num(sub, 0), num(coupon.value, 0));
}

/**
 * Automatic promo discounts (bxgy / bogo / storewide percent) computed from cart items.
 * Returns { amount, promos: [names] }.
 */
export function promoDiscount(items, promotions) {
  const list = Array.isArray(promotions) ? promotions : getDB().promotions || [];
  let amount = 0;
  const promos = [];
  for (const p of list) {
    if (!p || p.active === false || p.type === 'coupon') continue;
    if (p.expires && new Date(p.expires).getTime() < Date.now()) continue;
    if (p.type === 'bogo' || p.type === 'bxgy') {
      const buyQty = p.type === 'bogo' ? 1 : num(p.buyQty, 1);
      const getQty = p.type === 'bogo' ? 1 : num(p.getQty, 1);
      if (buyQty <= 0 || getQty <= 0) continue;
      const matching = items.filter((it) => !p.productId || it.pid === p.productId);
      const totalQty = matching.reduce((s, it) => s + num(it.qty, 0), 0);
      const sets = Math.floor(totalQty / (buyQty + getQty));
      if (sets > 0) {
        const cheapest = matching.reduce((m, it) => (m === null || num(it.price, 0) < num(m.price, 0) ? it : m), null);
        if (cheapest) {
          amount += round2(Math.min(getQty * sets, totalQty) * num(cheapest.price, 0));
          promos.push(p.name);
        }
      }
    } else if (p.type === 'percent') {
      const sub = items.reduce((s, it) => s + num(it.price, 0) * num(it.qty, 0), 0);
      if (num(p.minSpend, 0) <= sub) {
        amount += round2(sub * (num(p.value, 0) / 100));
        promos.push(p.name);
      }
    }
  }
  return { amount: round2(amount), promos };
}

/**
 * Tax computation. `taxableBase` is post-discount subtotal of taxable lines.
 * If tax is inclusive, extract tax from within the amount.
 */
export function calculateTax(taxableBase, opts = {}) {
  const s = opts.settings || getDB().settings;
  const tax = s.tax || {};
  if (tax.enabled === false) return 0;
  const rate = num(opts.rate ?? tax.rate, 0) / 100;
  const base = num(taxableBase, 0);
  if (tax.inclusive) return round2(base - base / (1 + rate));
  return round2(base * rate);
}

/** Apply DB rounding rules to a total; returns the rounding adjustment (can be negative). */
export function applyRounding(total, opts = {}) {
  const s = opts.settings || getDB().settings;
  const r = s.rounding || {};
  if (r.enabled === false || r.applyTo !== 'total') return 0;
  const rounded = baseMoney(total);
  return round2(rounded - num(total, 0));
}

function round2(v) {
  return Math.round((num(v, 0) + Number.EPSILON) * 100) / 100;
}

/**
 * Calculate all totals for a cart.
 * items: [{pid, name, price, cost, qty, taxable, disc:{type,value}, variantName}]
 * opts: { coupon, orderDisc:{type,value}, settings, promotions }
 * Returns {sub, itemDisc, orderDisc, couponDisc, disc, tax, rounding, total, profit, activePromos}
 */
export function calculateTotals(items, opts = {}) {
  const list = Array.isArray(items) ? items : [];
  const s = opts.settings || getDB().settings;

  let sub = 0;
  let itemDisc = 0;
  let cost = 0;
  let taxableBase = 0;

  for (const it of list) {
    const gross = num(it.price, 0) * num(it.qty, 0);
    sub += gross;
    itemDisc += lineDiscount(it.price, it.qty, it.disc);
    cost += num(it.cost, 0) * num(it.qty, 0);
  }

  // Order-level discount applies on (sub − itemDisc)
  const afterItem = Math.max(0, round2(sub - itemDisc));
  const orderDiscAmt = (() => {
    const d = opts.orderDisc;
    if (!d) return 0;
    if (d.type === 'percent') return round2(afterItem * (num(d.value, 0) / 100));
    if (d.type === 'amount') return Math.min(afterItem, num(d.value, 0));
    return 0;
  })();

  const afterOrder = Math.max(0, round2(afterItem - orderDiscAmt));
  const couponDiscAmt = Math.min(afterOrder, couponDiscount(opts.coupon, afterOrder));
  const promo = promoDiscount(list, opts.promotions);
  const promoAmt = Math.min(Math.max(0, afterOrder - couponDiscAmt), promo.amount);

  const net = Math.max(0, round2(afterOrder - couponDiscAmt - promoAmt));

  // Taxable base: proportional share of net for taxable lines (approx by gross share)
  const taxableGross = list.reduce((sum, it) => sum + (it.taxable === false ? 0 : num(it.price, 0) * num(it.qty, 0)), 0);
  const grossTotal = list.reduce((sum, it) => sum + num(it.price, 0) * num(it.qty, 0), 0);
  const taxableShare = grossTotal > 0 ? taxableGross / grossTotal : 1;
  const tax = s.tax && s.tax.inclusive
    ? calculateTax(net, { settings: s })
    : calculateTax(round2(net * taxableShare), { settings: s });

  const preRounding = s.tax && s.tax.inclusive ? net : round2(net + tax);
  const rounding = applyRounding(preRounding, { settings: s });
  const total = round2(preRounding + rounding);

  const disc = round2(itemDisc + orderDiscAmt + couponDiscAmt + promoAmt);
  const profit = round2((s.tax && s.tax.inclusive ? net : net) - cost);

  return {
    sub: round2(sub),
    itemDisc: round2(itemDisc),
    orderDisc: round2(orderDiscAmt),
    couponDisc: round2(couponDiscAmt),
    promoDisc: promoAmt,
    disc,
    tax,
    rounding: round2(rounding),
    total,
    profit,
    activePromos: promo.promos,
  };
}
