// src/ui/views/auth/setup.view.js — first-run store + admin setup screen.

import { num } from '../../../core/utils.js';
import { hashPw, hashPin } from '../../../core/crypto.js';

/** Build an admin user object (async — hashes password/PIN). */
export async function buildAdminUser({ name, password, pin }) {
  const { salt, hash } = await hashPw(password);
  let pinFields = {};
  if (pin && String(pin).trim()) {
    const { pinSalt, pin: pinHash } = await hashPin(String(pin).trim());
    pinFields = { pin: pinHash, pinSalt };
  } else {
    pinFields = { pin: null, pinSalt: null };
  }
  return {
    id: 'usr_admin',
    name: String(name || 'Admin').slice(0, 60),
    role: 'admin',
    active: true,
    commissionRate: 0,
    salt,
    hash,
    ...pinFields,
  };
}

/**
 * Mount the setup screen. onSubmit(payload) receives:
 * { storeName, currencyCode, currencySymbol, taxRate, adminName, adminPassword, adminPin }
 */
export function mountSetup(root, { onSubmit }) {
  root.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'auth-wrap';
  const parts = [];
  parts.push('<form class="card auth-card" id="setup-form">');
  parts.push('<h1 class="auth-title">Welcome to OmniPOS</h1>');
  parts.push('<p class="auth-sub">Set up your store in a few seconds.</p>');
  parts.push('<label class="label">Store name<input class="input" name="storeName" required maxlength="60" placeholder="My Store"></label>');
  parts.push('<div class="row2">');
  parts.push('<label class="label">Currency code<input class="input" name="currencyCode" maxlength="3" value="USD" placeholder="USD"></label>');
  parts.push('<label class="label">Symbol<input class="input" name="currencySymbol" maxlength="3" value="$" placeholder="$"></label>');
  parts.push('</div>');
  parts.push('<label class="label">Tax rate %<input class="input" name="taxRate" type="number" step="0.01" min="0" max="100" value="' + num(10) + '"></label>');
  parts.push('<hr class="auth-hr">');
  parts.push('<label class="label">Your name<input class="input" name="adminName" required maxlength="60" placeholder="Admin"></label>');
  parts.push('<label class="label">Password<input class="input" name="adminPassword" type="password" required minlength="4" placeholder="••••••"></label>');
  parts.push('<label class="label">PIN (optional)<input class="input" name="adminPin" inputmode="numeric" maxlength="8" placeholder="1234"></label>');
  parts.push('<button class="btn primary block" type="submit">Create Store</button>');
  parts.push('</form>');
  wrap.innerHTML = parts.join('');
  root.appendChild(wrap);

  const form = wrap.querySelector('#setup-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    onSubmit({
      storeName: String(fd.get('storeName') || '').trim(),
      currencyCode: (String(fd.get('currencyCode') || 'USD').trim() || 'USD').toUpperCase().slice(0, 3),
      currencySymbol: String(fd.get('currencySymbol') || '$').trim().slice(0, 3) || '$',
      taxRate: num(fd.get('taxRate'), 0),
      adminName: String(fd.get('adminName') || '').trim(),
      adminPassword: String(fd.get('adminPassword') || ''),
      adminPin: String(fd.get('adminPin') || '').trim(),
    });
  });

  return { unmount: () => wrap.remove() };
}
