// src/ui/views/register/register.view.js — the checkout screen.
// Left: search + category chips + product grid. Right: live cart panel.

import { $, esc, num } from '../../../core/utils.js';
import { getDB, saveDB } from '../../../core/db.js';
import { money } from '../../../core/money.js';
import { toast } from '../../components/toast.js';
import { modal, closeModal } from '../../components/modal.js';
import * as Cart from '../../../services/cart.service.js';
import { renderProductGrid } from './product-grid.js';
import { renderCartPanel } from './cart-panel.js';
import { openPaymentModal } from './payment-modal.js';
import { openCustomerPicker } from './customer-picker.js';

/**
 * Mount the register view into container (idempotent — replaces content).
 * opts: { user, onCheckout(sale) }
 * Returns { unmount }.
 */
export function mountRegister(container, { user, onCheckout } = {}) {
  // Tear down a previous instance mounted on this same container.
  if (container._registerUnmount && typeof container._registerUnmount === 'function') {
    container._registerUnmount();
  }

  const ac = new AbortController();
  const db = getDB();
  const state = { q: '', categoryId: null };

  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'register';
  const parts = [];
  parts.push('<section class="products-pane">');
  parts.push('<div class="scan"><input class="input" id="reg-search" placeholder="Search or scan barcode… (F2)" autocomplete="off"></div>');
  parts.push('<div id="reg-grid"></div>');
  parts.push('</section>');
  parts.push('<aside class="cart-pane" id="reg-cart"></aside>');
  root.innerHTML = parts.join('');
  container.appendChild(root);

  const searchEl = $('#reg-search', root);
  const gridEl = $('#reg-grid', root);
  const cartEl = $('#reg-cart', root);

  // ── Rendering ───────────────────────────────────────────────────

  function renderAll() {
    const d = getDB();
    renderProductGrid(gridEl, {
      products: d.products || [],
      categories: d.categories || [],
      filter: { q: state.q, categoryId: state.categoryId },
      onAdd: (product) => Cart.addItem(product),
      onCategory: (catId) => {
        state.categoryId = catId === 'all' ? null : catId;
        renderAll();
      },
    });
    renderCartPanel(cartEl, {
      items: Cart.getItems(),
      customer: Cart.getCustomer(),
      orderDisc: Cart.getOrderDisc(),
      coupon: Cart.getCoupon(),
      totals: Cart.totals(),
      onQtyChange: (lineId, qty) => Cart.setQty(lineId, qty),
      onRemove: (lineId) => Cart.removeItem(lineId),
      onClear: () => {
        if (!Cart.getItems().length) return;
        Cart.clear();
        toast('Cart cleared');
      },
      onHold: doHold,
      onRecall: doRecall,
      onCharge: doCharge,
      onPickCustomer: () =>
        openCustomerPicker({
          customers: getDB().customers || [],
          onPick: (c) => {
            Cart.setCustomer(c);
            toast('Customer: ' + c.name, 'ok');
          },
        }),
      onRemoveCustomer: () => Cart.setCustomer(null),
      onDiscount: doOrderDiscount,
    });
  }

  // ── Actions ─────────────────────────────────────────────────────

  function doHold() {
    if (!Cart.getItems().length) return toast('Cart is empty', 'warn');
    const d = getDB();
    const ticket = Cart.hold('Order ' + (d.held.length + 1));
    if (ticket) toast('Held: ' + ticket.name, 'ok');
  }

  function doRecall() {
    const d = getDB();
    const held = d.held || [];
    if (!held.length) return toast('No held orders', 'warn');
    const body = [''];
    for (const h of held) {
      const t = h.items.reduce((s, it) => s + num(it.qty, 0), 0);
      body.push(
        '<div class="cp-item" data-hid="' + esc(h.id) + '">' +
          '<div><div class="cp-name">' + esc(h.name) + '</div>' +
          '<div class="cp-meta">' + esc(new Date(h.at).toLocaleTimeString()) + ' · ' + num(t, 0) + ' items</div></div>' +
          '<button class="btn sm danger" type="button" data-del="' + esc(h.id) + '" aria-label="Delete held order">✕</button>' +
        '</div>'
      );
    }
    const m = modal('Recall Held Order', '<div class="cp-list">' + body.join('') + '</div>', '<button class="btn ghost" type="button" data-action="modal-close">Cancel</button>');
    m.el.addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      if (del) {
        const dd = getDB();
        dd.held = (dd.held || []).filter((h) => h.id !== del.dataset.del);
        saveDB();
        renderAll();
        closeModal(m);
        toast('Held order deleted', 'warn');
        return;
      }
      const item = e.target.closest('[data-hid]');
      if (item) {
        if (Cart.recall(item.dataset.hid)) toast('Order recalled', 'ok');
        closeModal(m);
      }
    });
  }

  function doOrderDiscount() {
    const existing = Cart.getOrderDisc();
    const body = [''];
    body.push('<label class="label">Discount value<input class="input" id="od-val" inputmode="decimal" value="' + esc(existing ? String(existing.value) : '') + '" placeholder="e.g. 10"></label>');
    body.push('<div class="pay-methods">');
    body.push('<button class="pm' + (!existing || existing.type === 'percent' ? ' pm--active' : '') + '" type="button" data-odt="percent">% Percent</button>');
    body.push('<button class="pm' + (existing && existing.type === 'amount' ? ' pm--active' : '') + '" type="button" data-odt="amount">' + esc(money(10).replace(/[\d.,\s]+$/, '')) + ' Amount</button>');
    body.push('</div>');
    let type = !existing || existing.type === 'percent' ? 'percent' : 'amount';
    const m = modal(
      'Order Discount',
      body.join(''),
      '<button class="btn ghost" type="button" data-action="modal-close">Cancel</button>' +
        '<button class="btn danger ghost" type="button" data-action="od-clear">Remove</button>' +
        '<button class="btn primary" type="button" data-action="od-apply">Apply</button>'
    );
    m.el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-odt]');
      if (t) {
        type = t.dataset.odt;
        for (const b of m.el.querySelectorAll('[data-odt]')) b.classList.toggle('pm--active', b.dataset.odt === type);
        return;
      }
      if (e.target.closest('[data-action="od-clear"]')) {
        Cart.setOrderDiscount(null);
        closeModal(m);
        return;
      }
      if (e.target.closest('[data-action="od-apply"]')) {
        const v = num($('#od-val', m.el).value, 0);
        if (v <= 0) return toast('Enter a discount value', 'warn');
        Cart.setOrderDiscount({ type, value: Math.min(type === 'percent' ? 100 : Infinity, v) });
        closeModal(m);
      }
    });
  }

  function doCharge() {
    const items = Cart.getItems();
    if (!items.length) return toast('Cart is empty', 'warn');
    const snapshot = Cart.snapshot();
    openPaymentModal({
      cart: snapshot,
      totals: snapshot.totals,
      user,
      onComplete: (sale) => {
        Cart.clear();
        toast('Sale ' + sale.no + ' completed ✓', 'ok');
        if (typeof onCheckout === 'function') onCheckout(sale);
      },
    });
  }

  /** Barcode-style exact match: if search equals a sku/barcode exactly, add & clear. */
  function tryExactMatch(qRaw) {
    const q = qRaw.trim().toLowerCase();
    if (!q) return false;
    const d = getDB();
    const hit = (d.products || []).find(
      (p) => p.active !== false && (String(p.sku || '').toLowerCase() === q || String(p.barcode || '').toLowerCase() === q)
    );
    if (hit) {
      Cart.addItem(hit);
      state.q = '';
      searchEl.value = '';
      toast('Added: ' + hit.name, 'ok');
      return true;
    }
    return false;
  }

  // ── Event wiring ────────────────────────────────────────────────

  searchEl.addEventListener(
    'input',
    () => {
      state.q = searchEl.value;
      renderAll();
    },
    { signal: ac.signal }
  );

  searchEl.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!tryExactMatch(searchEl.value)) {
          // fall back: add first visible product in current filter
          const d = getDB();
          const q = state.q.trim().toLowerCase();
          const first = (d.products || []).find(
            (p) =>
              p.active !== false &&
              (!state.categoryId || p.categoryId === state.categoryId) &&
              (!q || String(p.name || '').toLowerCase().includes(q) || String(p.sku || '').toLowerCase().includes(q) || String(p.barcode || '').toLowerCase().includes(q))
          );
          if (first && q) {
            Cart.addItem(first);
            state.q = '';
            searchEl.value = '';
          }
        }
      } else if (e.key === 'Escape') {
        state.q = '';
        searchEl.value = '';
        renderAll();
      }
    },
    { signal: ac.signal }
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchEl.focus();
        searchEl.select();
      } else if (e.key === 'F4') {
        e.preventDefault();
        if (Cart.getItems().length) doCharge();
      }
    },
    { signal: ac.signal }
  );

  const unsubscribe = Cart.subscribe(() => renderAll());

  const unmount = () => {
    unsubscribe();
    ac.abort();
    if (container._registerUnmount === unmount) delete container._registerUnmount;
    root.remove();
  };
  container._registerUnmount = unmount;

  renderAll();
  searchEl.focus();

  return { unmount };
}
