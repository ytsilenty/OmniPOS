// src/ui/views/register/payment-modal.js — multi-tender payment + receipt.

import { esc, num } from '../../../core/utils.js';
import { money, activeCur, toActive, fromActive } from '../../../core/money.js';
import { getDB, saveDB } from '../../../core/db.js';
import { modal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { completeSale } from '../../../services/sale.service.js';

const METHODS = [
  { id: 'cash', label: '💵 Cash' },
  { id: 'card', label: '💳 Card' },
  { id: 'mobile', label: '📱 Mobile' },
  { id: 'credit', label: '📒 Credit' },
  { id: 'gift', label: '🎁 Gift Card' },
  { id: 'points', label: '⭐ Points' },
];

function round2(v) {
  return Math.round((num(v, 0) + Number.EPSILON) * 100) / 100;
}

/** Build a plain-text receipt for the completed sale (all values escaped by caller usage). */
export function receiptHTML(sale) {
  const db = getDB();
  const s = db.settings;
  const W = 32;
  const lines = [];
  const center = (t) => {
    const str = String(t);
    const pad = Math.max(0, Math.floor((W - str.length) / 2));
    return ' '.repeat(pad) + str;
  };
  const kv = (k, v) => {
    const str = String(k);
    const val = String(v);
    return str.length + val.length + 1 > W ? str + '\n' + ' '.repeat(W - val.length) + val : str + ' '.repeat(Math.max(1, W - str.length - val.length)) + val;
  };
  lines.push(center(s.storeName || 'Store'));
  if (s.receipt.header) lines.push(center(s.receipt.header));
  lines.push(center('─'.repeat(W)));
  lines.push(kv('Receipt #', sale.no));
  lines.push(kv('Date', new Date(sale.at).toLocaleString()));
  lines.push(kv('Cashier', sale.userName || ''));
  if (sale.customerName) lines.push(kv('Customer', sale.customerName));
  lines.push(center('─'.repeat(W)));
  for (const it of sale.items) {
    lines.push(it.name);
    lines.push('  ' + kv(num(it.qty) + ' x ' + money(it.price), money(round2(it.price * it.qty))));
  }
  lines.push(center('─'.repeat(W)));
  lines.push(kv('Subtotal', money(sale.sub)));
  if (num(sale.disc, 0) > 0) lines.push(kv('Discount', '-' + money(sale.disc)));
  if (num(sale.tax, 0) !== 0) lines.push(kv(s.tax.enabled === false ? 'Tax' : s.tax.label + ' (' + num(s.tax.rate, 0) + '%)', money(sale.tax)));
  if (num(sale.rounding, 0) !== 0) lines.push(kv('Rounding', money(sale.rounding)));
  lines.push(kv('TOTAL', money(sale.total)));
  for (const p of sale.payments) {
    const mth = METHODS.find((m) => m.id === p.method);
    lines.push(kv((mth ? mth.label.replace(/^\S+\s/, '') : p.method).toUpperCase(), money(p.amount)));
  }
  if (num(sale.change, 0) > 0) lines.push(kv('CHANGE', money(sale.change)));
  lines.push(center('─'.repeat(W)));
  if (s.receipt.footer) lines.push(center(s.receipt.footer));
  return '<div class="receipt" id="print-area">' + esc(lines.join('\n')) + '</div>';
}

/**
 * Open the payment modal.
 * opts: { cart (snapshot), totals, user, onComplete(sale) }
 */
export function openPaymentModal({ cart, totals, user, onComplete }) {
  const db = getDB();
  const totalDue = round2(totals.total);
  const payments = []; // [{method, amount(base), giftId?, label}]
  let method = 'cash';

  const bodyParts = [];
  bodyParts.push('<div class="pay-due">Due: ' + esc(money(totalDue)) + '</div>');
  bodyParts.push('<div class="pay-methods" id="pm-tabs"></div>');
  bodyParts.push('<div id="pm-extra"></div>');
  bodyParts.push('<div class="pay-input-row">');
  bodyParts.push('<input class="input" id="pm-amount" inputmode="decimal" placeholder="Amount">');
  bodyParts.push('<button class="btn primary" type="button" data-action="add-pay">Add</button>');
  bodyParts.push('</div>');
  bodyParts.push('<div class="quick" id="pm-quick"></div>');
  bodyParts.push('<div class="tenders" id="pm-tenders"></div>');
  bodyParts.push('<div class="pay-status"><span>Paid: <b id="pm-paid">' + esc(money(0)) + '</b></span><span id="pm-remain"></span></div>');

  const footerParts = [];
  footerParts.push('<button class="btn ghost" type="button" data-action="modal-close">Cancel</button>');
  footerParts.push('<button class="btn ok" type="button" data-action="complete" id="pm-complete" disabled>Complete Sale</button>');

  const m = modal('Payment', bodyParts.join(''), footerParts.join(''), { wide: true });
  const el = m.el;

  const tabsEl = el.querySelector('#pm-tabs');
  const extraEl = el.querySelector('#pm-extra');
  const amtEl = el.querySelector('#pm-amount');
  const quickEl = el.querySelector('#pm-quick');
  const tendersEl = el.querySelector('#pm-tenders');
  const paidEl = el.querySelector('#pm-paid');
  const remainEl = el.querySelector('#pm-remain');
  const completeBtn = el.querySelector('#pm-complete');

  function renderTabs() {
    const parts = [''];
    for (const mm of METHODS) {
      parts.push('<button class="pm' + (mm.id === method ? ' pm--active' : '') + '" type="button" data-method="' + esc(mm.id) + '">' + esc(mm.label) + '</button>');
    }
    tabsEl.innerHTML = parts.join('');
  }

  function renderQuick() {
    const cur = activeCur();
    const dueActive = toActive(remaining());
    const parts = [''];
    const q = (label, activeAmt) => '<button class="qbtn" type="button" data-q="' + esc(String(activeAmt)) + '">' + esc(label) + '</button>';
    parts.push(q('Exact', Math.max(0, dueActive)));
    const ru = Math.ceil(dueActive);
    parts.push(q('Round up', Math.max(0, ru)));
    for (const n of [5, 10, 20, 50, 100]) parts.push(q(cur.symbol + n, n));
    quickEl.innerHTML = parts.join('');
  }

  function renderExtra() {
    if (method === 'gift') {
      extraEl.innerHTML = '<input class="input" id="pm-giftcode" placeholder="Gift card code" style="margin-bottom:8px">';
    } else if (method === 'points') {
      const pts = cart.customer ? num(cart.customer.points, 0) : 0;
      extraEl.innerHTML = '<p class="cp-meta" style="margin:0 0 8px">Available points: ' + num(pts, 0) + ' (1 pt = ' + esc(money(0.01)) + ')</p>';
    } else {
      extraEl.innerHTML = '';
    }
  }

  function paidBase() {
    return round2(payments.reduce((s, p) => s + p.amount, 0));
  }

  function remaining() {
    return round2(Math.max(0, totalDue - paidBase()));
  }

  function renderTenders() {
    const parts = [''];
    for (let i = 0; i < payments.length; i++) {
      const p = payments[i];
      const lbl = (METHODS.find((mm) => mm.id === p.method) || { label: p.method }).label;
      parts.push(
        '<div class="tender"><span>' + esc(lbl) + (p.note ? ' · ' + esc(p.note) : '') + '</span>' +
          '<span>' + esc(money(p.amount)) + ' <button type="button" data-rm="' + i + '" aria-label="Remove tender">✕</button></span></div>'
      );
    }
    tendersEl.innerHTML = parts.join('');
    const rem = remaining();
    const change = round2(Math.max(0, paidBase() - totalDue));
    paidEl.textContent = money(paidBase());
    if (rem > 0) {
      remainEl.innerHTML = '<span class="neg">Remaining: ' + esc(money(rem)) + '</span>';
    } else {
      remainEl.innerHTML = '<span class="pos">Change: ' + esc(money(change)) + '</span>';
    }
    completeBtn.disabled = rem > 0.004;
    renderQuick();
  }

  function validateAndBuild(amountActive) {
    const base = round2(fromActive(amountActive));
    if (base <= 0) {
      toast('Enter an amount', 'warn');
      return null;
    }
    if (method === 'credit') {
      if (!cart.customer) {
        toast('Credit requires a customer', 'bad');
        return null;
      }
    }
    if (method === 'gift') {
      const codeEl = el.querySelector('#pm-giftcode');
      const code = String((codeEl && codeEl.value) || '').trim().toLowerCase();
      if (!code) {
        toast('Enter the gift card code', 'bad');
        return null;
      }
      const gc = (db.giftCards || []).find((g) => String(g.code).toLowerCase() === code);
      if (!gc) {
        toast('Gift card not found', 'bad');
        return null;
      }
      if (gc.expires && new Date(gc.expires).getTime() < Date.now()) {
        toast('Gift card expired', 'bad');
        return null;
      }
      const avail = Math.min(num(gc.balance, 0), remaining());
      if (avail <= 0) {
        toast('Gift card has no balance', 'bad');
        return null;
      }
      return { method, amount: avail, giftId: gc.id, note: gc.code };
    }
    if (method === 'points') {
      if (!cart.customer) {
        toast('Points require a customer', 'bad');
        return null;
      }
      const ptsAvail = num(cart.customer.points, 0);
      const maxByPts = round2(ptsAvail * 0.01); // 1 pt = 0.01 base
      const capped = Math.min(base, maxByPts, remaining());
      if (capped <= 0) {
        toast('Not enough points', 'bad');
        return null;
      }
      const usedPts = Math.ceil(capped / 0.01);
      return { method, amount: capped, pointsUsed: usedPts, note: usedPts + ' pts' };
    }
    return { method, amount: base };
  }

  function addPayment(amountActive) {
    const built = validateAndBuild(amountActive);
    if (!built) return;
    payments.push(built);
    renderTenders();
  }

  renderTabs();
  renderExtra();
  renderTenders();
  setTimeout(() => amtEl.focus(), 50);

  el.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-method]');
    if (tab) {
      method = tab.dataset.method;
      renderTabs();
      renderExtra();
      return;
    }
    const qb = e.target.closest('[data-q]');
    if (qb) {
      const v = num(qb.dataset.q, 0);
      amtEl.value = v > 0 ? String(round2(v)) : '';
      addPayment(v);
      amtEl.value = '';
      amtEl.focus();
      return;
    }
    const rm = e.target.closest('[data-rm]');
    if (rm) {
      payments.splice(num(rm.dataset.rm, 0), 1);
      renderTenders();
      return;
    }
    const act = e.target.closest('[data-action]');
    if (!act) return;
    if (act.dataset.action === 'add-pay') {
      const v = num(amtEl.value, 0);
      if (v <= 0) return toast('Enter an amount', 'warn');
      addPayment(v);
      amtEl.value = '';
      amtEl.focus();
    } else if (act.dataset.action === 'complete') {
      doComplete();
    }
  });

  amtEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = num(amtEl.value, 0);
      if (v > 0) {
        addPayment(v);
        amtEl.value = '';
      }
    }
  });

  function doComplete() {
    if (remaining() > 0.004) return toast('Insufficient payment', 'bad');
    const change = round2(Math.max(0, paidBase() - totalDue));
    const shift = (db.shifts || []).find((sh) => sh.userId === (user && user.id) && !sh.closedAt) || null;

    let sale;
    try {
      sale = completeSale({ cart, totals, payments: payments.map((p) => ({ method: p.method, amount: p.amount, giftId: p.giftId })), change, user, shift });
    } catch (err) {
      toast('Failed to record sale: ' + (err && err.message ? err.message : 'error'), 'bad');
      return;
    }

    // Deduct redeemed points from the customer record
    const ptsUsed = payments.reduce((s, p) => s + num(p.pointsUsed, 0), 0);
    if (ptsUsed > 0 && sale.customerId) {
      const c = db.customers.find((x) => x.id === sale.customerId);
      if (c) {
        c.points = Math.max(0, num(c.points, 0) - ptsUsed);
        saveDB();
      }
    }

    // Swap modal content to the receipt
    const body = el.querySelector('.modal-body');
    const foot = el.querySelector('.modal-foot');
    body.innerHTML = receiptHTML(sale);
    foot.innerHTML =
      '<button class="btn ghost" type="button" data-action="modal-close">Close</button>' +
      '<button class="btn primary" type="button" data-action="print">🖨 Print</button>';
    if (typeof onComplete === 'function') onComplete(sale);
  }

  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="print"]')) window.print();
  });
}
