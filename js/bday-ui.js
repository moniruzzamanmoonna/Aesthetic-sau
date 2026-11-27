/*
 * Birthday Mate — shared UI pieces (cards, wish modal, sign-in prompt, toast).
 * Used by birthday.html (js/bday-page.js) and the homepage (js/bday-home.js).
 */
import B from './bday-mate.js';

const C = B.core;

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

export function avatar(item, size) {
  const cls = 'bm-avatar' + (size === 'sm' ? ' bm-avatar-sm' : '');
  if (item.photo) {
    return '<span class="' + cls + '"><img src="' + esc(item.photo) + '" alt="" loading="lazy" referrerpolicy="no-referrer" width="48" height="48"/></span>';
  }
  return '<span class="' + cls + '" aria-hidden="true">' + esc(C.initials(item.name)) + '</span>';
}

/** Profile card. Only name, faculty, batch, day+month and (opt-in) photo are ever shown. */
export function personCard(item, opts) {
  opts = opts || {};
  const meta = [];
  if (item.batch) meta.push('Batch ' + esc(item.batch));
  if (opts.showDate !== false) {
    meta.push('🎂 ' + esc(C.formatMd(item.md)));
  }
  const wishBtn = item.canWish && !item.isSelf
    ? '<button type="button" class="bm-wish-btn" data-wish="' + esc(item.uid) + '" data-name="' + esc(item.name) + '">💌 <span>Send a Secret Birthday Wish</span></button>'
    : '';
  // Optional AnonBox link: anyone who can see the card can send an anonymous text there.
  const anonBtn = item.anonbox && !item.isSelf
    ? '<a class="bm-wish-btn bm-anon-btn" href="' + esc(C.ANONBOX_BASE + item.anonbox) + '" target="_blank" rel="noopener noreferrer" aria-label="Send ' + esc(item.name) + ' an anonymous message on AnonBox">💬 <span>Anonymous message</span></a>'
    : '';
  const actions = wishBtn && anonBtn ? '<div class="bm-card-actions">' + wishBtn.replace('Send a Secret Birthday Wish', 'Secret Wish') + anonBtn.replace('Anonymous message', 'AnonBox') + '</div>' : (wishBtn || anonBtn);
  const you = item.isSelf ? '<span class="bm-you">You</span>' : '';
  return '<article class="bm-card">'
    + avatar(item)
    + '<div class="bm-card-body">'
    + '<h3 class="bm-card-name">' + esc(item.name) + you + '</h3>'
    + (item.faculty ? '<p class="bm-card-fac">' + esc(item.faculty) + '</p>' : '')
    + (meta.length ? '<p class="bm-card-meta">' + meta.join(' · ') + '</p>' : '')
    + '</div>'
    + actions
    + '</article>';
}

/** Wire every "Send a Secret Birthday Wish" button inside `root`. */
export function bindWishButtons(root) {
  root.querySelectorAll('[data-wish]').forEach(function (btn) {
    if (btn._bmBound) return;
    btn._bmBound = true;
    btn.addEventListener('click', function () {
      openWishModal({ uid: btn.getAttribute('data-wish'), name: btn.getAttribute('data-name') });
    });
  });
}

export function emptyState(icon, title, text, actionsHtml) {
  return '<div class="bm-empty">'
    + '<div class="bm-empty-icon" aria-hidden="true">' + icon + '</div>'
    + '<p class="bm-empty-title">' + title + '</p>'
    + (text ? '<p class="bm-empty-text">' + text + '</p>' : '')
    + (actionsHtml ? '<div class="bm-empty-actions">' + actionsHtml + '</div>' : '')
    + '</div>';
}

export function skeleton(n) {
  let h = '<div class="bm-grid" aria-busy="true" aria-label="Loading">';
  for (let i = 0; i < (n || 3); i++) h += '<div class="bm-card bm-skel"><span class="bm-avatar"></span><div class="bm-card-body"><i></i><i></i></div></div>';
  return h + '</div>';
}

export function errorState(msg, retryId) {
  return '<div class="bm-empty bm-error" role="alert">'
    + '<div class="bm-empty-icon" aria-hidden="true">⚠️</div>'
    + '<p class="bm-empty-title">Something went wrong</p>'
    + '<p class="bm-empty-text">' + esc(msg || 'Please check your internet connection and try again.') + '</p>'
    + (retryId ? '<div class="bm-empty-actions"><button type="button" class="bm-btn" id="' + retryId + '">Try again</button></div>' : '')
    + '</div>';
}

// ── toast ─────────────────────────────────────────────────────────────
export function toast(msg, kind) {
  const t = document.createElement('div');
  t.className = 'bm-toast' + (kind ? ' bm-toast-' + kind : '');
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(function () { t.classList.add('show'); });
  setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 350); }, 3200);
}

// ── modal ─────────────────────────────────────────────────────────────
let lastFocus = null;
export function openModal(html, opts) {
  closeModal(true);
  lastFocus = document.activeElement;
  const wrap = document.createElement('div');
  wrap.className = 'bm-modal';
  wrap.id = 'bm-modal';
  wrap.innerHTML = '<div class="bm-modal-back" data-close></div>'
    + '<div class="bm-modal-box" role="dialog" aria-modal="true" aria-labelledby="bm-modal-title">'
    + '<button type="button" class="bm-modal-x" data-close aria-label="Close">✕</button>'
    + html + '</div>';
  document.body.appendChild(wrap);
  document.body.classList.add('bm-noscroll');
  wrap.addEventListener('click', function (e) { if (e.target.hasAttribute('data-close')) closeModal(); });
  requestAnimationFrame(function () { wrap.classList.add('open'); });
  const first = wrap.querySelector((opts && opts.focus) || 'textarea,input,button:not(.bm-modal-x)');
  if (first) setTimeout(function () { first.focus(); }, 60);
  return wrap;
}
export function closeModal(instant) {
  const m = document.getElementById('bm-modal');
  if (!m) return;
  document.body.classList.remove('bm-noscroll');
  if (instant) m.remove();
  else { m.classList.remove('open'); setTimeout(function () { m.remove(); }, 220); }
  if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
}
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

// ── sign in ───────────────────────────────────────────────────────────
export function inAppBrowserHtml() {
  return '<div class="bm-modal-icon" aria-hidden="true">🌐</div>'
    + '<h2 class="bm-modal-title" id="bm-modal-title">Open in your browser to sign in</h2>'
    + '<p class="bm-modal-text">Google doesn\'t allow sign-in inside the Facebook / Messenger app. Tap <strong>⋯</strong> (top-right) and choose <strong>Open in browser</strong>, then sign in there.</p>'
    + '<button type="button" class="bm-btn bm-btn-primary bm-full" id="bm-copy-link">Copy page link</button>';
}

/** Sign in with Google; shows helpful messages instead of failing silently. Resolves true when signed in. */
export async function doSignIn() {
  try {
    await B.signIn();
    return !!B.user();
  } catch (e) {
    if (e && e.code === 'bday/in-app-browser') {
      openModal(inAppBrowserHtml());
      const b = document.getElementById('bm-copy-link');
      if (b) b.addEventListener('click', function () {
        const url = location.href;
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { toast('Link copied ✓'); })
          .catch(function () { prompt('Copy this link:', url); });
      });
    } else if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) {
      /* user closed the popup — nothing to report */
    } else {
      toast('Sign-in failed. Please try again.', 'warn');
      console.warn('[BirthdayMate] sign-in', e && e.code);
    }
    return false;
  }
}

export function signInPromptHtml(title, text) {
  return '<div class="bm-signin">'
    + '<div class="bm-empty-icon" aria-hidden="true">🔐</div>'
    + '<p class="bm-empty-title">' + title + '</p>'
    + '<p class="bm-empty-text">' + text + '</p>'
    + '<button type="button" class="bm-btn bm-btn-google" data-signin>' + GOOGLE_G + 'Sign in with Google</button>'
    + '<p class="bm-fine">We never show your email or year of birth to other students.</p>'
    + '</div>';
}
export const GOOGLE_G = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

export function bindSignIn(root, after) {
  root.querySelectorAll('[data-signin]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      const ok = await doSignIn();
      btn.disabled = false;
      if (ok && after) after();
    });
  });
}

// ── wish modal ────────────────────────────────────────────────────────
export function openWishModal(person) {
  // No sign-in needed: visitors without a Google account always send anonymously.
  const guest = !B.user();
  const max = C.WISH_MAX;
  const m = openModal(
    '<h2 class="bm-modal-title" id="bm-modal-title">💌 Send a Secret Birthday Wish</h2>'
    + '<p class="bm-modal-text">To <strong>' + esc(person.name) + '</strong></p>'
    + '<form id="bm-wish-form" novalidate>'
    + '<label class="bm-label" for="bm-wish-text">Your message</label>'
    + '<textarea id="bm-wish-text" class="bm-input bm-textarea" maxlength="' + max + '" rows="4" placeholder="Happy Birthday! Hope this year brings you lots of happiness. 🌻" required></textarea>'
    + '<div class="bm-row-between"><span class="bm-fine" id="bm-wish-err" role="alert"></span><span class="bm-count" id="bm-wish-count">0/' + max + '</span></div>'
    + '<label class="bm-check"><input type="checkbox" id="bm-wish-anon" checked' + (guest ? ' disabled' : '') + '/> <span>Send anonymously</span></label>'
    + '<p class="bm-fine" id="bm-anon-note">They\'ll only see "Someone sent you a birthday wish".'
    + (guest ? ' No sign-in needed. Want to send it with your name? <button type="button" class="bm-link" data-signin>Sign in with Google</button> (optional).'
      : ' Admins can see the sender only if a wish is reported for abuse.') + '</p>'
    + '<button type="submit" class="bm-btn bm-btn-primary bm-full" id="bm-wish-send">Send wish</button>'
    + '</form>', { focus: '#bm-wish-text' });
  if (guest) bindSignIn(m, function () { openWishModal(person); });
  const ta = m.querySelector('#bm-wish-text');
  const cnt = m.querySelector('#bm-wish-count');
  const err = m.querySelector('#bm-wish-err');
  const anon = m.querySelector('#bm-wish-anon');
  const note = m.querySelector('#bm-anon-note');
  const send = m.querySelector('#bm-wish-send');
  ta.addEventListener('input', function () {
    cnt.textContent = ta.value.length + '/' + max;
    cnt.classList.toggle('bm-count-hot', ta.value.length > max - 20);
    err.textContent = '';
  });
  anon.addEventListener('change', function () {
    note.textContent = anon.checked
      ? 'They\'ll only see "Someone sent you a birthday wish". Admins can see the sender only if a wish is reported for abuse.'
      : 'Your name from your Birthday Mate profile will be shown with the wish.';
  });
  let busy = false;
  m.querySelector('#bm-wish-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (busy) return;
    const chk = C.checkWish(ta.value);
    if (chk.error) { err.textContent = chk.error; ta.focus(); return; }
    busy = true;
    send.disabled = true;
    send.textContent = 'Sending…';
    try {
      await B.sendWish(person.uid, chk.text, anon.checked);
      m.querySelector('.bm-modal-box').innerHTML = '<button type="button" class="bm-modal-x" data-close aria-label="Close">✕</button>'
        + '<div class="bm-modal-icon bm-pop" aria-hidden="true">💚</div>'
        + '<h2 class="bm-modal-title" id="bm-modal-title">Wish sent successfully! 💚</h2>'
        + '<p class="bm-modal-text">' + esc(person.name) + ' will see it in their Birthday Mate wishes.</p>'
        + '<button type="button" class="bm-btn bm-full" data-close>Done</button>';
    } catch (ex) {
      err.textContent = (ex && ex.message) || 'Could not send the wish. Please try again.';
      send.disabled = false;
      send.textContent = 'Send wish';
      busy = false;
    }
  });
}
