// src/ui/views/register/cart-panel.js — right-hand cart: customer, lines, totals, charge.

import { esc, num } from '../../../core/utils.js';
import { money } from '../../../core/money.js';

/**
 * Render the cart panel into el (replaces content). All interaction is delegated
 * through data-action attributes; handlers are passed via opts and stored on el
 * so re-renders never stack listeners.
 *
 * opts: { items, customer, totals, orderDisc, coupon,
 *         onQtyChange(lineId, qty), onRemove(lineId), onClear(), onHold(), onRecall(),
 *         onCharge(), onPickCustomer(), onRemoveCustomer(), onDiscount() }
 */
export function renderCartPanel(el, opts) {
  const { items = [], customer = null, totals = {}, orderDisc = null, coupon = null } = opts;

  // ── Header ──────────────────────────────────────────────────────
  const head = [];
  head.push('<div class="cart-head">');
  head.push('<span class="cart-title">Current Sale</span>');
  head.push('<span class="cart-actions">');
  head.push('<button class="btn sm ghost" type="button" data-action="disc">' + (orderDisc ? '−' : '') + '% Disc</button>');
  head.push('<button class="btn sm ghost" type="button" data-action="hold">Hold</button>');
  head.push('<button class="btn sm ghost" type="button" data-action="recall">Recall</button>');
  head.push('<button class="btn sm ghost" type="button" data-action="clear">Clear</button>');
  head.push('</span></div>');

  // ── Customer row ────────────────────────────────────────────────
  const cust = [];
  cust.push('<div class="cart-cust">');
  if (customer) {
    cust.push(
      '<span class="cust-chip">👤 ' + esc(customer.name) +
        (num(customer.points, 0) > 0 ? ' <span class="cp-points">(' + num(customer.points, 0) + ' pts)</span>' : '') +
        '<button type="button" data-action="remove-customer" aria-label="Remove customer">✕</button></span>'
    );
  } else {
    cust.push('<button class="btn sm ghost" type="button" data-action="pick-customer">+ Add customer</button>');
  }
  if (coupon) {
    cust.push('<span class="cust-chip">🎟 ' + esc(coupon.code || coupon.name || '') + '</span>');
  }
  cust.push('</div>');

  // ── Lines ───────────────────────────────────────────────────────
  const lines = [];
  lines.push('<div class="cart-items">');
  if (!items.length) {
    lines.push('<div class="cart-empty">Cart is empty.<br>Tap a product or scan to add.</div>');
  } else {
    for (const it of items) {
      const lineTotal = num(it.price, 0) * num(it.qty, 0) - (it.disc ? lineDiscAmt(it) : 0);
      lines.push(
        '<div class="citem" data-line="' + esc(it.lineId) + '">' +
          '<div class="citem-main">' +
            '<div class="citem-name">' + esc(it.name) + '</div>' +
            '<div class="citem-unit">' + esc(money(num(it.price, 0))) + ' / ' + esc(it.unit || 'pcs') +
              (it.disc ? ' · disc −' + esc(money(lineDiscAmt(it))) : '') + '</div>' +
          '</div>' +
          '<span class="cqty">' +
            '<button type="button" data-action="dec" aria-label="Decrease">−</button>' +
            '<input class="qty-in" inputmode="decimal" value="' + esc(fmtQty(num(it.qty, 0))) + '" aria-label="Quantity">' +
            '<button type="button" data-action="inc" aria-label="Increase">+</button>' +
          '</span>' +
          '<span class="citem-total">' + esc(money(Math.max(0, lineTotal))) + '</span>' +
          '<button class="citem-rm" type="button" data-action="rm" aria-label="Remove">✕</button>' +
        '</div>'
      );
    }
  }
  lines.push('</div>');

  // ── Totals footer ───────────────────────────────────────────────
  const foot = [];
  foot.push('<div class="cart-foot">');
  foot.push(row('Subtotal', money(totals.sub || 0)));
  if (num(totals.itemDisc, 0) > 0) foot.push(row('Item discounts', '−' + money(totals.itemDisc), true));
  if (num(totals.orderDisc, 0) > 0) foot.push(row('Order discount', '−' + money(totals.orderDisc), true));
  if (num(totals.couponDisc, 0) > 0) foot.push(row('Coupon', '−' + money(totals.couponDisc), true));
  if (num(totals.promoDisc, 0) > 0) foot.push(row('Promotions', '−' + money(totals.promoDisc), true));
  if (num(totals.tax, 0) !== 0) foot.push(row('Tax', money(totals.tax)));
  if (num(totals.rounding, 0) !== 0) foot.push(row('Rounding', (totals.rounding < 0 ? '−' : '+') + money(Math.abs(totals.rounding))));
  foot.push('<div class="trow trow--total"><span>TOTAL</span><span>' + esc(money(totals.total || 0)) + '</span></div>');
  foot.push('<button class="btn ok charge-btn" type="button" data-action="charge"' + (items.length ? '' : ' disabled') + '>💳 Charge ' + esc(money(totals.total || 0)) + '</button>');
  foot.push('</div>');

  el.innerHTML = head.join('') + cust.join('') + lines.join('') + foot.join('');

  // ── Delegation (single listener, latest handlers) ───────────────
  el._cpHandlers = opts;
  if (!el._cpBound) {
    el._cpBound = true;

    el.addEventListener('click', (e) => {
      const h = el._cpHandlers;
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const lineEl = btn.closest('[data-line]');
      const lineId = lineEl ? lineEl.dataset.line : null;
      switch (action) {
        case 'inc': if (h.onQtyChange && lineId) incLine(h, lineId, 1); break;
        case 'dec': if (h.onQtyChange && lineId) incLine(h, lineId, -1); break;
        case 'rm': if (h.onRemove && lineId) h.onRemove(lineId); break;
        case 'clear': if (h.onClear) h.onClear(); break;
        case 'hold': if (h.onHold) h.onHold(); break;
        case 'recall': if (h.onRecall) h.onRecall(); break;
        case 'charge': if (h.onCharge) h.onCharge(); break;
        case 'pick-customer': if (h.onPickCustomer) h.onPickCustomer(); break;
        case 'remove-customer': if (h.onRemoveCustomer) h.onRemoveCustomer(); break;
        case 'disc': if (h.onDiscount) h.onDiscount(); break;
        default: break;
      }
    });

    el.addEventListener('change', (e) => {
      const h = el._cpHandlers;
      const input = e.target.closest('.qty-in');
      if (!input) return;
      const lineEl = input.closest('[data-line]');
      if (!lineEl || !h.onQtyChange) return;
      const q = num(input.value, 0);
      if (q > 0) h.onQtyChange(lineEl.dataset.line, q);
    });

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.classList.contains('qty-in')) e.target.blur();
    });
  }
}

function incLine(h, lineId, delta) {
  const item = (h.items || []).find((it) => it.lineId === lineId);
  if (!item) return;
  h.onQtyChange(lineId, Math.max(0, num(item.qty, 0) + delta));
}

function lineDiscAmt(it) {
  const gross = num(it.price, 0) * num(it.qty, 0);
  if (!it.disc) return 0;
  if (it.disc.type === 'percent') return Math.min(gross, gross * (num(it.disc.value, 0) / 100));
  return Math.min(gross, num(it.disc.value, 0));
}

function row(label, value, isDisc) {
  return '<div class="trow' + (isDisc ? ' trow--disc' : '') + '"><span>' + esc(label) + '</span><span>' + esc(value) + '</span></div>';
}

function fmtQty(n) {
  return n === Math.floor(n) ? String(n) : String(Math.round(n * 100) / 100);
}
