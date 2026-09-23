// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';

const { loadDB, getDB, saveDB } = await import('../src/core/db.js');
const cart = await import('../src/services/cart.service.js');
const { mountRegister } = await import('../src/ui/views/register/register.view.js');
const { openPaymentModal } = await import('../src/ui/views/register/payment-modal.js');
const { openCustomerPicker } = await import('../src/ui/views/register/customer-picker.js');

function setupDb() {
  const db = loadDB();
  db.categories = [{ id: 'c1', name: 'Fruit', color: '#22c55e' }];
  db.products = [
    { id: 'p1', name: 'Apple', sku: 'APL-1', barcode: '123', categoryId: 'c1', price: 2, cost: 1, stock: 20, unit: 'pcs', trackStock: true, taxable: true, active: true },
    { id: 'p2', name: 'Banana', sku: 'BNN-2', barcode: '', categoryId: 'c1', price: 1, cost: .5, stock: 2, unit: 'pcs', trackStock: true, taxable: true, active: true },
    { id: 'p3', name: 'Gone', sku: 'GONE', barcode: '', categoryId: null, price: 5, cost: 2, stock: 0, unit: 'pcs', trackStock: true, taxable: true, active: true },
  ];
  db.customers = [{ id: 'cu1', name: 'Zoe', phone: '999', points: 50, credit: 0, totalSpent: 0, tags: [] }];
  db.sales = []; db.moves = []; db.held = []; db.auditLog = []; db.shifts = []; db.giftCards = [{ id:'g1', code:'GC1', balance: 5, expires: '' }];
  db.settings.tax = { enabled: true, label: 'Tax', rate: 10, inclusive: false };
  db.settings.rounding = { enabled: false, nearest: 0.05, applyTo: 'total' };
  saveDB();
  cart.clear();
}

describe('register view (jsdom)', () => {
  beforeEach(() => { setupDb(); document.body.innerHTML = '<div id="view"></div>'; });

  it('mounts, renders tiles, adds to cart on click, re-renders via subscribe', async () => {
    const container = document.getElementById('view');
    const inst = mountRegister(container, { user: { id: 'u', name: 'Admin' }, onCheckout: () => {} });
    expect(container.querySelectorAll('.pcard').length).toBe(3);
    expect(container.querySelector('.badge--bad').textContent).toBe('OUT');
    // click Apple tile
    container.querySelector('[data-pid="p1"]').click();
    expect(cart.getItems().length).toBe(1);
    // cart panel updated by subscription
    expect(container.querySelectorAll('.citem').length).toBe(1);
    expect(container.querySelector('.charge-btn').disabled).toBe(false);
    // search filter
    const s = container.querySelector('#reg-search');
    s.value = 'ban';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    expect(container.querySelectorAll('.pcard').length).toBe(1);
    // category chip
    s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true }));
    container.querySelector('[data-cat="c1"]').click();
    expect(container.querySelectorAll('.pcard').length).toBe(2);
    // qty stepper
    container.querySelector('[data-action="inc"]').click();
    expect(cart.getItems()[0].qty).toBe(2);
    // remove line
    container.querySelector('[data-action="rm"]').click();
    expect(cart.getItems().length).toBe(0);
    expect(container.querySelector('.charge-btn').disabled).toBe(true);
    // idempotent remount + unmount
    const inst2 = mountRegister(container, { user: {}, onCheckout: () => {} });
    expect(container.querySelectorAll('.register').length).toBe(1);
    inst2.unmount();
    expect(container.querySelectorAll('.register').length).toBe(0);
    void inst;
  });

  it('payment modal completes a sale and shows receipt', () => {
    const container = document.getElementById('view');
    mountRegister(container, { user: { id: 'u', name: 'Admin' }, onCheckout: () => {} });
    cart.addItem(getDB().products[0], { qty: 5 }); // $10 -> tax 1 -> total 11
    const snap = cart.snapshot();
    let completed = null;
    openPaymentModal({ cart: snap, totals: snap.totals, user: { id: 'u', name: 'Admin' }, onComplete: (s) => { completed = s; } });
    const overlay = document.querySelector('.modal-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toContain('Due:');
    // Exact quick button
    const exact = Array.from(overlay.querySelectorAll('[data-q]')).find((b) => b.textContent === 'Exact');
    exact.click();
    const completeBtn = overlay.querySelector('#pm-complete');
    expect(completeBtn.disabled).toBe(false);
    completeBtn.click();
    expect(completed).toBeTruthy();
    expect(completed.total).toBeCloseTo(11);
    expect(overlay.querySelector('.receipt')).toBeTruthy();
    expect(getDB().sales.length).toBe(1);
    expect(getDB().products[0].stock).toBe(15);
  });

  it('credit requires customer; gift card validates code', () => {
    const container = document.getElementById('view');
    mountRegister(container, { user: {}, onCheckout: () => {} });
    cart.addItem(getDB().products[0]);
    const snap = cart.snapshot();
    openPaymentModal({ cart: snap, totals: snap.totals, user: {}, onComplete: () => {} });
    const overlay = document.querySelector('.modal-overlay');
    overlay.querySelector('[data-method="credit"]').click();
    overlay.querySelector('#pm-amount').value = '99';
    overlay.querySelector('[data-action="add-pay"]').click();
    // no tender added because no customer
    expect(overlay.querySelectorAll('.tender').length).toBe(0);
    // gift card bad code
    overlay.querySelector('[data-method="gift"]').click();
    overlay.querySelector('#pm-giftcode').value = 'NOPE';
    overlay.querySelector('#pm-amount').value = '1';
    overlay.querySelector('[data-action="add-pay"]').click();
    expect(overlay.querySelectorAll('.tender').length).toBe(0);
    // good code
    overlay.querySelector('#pm-giftcode').value = 'GC1';
    overlay.querySelector('[data-action="add-pay"]').click();
    expect(overlay.querySelectorAll('.tender').length).toBe(1);
  });

  it('customer picker creates & picks walk-in', () => {
    openCustomerPicker({ customers: getDB().customers, onPick: (c) => { window.__picked = c; } });
    const overlay = document.querySelector('.modal-overlay');
    const input = overlay.querySelector('#cp-q');
    input.value = 'Zo';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    overlay.querySelector('.cp-item').click();
    expect(window.__picked.id).toBe('cu1');
    // new customer form
    delete window.__picked;
    openCustomerPicker({ customers: getDB().customers, onPick: (c) => { window.__picked = c; } });
    const o2 = document.querySelector('.modal-overlay');
    o2.querySelector('[data-action="new-customer"]').click();
    o2.querySelector('#cp-new [name="name"]').value = 'Fresh Person';
    o2.querySelector('#cp-new').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(window.__picked.name).toBe('Fresh Person');
    expect(getDB().customers.some((c) => c.name === 'Fresh Person')).toBe(true);
  });
});
