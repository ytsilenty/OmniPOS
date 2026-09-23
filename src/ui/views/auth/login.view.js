// src/ui/views/auth/login.view.js — password + PIN-pad login with rate limiting.

import { esc, num } from '../../../core/utils.js';
import { verifyPw, verifyPin } from '../../../core/crypto.js';

const MAX_ATTEMPTS = 5;
const LOCK_MS = 30000;

/**
 * Mount the login screen.
 * opts: { db, onLogin(user) } — called when credentials verified.
 */
export function mountLogin(root, { db, onLogin }) {
  root.innerHTML = '';
  let attempts = 0;
  let lockedUntil = 0;
  let mode = 'password'; // 'password' | 'pin'

  const users = (db.users || []).filter((u) => u.active !== false);
  const wrap = document.createElement('div');
  wrap.className = 'auth-wrap';

  function render() {
    const parts = [];
    parts.push('<div class="card auth-card" id="login-card">');
    parts.push('<h1 class="auth-title">' + esc(db.settings.storeName || 'OmniPOS') + '</h1>');
    parts.push('<p class="auth-sub">Sign in to continue</p>');
    parts.push('<label class="label">User');
    parts.push('<select class="input" id="login-user">');
    for (const u of users) {
      parts.push('<option value="' + esc(u.id) + '">' + esc(u.name) + ' (' + esc(u.role) + ')</option>');
    }
    parts.push('</select></label>');

    if (mode === 'password') {
      parts.push('<label class="label">Password<input class="input" id="login-pw" type="password" autocomplete="off" placeholder="••••••"></label>');
      parts.push('<button class="btn primary block" type="button" data-action="try-password">Sign in</button>');
      const anyPin = users.some((u) => u.pin);
      if (anyPin) parts.push('<button class="btn ghost block" type="button" data-action="mode-pin">Use PIN instead</button>');
    } else {
      const sel = users.find((u) => u.id === (wrap.querySelector('#login-user') || {}).value) || users[0];
      parts.push('<div class="pin-display" id="pin-display">&nbsp;</div>');
      parts.push('<div class="pin-pad">');
      for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫']) {
        parts.push('<button class="btn pin-key" type="button" data-pin="' + esc(k) + '">' + esc(k) + '</button>');
      }
      parts.push('</div>');
      parts.push('<button class="btn ghost block" type="button" data-action="mode-password">Use password instead</button>');
      void sel;
    }

    if (lockedUntil > Date.now()) {
      const secs = Math.ceil((lockedUntil - Date.now()) / 1000);
      parts.push('<p class="auth-err">Too many attempts. Try again in ' + secs + 's.</p>');
    }
    parts.push('<p class="auth-err" id="login-err"></p>');
    parts.push('</div>');
    wrap.innerHTML = parts.join('');
    const pw = wrap.querySelector('#login-pw');
    if (pw) {
      pw.focus();
      pw.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') tryPassword();
      });
    }
  }

  function selectedUser() {
    const id = (wrap.querySelector('#login-user') || {}).value;
    return users.find((u) => u.id === id) || null;
  }

  function fail(msg) {
    attempts++;
    if (attempts >= MAX_ATTEMPTS) {
      lockedUntil = Date.now() + LOCK_MS;
      attempts = 0;
    }
    const err = wrap.querySelector('#login-err');
    if (err) err.textContent = msg || 'Invalid credentials';
    if (lockedUntil > Date.now()) setTimeout(render, 0);
  }

  function ok(user) {
    attempts = 0;
    onLogin(user);
  }

  async function tryPassword() {
    if (Date.now() < lockedUntil) return fail('Locked out — wait.');
    const user = selectedUser();
    const pwEl = wrap.querySelector('#login-pw');
    if (!user || !pwEl) return fail('Pick a user');
    const good = await verifyPw(pwEl.value, user.salt, user.hash);
    if (good) ok(user);
    else fail('Wrong password');
  }

  let pinBuf = '';
  async function tryPin() {
    if (Date.now() < lockedUntil) return fail('Locked out — wait.');
    const user = selectedUser();
    if (!user || !user.pin) return fail('No PIN set');
    const good = await verifyPin(pinBuf, user.pinSalt, user.pin);
    pinBuf = '';
    if (good) ok(user);
    else fail('Wrong PIN');
  }

  wrap.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'try-password') return tryPassword();
    if (action === 'mode-pin') {
      mode = 'pin';
      pinBuf = '';
      return render();
    }
    if (action === 'mode-password') {
      mode = 'password';
      return render();
    }
    if (btn.dataset.pin !== undefined) {
      const k = btn.dataset.pin;
      if (k === 'C') pinBuf = '';
      else if (k === '⌫') pinBuf = pinBuf.slice(0, -1);
      else if (pinBuf.length < 8) pinBuf += k;
      const disp = wrap.querySelector('#pin-display');
      if (disp) disp.textContent = pinBuf ? '•'.repeat(pinBuf.length) : '\u00a0';
      if (pinBuf.length >= num(users.find((u) => u.id === (wrap.querySelector('#login-user') || {}).value)?.pin?.length || 4) && pinBuf.length >= 4) {
        await tryPin();
      }
    }
  });

  root.appendChild(wrap);
  render();
  return { unmount: () => wrap.remove() };
}
