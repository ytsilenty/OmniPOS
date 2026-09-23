// src/ui/views/register/customer-picker.js — modal to pick or quickly create a customer.

import { esc, num, uid } from '../../../core/utils.js';
import { getDB, saveDB } from '../../../core/db.js';
import { modal, closeModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';

/**
 * Open the customer picker.
 * opts: { customers?, onPick(customer) }
 */
export function openCustomerPicker({ customers, onPick } = {}) {
  const db = getDB();
  const all = Array.isArray(customers) ? customers : db.customers || [];
  let showingForm = false;
  let query = '';

  const m = modal('Select Customer', '<div id="cp-root"></div>', '', { wide: false });
  const root = m.el.querySelector('#cp-root');

  function filtered() {
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 50);
    return all
      .filter(
        (c) =>
          String(c.name || '').toLowerCase().includes(q) ||
          String(c.phone || '').toLowerCase().includes(q) ||
          String(c.email || '').toLowerCase().includes(q)
      )
      .slice(0, 50);
  }

  function render() {
    const parts = [];
    parts.push('<input class="input cp-search" id="cp-q" placeholder="Search name / phone…" value="' + esc(query) + '">');
    if (showingForm) {
      parts.push('<form class="cp-form" id="cp-new">');
      parts.push('<label class="label">Name<input class="input" name="name" required maxlength="60" placeholder="Walk-in customer"></label>');
      parts.push('<label class="label">Phone<input class="input" name="phone" maxlength="20" placeholder="optional"></label>');
      parts.push('<div style="display:flex;gap:8px">');
      parts.push('<button class="btn ghost" type="button" data-action="cancel-new">Cancel</button>');
      parts.push('<button class="btn primary" type="submit">Create &amp; Select</button>');
      parts.push('</div></form>');
    } else {
      const list = filtered();
      parts.push('<div class="cp-list">');
      if (!list.length) {
        parts.push('<div class="cart-empty" style="padding:24px 0">No matching customers.</div>');
      }
      for (const c of list) {
        parts.push(
          '<div class="cp-item" data-cid="' + esc(c.id) + '">' +
            '<div><div class="cp-name">' + esc(c.name) + '</div>' +
            '<div class="cp-meta">' + esc(c.phone || '') + '</div></div>' +
            '<div class="cp-points">' + num(c.points, 0) + ' pts</div>' +
          '</div>'
        );
      }
      parts.push('</div>');
      parts.push('<button class="btn block" type="button" data-action="new-customer">+ New customer</button>');
    }
    root.innerHTML = parts.join('');
    const qEl = root.querySelector('#cp-q');
    if (qEl && !query) qEl.focus();
  }

  root.addEventListener('input', (e) => {
    if (e.target.id === 'cp-q') {
      query = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const again = root.querySelector('#cp-q');
      if (again) {
        again.focus();
        try { again.setSelectionRange(pos, pos); } catch (_) { /* noop */ }
      }
    }
  });

  root.addEventListener('click', (e) => {
    const item = e.target.closest('.cp-item');
    if (item) {
      const c = all.find((x) => x.id === item.dataset.cid);
      if (c) {
        closeModal(m);
        onPick(c);
      }
      return;
    }
    if (e.target.closest('[data-action="new-customer"]')) {
      showingForm = true;
      render();
    } else if (e.target.closest('[data-action="cancel-new"]')) {
      showingForm = false;
      render();
    }
  });

  root.addEventListener('submit', (e) => {
    if (e.target.id !== 'cp-new') return;
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = String(fd.get('name') || '').trim();
    if (!name) return toast('Name is required', 'bad');
    const customer = {
      id: uid('cus'),
      name: name.slice(0, 60),
      phone: String(fd.get('phone') || '').trim().slice(0, 20),
      email: '',
      points: 0,
      credit: 0,
      totalSpent: 0,
      birthday: '',
      note: '',
      tags: ['walkin'],
      createdAt: new Date().toISOString(),
    };
    db.customers.unshift(customer);
    saveDB();
    all.push(customer);
    closeModal(m);
    onPick(customer);
  });

  render();
}
