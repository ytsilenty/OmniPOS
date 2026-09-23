// src/ui/views/register/product-grid.js — category chips + product tiles.
// Pure render function: caller owns the element and event handling via onAdd.

import { esc, num } from '../../../core/utils.js';
import { money } from '../../../core/money.js';
import { getDB } from '../../../core/db.js';

/**
 * Render category chips + product tiles into el (replaces its content).
 * @param {HTMLElement} el
 * @param {object} opts
 *   products: full product list (filtering applied here)
 *   categories: [{id,name,color}]
 *   filter: { q: string, categoryId: string|null } — applied against products
 *   onAdd(product): tile click handler
 *   onCategory(catId): chip click handler ('all' or category id)
 */
export function renderProductGrid(el, { products, categories, filter, onAdd, onCategory }) {
  const db = getDB();
  const lowStock = num(db.settings.lowStock, 5);
  const cats = Array.isArray(categories) ? categories : [];
  const q = String((filter && filter.q) || '').trim().toLowerCase();
  const catId = (filter && filter.categoryId) || null;
  const active = catId || 'all';

  // ── Filter products ─────────────────────────────────────────────
  let list = (Array.isArray(products) ? products : []).filter((p) => p && p.active !== false);
  if (catId) list = list.filter((p) => p.categoryId === catId);
  if (q) {
    list = list.filter(
      (p) =>
        String(p.name || '').toLowerCase().includes(q) ||
        String(p.sku || '').toLowerCase().includes(q) ||
        String(p.barcode || '').toLowerCase().includes(q) ||
        (p.variants || []).some((v) => String(v.sku || '').toLowerCase().includes(q) || String(v.barcode || '').toLowerCase().includes(q))
    );
  }

  // ── Category chips row ──────────────────────────────────────────
  const chipParts = [];
  chipParts.push('<div class="cats">');
  chipParts.push('<button class="chip' + (active === 'all' ? ' chip--active' : '') + '" type="button" data-cat="all">All</button>');
  for (const c of cats) {
    chipParts.push(
      '<button class="chip' + (active === c.id ? ' chip--active' : '') + '" type="button" data-cat="' + esc(c.id) + '">' +
        (c.color ? '<span class="chip-dot" style="background:' + esc(safeColor(c.color)) + '"></span>' : '') +
        esc(c.name) +
        '</button>'
    );
  }
  chipParts.push('</div>');

  // ── Product tiles ───────────────────────────────────────────────
  const gridParts = [];
  gridParts.push('<div class="grid">');
  if (!list.length) {
    gridParts.push('<div class="empty">No products found</div>');
  } else {
    for (const p of list) {
      const trackable = p.trackStock !== false && !p.isService;
      const stock = num(p.stock, 0);
      let badge = '';
      if (!trackable) {
        badge = '<span class="badge badge--ok">' + esc(p.unit || 'svc') + '</span>';
      } else if (stock <= 0) {
        badge = '<span class="badge badge--bad">OUT</span>';
      } else if (stock <= lowStock) {
        badge = '<span class="badge badge--warn">' + fmtQty(stock) + '</span>';
      } else {
        badge = '<span class="badge">' + fmtQty(stock) + '</span>';
      }
      gridParts.push(
        '<button class="pcard" type="button" data-pid="' + esc(p.id) + '">' +
          badge +
          '<span class="pcard-name">' + esc(p.name) + '</span>' +
          '<span class="pcard-price">' + esc(money(num(p.price, 0))) + '</span>' +
          '<span class="pcard-sku">' + esc(p.sku || p.barcode || '') + '</span>' +
          '</button>'
      );
    }
  }
  gridParts.push('</div>');

  el.innerHTML = chipParts.join('') + gridParts.join('');

  // ── Delegation: tile/chip clicks via latest-callback refs ────────
  // Store callbacks on the element so re-renders never stack listeners.
  el._pgHandlers = { products, onAdd, onCategory };
  if (!el._pgBound) {
    el._pgBound = true;
    el.addEventListener('click', (e) => {
      const h = el._pgHandlers;
      const tile = e.target.closest('.pcard');
      if (tile) {
        const pid = tile.dataset.pid;
        const prod = (Array.isArray(h.products) ? h.products : []).find((p) => p.id === pid);
        if (prod && typeof h.onAdd === 'function') h.onAdd(prod);
        return;
      }
      const chip = e.target.closest('[data-cat]');
      if (chip && typeof h.onCategory === 'function') h.onCategory(chip.dataset.cat);
    });
  }
}

function fmtQty(n) {
  return n === Math.floor(n) ? String(n) : n.toFixed(2);
}

/** Only allow simple color tokens in inline styles. */
function safeColor(c) {
  const s = String(c);
  return /^#[0-9a-fA-F]{3,8}$/.test(s) ? s : 'var(--acc)';
}
