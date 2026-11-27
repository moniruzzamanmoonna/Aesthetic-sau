/*
 * Homepage (index.html) integration for Birthday Mate:
 *  - "Today's Birthday Mates" widget (#today-bday)
 *  - twins lookup for the original "Find Your Birthday Mate" form
 *  - admin: wish moderation tab
 * Exposes window.BdayHome for the classic scripts in index.html.
 */
import B from './bday-mate.js';
import { esc, avatar, personCard, bindWishButtons, toast, doSignIn } from './bday-ui.js';

const C = B.core;

// ── 🎂 Today's Birthday Mates widget ──────────────────────────────────
const MAX_CHIPS = 6;
async function mountTodayWidget() {
  const box = document.getElementById('bm-today-widget');
  if (!box) return;
  const now = new Date();
  const dateEl = document.getElementById('bm-today-date');
  if (dateEl) dateEl.textContent = C.formatLongDate(now);
  const list = document.getElementById('bm-today-list');
  list.innerHTML = '<div class="bm-home-skel" aria-label="Loading"></div>';
  try {
    const [items, hiddenN] = await Promise.all([B.birthdaysOn(now), B.hiddenOn(C.celebrationKeys(now))]);
    const total = items.length + hiddenN;
    const lockChip = hiddenN
      ? '<a class="bm-chip bm-chip-lock" href="' + (B.user() ? 'birthday.html#profile' : 'birthday.html#today') + '"><span class="bm-avatar bm-avatar-sm" aria-hidden="true">🔒</span>'
        + '<span><b>+' + hiddenN + ' more</b><small>' + (B.user() ? 'Share your birthday to see' : 'Sign in to see') + '</small></span></a>'
      : '';
    if (!total) {
      list.innerHTML = '<p class="bm-home-empty">No Birthday Mates today. Tomorrow is another day to celebrate! 💚</p>';
      return;
    }
    const shown = items.slice(0, MAX_CHIPS);
    list.innerHTML = '<div class="bm-chips">' + lockChip + shown.map(function (i) {
      return '<a class="bm-chip" href="birthday.html#today">' + avatar(i, 'sm')
        + '<span><b>🎂 ' + esc(i.name) + '</b><small>' + esc([i.faculty, i.batch ? 'Batch ' + i.batch : ''].filter(Boolean).join(' · ')) + '</small></span></a>';
    }).join('')
      + (items.length > MAX_CHIPS ? '<a class="bm-chip" href="birthday.html#today"><span><b>+' + (items.length - MAX_CHIPS) + ' more</b><small>View all</small></span></a>' : '')
      + '</div>';
    const cnt = document.getElementById('bm-today-count');
    if (cnt) cnt.textContent = ' · ' + (total === 1 ? '1 SAUian is celebrating' : total + ' SAUians are celebrating');
  } catch (e) {
    list.innerHTML = '<p class="bm-home-empty">Couldn\'t load today\'s birthdays. Please check your connection.</p>';
  }
}

// ── original form: register (no login) + twins popup ───────────────────
function twinsPopupHtml(res, justSaved) {
  const n = res.items.length;
  const head = n
    ? '<div class="bmp-icon">🎉</div><div class="bmp-title">Birthday Twin' + (n > 1 ? 's' : '') + ' Found!</div>'
      + '<div class="bmp-sub">You share your birthday (' + esc(C.formatMd(res.md)) + ') with <strong>' + n + '</strong> other SAU ' + (n === 1 ? 'student' : 'students') + '!</div>'
    : '<div class="bmp-icon">🌸</div><div class="bmp-title">No Birthday Twins found yet</div>'
      + '<div class="bmp-sub">Maybe you\'re the first one! Someone with the same birthday might join soon 🎂</div>';
  const cards = n ? '<div class="bm-grid bm-popup-grid">' + res.items.slice(0, 8).map(function (i) { return personCard(i, { showDate: false }); }).join('') + '</div>' : '';
  const hidden = res.membersHidden
    ? '<p class="bm-form-note">🔒 Some birthdays are shared with members only. Sign in with Google (optional) to see them and to receive wishes yourself.</p>' : '';
  return head + cards + hidden
    + '<div class="bm-form-actions"><a class="bm-btn bm-btn-primary" href="birthday.html#twins">View Birthday Twins →</a>'
    + (B.user() ? '' : '<a class="bm-btn" href="birthday.html#profile">Sign in with Google</a>') + '</div>'
    + (justSaved ? '<div class="bmp-saved">Your info has been saved ✓ — only your name, faculty and birthday (day &amp; month) are shown on Birthday Mate.</div>' : '');
}

async function registerAndFindTwins(entry) {
  await B.registerGuest(entry);
  return twinsPopupHtml(await B.twins(), true);
}
async function findTwins() {
  return twinsPopupHtml(await B.twins(), false);
}
function bindPopup(root) { if (root) bindWishButtons(root); }

// ── admin: anonymous wish moderation ──────────────────────────────────
let wishRows = [];
async function loadAdminWishes() {
  const body = document.getElementById('adm-wish-tbody');
  if (!body) return;
  body.innerHTML = '<tr><td colspan="6" class="adm-empty">লোড হচ্ছে...</td></tr>';
  try {
    wishRows = await B.adminWishes();
    renderAdminWishes();
  } catch (e) {
    body.innerHTML = '<tr><td colspan="6" class="adm-empty">Wishes লোড করা যায়নি (admin Google account দিয়ে login আছে তো?)</td></tr>';
  }
}
function renderAdminWishes() {
  const body = document.getElementById('adm-wish-tbody');
  const onlyRep = document.getElementById('adm-wish-reported');
  const showRemoved = document.getElementById('adm-wish-removed');
  const rows = wishRows.filter(function (w) {
    if (onlyRep && onlyRep.checked && !w.reported) return false;
    if (!(showRemoved && showRemoved.checked) && w.removed) return false;
    return true;
  });
  const set = function (id, v) { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('wst-total', wishRows.length);
  set('wst-reported', wishRows.filter(function (w) { return w.reported; }).length);
  set('wst-anon', wishRows.filter(function (w) { return w.anon && !w.removed; }).length);
  set('wst-removed', wishRows.filter(function (w) { return w.removed; }).length);
  if (!rows.length) { body.innerHTML = '<tr><td colspan="6" class="adm-empty">কোনো wish নেই</td></tr>'; return; }
  body.innerHTML = rows.map(function (w) {
    const dt = w.at ? new Date(w.at).toLocaleString('bn-BD') : '—';
    return '<tr class="bm-adm-wish">'
      + '<td class="adm-dim3">' + esc(dt) + '</td>'
      + '<td><strong>' + esc(w.toName || '—') + '</strong><div class="bm-adm-uid">' + esc(w.to) + '</div></td>'
      + '<td>' + esc(w.fromName || '(no profile)') + (w.anon ? ' <span class="adm-dim2">· anonymous</span>' : '') + '<div class="bm-adm-uid">' + esc(w.from) + '</div></td>'
      + '<td class="bm-adm-msg">' + (w.removed ? '<em class="adm-dim2">removed</em>' : esc(w.msg)) + '</td>'
      + '<td>' + (w.reported ? '<span class="bm-adm-flag">Reported</span>' : '') + '</td>'
      + '<td>' + (w.removed ? '' : '<button class="adm-del-btn" data-rm="' + esc(w.id) + '" data-to="' + esc(w.to) + '" aria-label="Remove wish">🗑</button>') + '</td>'
      + '</tr>';
  }).join('');
  body.querySelectorAll('[data-rm]').forEach(function (b) {
    b.addEventListener('click', async function () {
      if (!confirm('এই wish টি remove করবেন? Recipient আর এটা দেখতে পাবে না।')) return;
      b.disabled = true;
      try {
        await B.adminRemoveWish(b.getAttribute('data-rm'), b.getAttribute('data-to'));
        toast('Wish removed');
        loadAdminWishes();
      } catch (e) { b.disabled = false; toast('Remove করা যায়নি', 'warn'); }
    });
  });
}

/** Admin gate: Google sign-in, then confirm the account is an admin (rules decide). */
async function adminSignIn() {
  if (!B.user()) {
    const ok = await doSignIn();
    if (!ok) return { ok: false, reason: 'signin' };
  }
  const ok = await B.isAdmin();
  return { ok: ok, reason: ok ? '' : 'not-admin', email: B.user() ? B.user().email : '' };
}

// Show the user's birthday state in the homepage form for signed-in members.
async function profileSummary() {
  await B.ready;
  if (!B.user()) return null;
  try { return await B.getProfile(); } catch (e) { return null; }
}

const api = {
  mountTodayWidget, registerAndFindTwins, findTwins, bindPopup,
  loadAdminWishes, renderAdminWishes, adminSignIn, profileSummary,
  B: B
};
self.BdayHome = api;
B.onUser(function () { mountTodayWidget(); });
try { self.dispatchEvent(new CustomEvent('bdayhome:ready')); } catch (e) {}
export default api;
