/*
 * birthday.html — Birthday Twins, Today's Birthdays, Calendar, My Wishes, Profile.
 * Hash routes keep everything on one static page: #twins #today #calendar #wishes #profile
 */
import B from './bday-mate.js';
import {
  esc, personCard, bindWishButtons, emptyState, skeleton, errorState, toast, openModal, closeModal,
  signInPromptHtml, bindSignIn, doSignIn, avatar, GOOGLE_G
} from './bday-ui.js';

const C = B.core;
const main = document.getElementById('bm-main');
const ROUTES = ['twins', 'today', 'calendar', 'wishes', 'profile'];
let renderSeq = 0;

function route() {
  const h = (location.hash || '').replace(/^#\/?/, '').split(/[/?]/)[0];
  return ROUTES.indexOf(h) >= 0 ? h : 'today';
}

function setActiveTab(r) {
  document.querySelectorAll('.bm-tabs a[data-tab]').forEach(function (a) {
    const on = a.getAttribute('data-tab') === r;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const titles = { twins: 'Birthday Twins', today: "Today's Birthdays", calendar: 'Birthday Calendar', wishes: 'My Wishes', profile: 'My Birthday Profile' };
  document.title = titles[r] + ' — Birthday Mate · Aesthetic SAU';
}

async function render() {
  const r = route();
  const seq = ++renderSeq;
  setActiveTab(r);
  const views = { twins: viewTwins, today: viewToday, calendar: viewCalendar, wishes: viewWishes, profile: viewProfile };
  try {
    await views[r](seq);
  } catch (e) {
    console.error(e);
    if (seq === renderSeq) {
      main.innerHTML = errorState('', 'bm-retry');
      const b = document.getElementById('bm-retry');
      if (b) b.addEventListener('click', render);
    }
  }
}
function stale(seq) { return seq !== renderSeq; }

function head(eyebrow, title, sub) {
  return '<header class="bm-head">'
    + '<p class="bm-eyebrow">' + eyebrow + '</p>'
    + '<h1 class="bm-title">' + title + '</h1>'
    + (sub ? '<p class="bm-sub">' + sub + '</p>' : '')
    + '</header>';
}
function membersNote() {
  return B.user() ? '' : '<p class="bm-note">🔒 Some birthdays are shared with <strong>SAU members only</strong>. <button type="button" class="bm-link" data-signin>Sign in</button> to see them too.</p>';
}
function after(seq) {
  if (stale(seq)) return;
  bindWishButtons(main);
  bindSignIn(main, render);
}

// ── 🎉 Today ──────────────────────────────────────────────────────────
async function viewToday(seq) {
  const now = new Date();
  main.innerHTML = head('🎉 Birthday Today', esc(C.formatLongDate(now)), 'Happy Birthday! 🎂') + skeleton(3);
  const items = await B.birthdaysOn(now);
  if (stale(seq)) return;
  const leapNote = items.some(function (i) { return i.md === '02-29'; }) && !(now.getMonth() === 1 && now.getDate() === 29)
    ? '<p class="bm-note">🐸 Leap-day babies (29 February) are celebrated today because this year has no 29 February.</p>' : '';
  main.innerHTML = head('🎉 Birthday Today', esc(C.formatLongDate(now)),
    items.length ? 'Happy Birthday! 🎂 ' + items.length + ' SAU ' + (items.length === 1 ? 'student is' : 'students are') + ' celebrating today.' : 'Happy Birthday! 🎂')
    + leapNote
    + (items.length
      ? '<div class="bm-grid">' + items.map(function (i) { return personCard(i, { showDate: false }); }).join('') + '</div>'
      : emptyState('🎈', 'No Birthday Mates today.', 'Tomorrow is another day to celebrate! 💚',
        '<a class="bm-btn" href="#calendar">🗓️ Open the calendar</a>'))
    + membersNote();
  after(seq);
}

// ── 🎂 Twins ──────────────────────────────────────────────────────────
async function viewTwins(seq) {
  main.innerHTML = head('🎂 Birthday Twins', 'Your Birthday Twins', '') + skeleton(3);
  const res = await B.twins();
  if (stale(seq)) return;
  if (!res.md) {
    main.innerHTML = head('🎂 Birthday Twins', 'Your Birthday Twins', 'Same day and month, any year.')
      + emptyState('🎂', 'Add your birthday to find your twins', 'Create your Birthday Mate profile, or use the quick form on the homepage.',
        '<a class="bm-btn bm-btn-primary" href="#profile">Create my profile</a><a class="bm-btn" href="index.html#birthday">Quick form</a>');
    after(seq);
    return;
  }
  const dateTxt = esc(C.formatMd(res.md));
  const n = res.items.length;
  const sub = n
    ? 'You share your birthday (<strong>' + dateTxt + '</strong>) with ' + n + ' other SAU ' + (n === 1 ? 'student' : 'students') + '.'
    : 'Your birthday: <strong>' + dateTxt + '</strong>';
  const leap = res.md === '02-29' ? '<p class="bm-note">🐸 Leap-day birthday! Your twins are others born on 29 February.</p>' : '';
  main.innerHTML = head('🎂 Birthday Twins', 'Your Birthday Twins', sub) + leap
    + (n
      ? '<div class="bm-grid">' + res.items.map(function (i) { return personCard(i); }).join('') + '</div>'
      : emptyState('🌱', "No Birthday Twins found yet. Maybe you're the first one!", 'Maybe someone with the same birthday will join soon! 🎂'))
    + (res.membersHidden ? membersNote() : '');
  after(seq);
}

// ── 🗓️ Calendar ───────────────────────────────────────────────────────
const cal = { year: 0, month: 0, selected: '', cache: {} };
function calKey(y, m) { return y + '-' + m + '-' + (B.user() ? 'm' : 'p'); }

async function viewCalendar(seq) {
  const today = new Date();
  if (!cal.year) { cal.year = today.getFullYear(); cal.month = today.getMonth() + 1; cal.selected = C.mdFromDate(today); }
  const key = calKey(cal.year, cal.month);
  const shell = function (body) {
    return head('🗓️ Birthday Calendar', esc(C.MONTHS[cal.month - 1] + ' ' + cal.year), '')
      + '<div class="bm-cal-bar">'
      + '<button type="button" class="bm-icon-btn" id="bm-cal-prev" aria-label="Previous month">‹</button>'
      + '<button type="button" class="bm-btn bm-btn-sm" id="bm-cal-today">Today</button>'
      + '<button type="button" class="bm-icon-btn" id="bm-cal-next" aria-label="Next month">›</button>'
      + '</div>' + body;
  };
  let data = cal.cache[key];
  if (!data) {
    main.innerHTML = shell(calendarGrid(null, today) + '<div class="bm-cal-day bm-muted">Loading birthdays…</div>');
    bindCalNav(seq);
    data = await B.month(cal.year, cal.month);
    if (stale(seq)) return;
    cal.cache[key] = data;
  }
  main.innerHTML = shell(calendarGrid(data, today) + '<div class="bm-cal-day" id="bm-cal-day" aria-live="polite"></div>' + membersNote());
  bindCalNav(seq);
  main.querySelectorAll('[data-md]').forEach(function (b) {
    b.addEventListener('click', function () {
      cal.selected = b.getAttribute('data-md');
      main.querySelectorAll('[data-md]').forEach(function (x) { x.classList.toggle('sel', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      showDay(data, b.getAttribute('data-keys').split(','), b.getAttribute('data-md'));
    });
  });
  const sel = main.querySelector('[data-md="' + cal.selected + '"]');
  if (sel) sel.click(); else document.getElementById('bm-cal-day').innerHTML = '<p class="bm-muted bm-center">Tap a date to see its birthdays.</p>';
  after(seq);
}

function bindCalNav(seq) {
  const go = function (delta) {
    if (delta === 0) {
      const t = new Date();
      cal.year = t.getFullYear(); cal.month = t.getMonth() + 1; cal.selected = C.mdFromDate(t);
    } else {
      const s = C.shiftMonth(cal.year, cal.month, delta);
      cal.year = s.year; cal.month = s.month;
      cal.selected = '';
    }
    render();
  };
  const p = document.getElementById('bm-cal-prev'), n = document.getElementById('bm-cal-next'), t = document.getElementById('bm-cal-today');
  if (p) p.onclick = function () { go(-1); };
  if (n) n.onclick = function () { go(1); };
  if (t) t.onclick = function () { go(0); };
}

function calendarGrid(data, today) {
  const weeks = C.monthGrid(cal.year, cal.month, today);
  let h = '<div class="bm-cal" role="grid" aria-label="' + esc(C.MONTHS[cal.month - 1] + ' ' + cal.year) + '">';
  h += '<div class="bm-cal-row bm-cal-wd" role="row">' + ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(function (d) { return '<span role="columnheader">' + d + '</span>'; }).join('') + '</div>';
  weeks.forEach(function (w) {
    h += '<div class="bm-cal-row" role="row">';
    w.forEach(function (c) {
      if (!c) { h += '<span class="bm-cal-cell bm-cal-pad" role="gridcell"></span>'; return; }
      let count = 0;
      if (data) c.keys.forEach(function (k) { count += (data[k] || []).length; });
      const label = c.day + ' ' + C.MONTHS[cal.month - 1] + (count ? ', ' + count + ' birthday' + (count > 1 ? 's' : '') : '');
      h += '<button type="button" role="gridcell" class="bm-cal-cell' + (c.isToday ? ' today' : '') + (count ? ' has' : '') + '" data-md="' + c.md + '" data-keys="' + c.keys.join(',') + '" aria-label="' + esc(label) + '" aria-pressed="false">'
        + '<span class="bm-cal-num">' + c.day + '</span>'
        + (count ? '<span class="bm-cal-mark" aria-hidden="true">🎂' + (count > 1 ? '<b>' + count + '</b>' : '') + '</span>' : '')
        + '</button>';
    });
    h += '</div>';
  });
  return h + '</div>';
}

function showDay(data, keys, md) {
  const box = document.getElementById('bm-cal-day');
  if (!box) return;
  let items = [];
  keys.forEach(function (k) { items = items.concat(data[k] || []); });
  const title = '🎂 Birthdays on ' + esc(C.formatMd(md));
  if (!items.length) {
    box.innerHTML = '<h2 class="bm-h2">' + title + '</h2><p class="bm-muted">No visible birthdays on this day.</p>';
    return;
  }
  box.innerHTML = '<h2 class="bm-h2">' + title + ' <span class="bm-pill">' + items.length + ' birthday' + (items.length > 1 ? 's' : '') + '</span></h2>'
    + '<div class="bm-grid">' + items.map(function (i) {
      const card = personCard(i, { showDate: i.md !== md });
      return card;
    }).join('') + '</div>';
  bindWishButtons(box);
}

// ── 💌 My Wishes ──────────────────────────────────────────────────────
async function viewWishes(seq) {
  await B.ready;
  if (!B.user()) {
    main.innerHTML = head('💌 My Wishes', 'Your birthday wishes', '')
      + signInPromptHtml('Sign in to see your wishes', 'Wishes sent to you are private. Only you can read them.');
    after(seq);
    return;
  }
  main.innerHTML = head('💌 My Wishes', 'Your birthday wishes', '') + skeleton(2);
  const [list, profile] = await Promise.all([B.myWishes(), B.getProfile()]);
  if (stale(seq)) return;
  B.markWishesSeen();
  updateBadge(0);
  const noProfile = !profile
    ? '<p class="bm-note">You don\'t have a Birthday Mate profile yet, so nobody can send you wishes. <a href="#profile">Create one →</a></p>'
    : profile.visibility === 'private'
      ? '<p class="bm-note">🔒 Your birthday is private, so nobody can send you new wishes. <a href="#profile">Change visibility →</a></p>' : '';
  if (!list.length) {
    main.innerHTML = head('💌 My Wishes', 'Your birthday wishes', '') + noProfile
      + emptyState('💌', "You haven't received any birthday wishes yet.", 'When someone sends you one, it will appear here.');
    after(seq);
    return;
  }
  main.innerHTML = head('💌 My Wishes', 'Your birthday wishes', list.length + ' wish' + (list.length > 1 ? 'es' : '') + ' received') + noProfile
    + '<div class="bm-wishes">' + list.map(wishCard).join('') + '</div>';
  main.querySelectorAll('[data-report]').forEach(function (b) {
    b.addEventListener('click', async function () {
      if (!confirm('Report this wish as inappropriate? An admin will review it.')) return;
      b.disabled = true;
      try { await B.reportWish(b.getAttribute('data-report')); toast('Reported. Thanks for keeping Birthday Mate kind.'); render(); }
      catch (e) { b.disabled = false; toast('Could not report. Please try again.', 'warn'); }
    });
  });
  main.querySelectorAll('[data-del]').forEach(function (b) {
    b.addEventListener('click', async function () {
      if (!confirm('Delete this wish? This cannot be undone.')) return;
      b.disabled = true;
      try { await B.deleteWish(b.getAttribute('data-del')); toast('Wish deleted.'); render(); }
      catch (e) { b.disabled = false; toast('Could not delete. Please try again.', 'warn'); }
    });
  });
  after(seq);
}

function wishCard(w) {
  const who = w.anon ? 'Someone' : esc(w.fromName || 'Someone');
  const when = w.at ? new Date(w.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  return '<article class="bm-wish' + (w.reported ? ' reported' : '') + '">'
    + '<p class="bm-wish-from">💌 ' + who + ' sent you a birthday wish</p>'
    + '<blockquote class="bm-wish-msg">“' + esc(w.msg) + '”</blockquote>'
    + '<div class="bm-row-between"><span class="bm-fine">' + esc(when) + (w.reported ? ' · Reported' : '') + '</span>'
    + '<span class="bm-wish-actions">'
    + (w.reported ? '' : '<button type="button" class="bm-link" data-report="' + esc(w.id) + '">Report</button>')
    + '<button type="button" class="bm-link bm-danger" data-del="' + esc(w.id) + '">Delete</button>'
    + '</span></div></article>';
}

// ── 👤 Profile ────────────────────────────────────────────────────────
const VIS = [
  ['public', 'Public', 'Anyone visiting the site can see your name, faculty, batch and birthday (day & month).'],
  ['members', 'SAU Members Only', 'Only signed-in Birthday Mate members can see you. Recommended.'],
  ['private', 'Private', 'Hidden from Birthday Twins, Today\'s Birthdays and the Calendar. Nobody can send you wishes.']
];

async function viewProfile(seq) {
  await B.ready;
  const u = B.user();
  if (!u) {
    main.innerHTML = head('👤 Profile', 'Your Birthday Mate profile', '')
      + signInPromptHtml('Sign in with Google', 'Create your profile to choose who sees your birthday, find your Birthday Twins and receive secret birthday wishes.');
    after(seq);
    return;
  }
  main.innerHTML = head('👤 Profile', 'Your Birthday Mate profile', '') + skeleton(1);
  const p = await B.getProfile(true);
  if (stale(seq)) return;
  const g = B.guestEntry();
  const v = p || {
    name: u.displayName || (g && g.name) || '',
    faculty: (g && g.faculty) || '',
    birthday: (g && g.birthday) || '',
    visibility: 'members'
  };
  const facs = C.FACULTIES.slice();
  if (v.faculty && facs.indexOf(v.faculty) < 0) facs.push(v.faculty);
  const hasPhoto = !!(u.photoURL && u.photoURL.indexOf('https://lh3.googleusercontent.com/') === 0);
  main.innerHTML = head('👤 Profile', p ? 'Your Birthday Mate profile' : 'Create your profile', p ? '' : 'Takes 20 seconds. You choose who can see it.')
    + '<form class="bm-form" id="bm-profile" novalidate>'
    + '<div class="bm-field"><label class="bm-label" for="pf-name">Name</label><input class="bm-input" id="pf-name" maxlength="60" autocomplete="name" value="' + esc(v.name) + '" required/></div>'
    + '<div class="bm-field"><label class="bm-label" for="pf-fac">Faculty</label><select class="bm-input" id="pf-fac" required><option value="">Select faculty</option>'
    + facs.map(function (f) { return '<option' + (f === v.faculty ? ' selected' : '') + '>' + esc(f) + '</option>'; }).join('') + '</select></div>'
    + '<div class="bm-field"><label class="bm-label" for="pf-batch">Batch <span class="bm-opt">(optional)</span></label><input class="bm-input" id="pf-batch" maxlength="20" placeholder="e.g. 2023 or Level-2" value="' + esc(v.batch || '') + '"/></div>'
    + '<div class="bm-field"><label class="bm-label" for="pf-dob">Date of birth</label>'
    + (p
      ? '<input class="bm-input" id="pf-dob" type="date" value="' + esc(p.birthday) + '" disabled/><p class="bm-fine">🔒 Your date of birth can\'t be changed. Others only ever see the day and month.</p>'
      : '<input class="bm-input" id="pf-dob" type="date" value="' + esc(v.birthday) + '" max="' + new Date().toISOString().slice(0, 10) + '" required/><p class="bm-fine">Others only ever see the day and month — never your year of birth. It can\'t be changed later.</p>')
    + '</div>'
    + '<fieldset class="bm-field bm-vis"><legend class="bm-label">Birthday visibility</legend>'
    + VIS.map(function (o) {
      return '<label class="bm-radio"><input type="radio" name="pf-vis" value="' + o[0] + '"' + (v.visibility === o[0] ? ' checked' : '') + '/>'
        + '<span><strong>' + o[1] + '</strong><small>' + o[2] + '</small></span></label>';
    }).join('') + '</fieldset>'
    + (hasPhoto ? '<label class="bm-check"><input type="checkbox" id="pf-photo"' + (p && p.photo ? ' checked' : '') + '/> <span>Show my Google profile photo on my card</span></label>' : '')
    + '<p class="bm-fine" id="pf-err" role="alert"></p>'
    + '<button type="submit" class="bm-btn bm-btn-primary bm-full" id="pf-save">' + (p ? 'Save changes' : 'Create profile') + '</button>'
    + '</form>'
    + '<div class="bm-account">'
    + '<div class="bm-account-row">' + avatar({ name: u.displayName || u.email || '?', photo: hasPhoto ? u.photoURL : '' }, 'sm')
    + '<span><span class="bm-fine">Signed in as</span><br/><strong>' + esc(u.email || u.displayName || '') + '</strong><br/><span class="bm-fine">Only you can see your email.</span></span></div>'
    + '<div class="bm-account-actions"><button type="button" class="bm-btn bm-btn-sm" id="pf-out">Sign out</button>'
    + (p ? '<button type="button" class="bm-btn bm-btn-sm bm-btn-danger" id="pf-del">Delete my profile</button>' : '') + '</div></div>';

  const form = document.getElementById('bm-profile');
  const errEl = document.getElementById('pf-err');
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    errEl.textContent = '';
    const btn = document.getElementById('pf-save');
    const visEl = form.querySelector('input[name="pf-vis"]:checked');
    const input = {
      name: document.getElementById('pf-name').value,
      faculty: document.getElementById('pf-fac').value,
      batch: document.getElementById('pf-batch').value,
      birthday: document.getElementById('pf-dob').value,
      visibility: visEl ? visEl.value : 'members',
      showPhoto: !!(document.getElementById('pf-photo') && document.getElementById('pf-photo').checked)
    };
    if (!p) {
      const dErr = C.validateDob(input.birthday);
      if (dErr) { errEl.textContent = dErr; return; }
      if (!confirm('Save ' + C.formatMd(C.mdFromDob(input.birthday)) + ' ' + input.birthday.slice(0, 4) + ' as your date of birth? It can\'t be changed later.')) return;
    }
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const res = await B.saveProfile(input);
      toast(res.claimed ? 'Profile saved ✓ Your earlier Birthday Mate entry is now linked.' : 'Profile saved ✓');
      cal.cache = {};
      render();
    } catch (ex) {
      errEl.textContent = /permission/i.test(ex && (ex.code || ex.message) || '') ? 'Could not save. Please check your details and try again.' : (ex.message || 'Could not save.');
      btn.disabled = false; btn.textContent = p ? 'Save changes' : 'Create profile';
    }
  });
  document.getElementById('pf-out').addEventListener('click', async function () { await B.signOut(); toast('Signed out'); });
  const del = document.getElementById('pf-del');
  if (del) del.addEventListener('click', async function () {
    if (!confirm('Delete your Birthday Mate profile? You will disappear from Twins, Today and the Calendar. Received wishes stay in "My Wishes" until you delete them.')) return;
    del.disabled = true;
    try { await B.deleteProfile(); cal.cache = {}; toast('Profile deleted'); render(); }
    catch (e) { del.disabled = false; toast('Could not delete. Please try again.', 'warn'); }
  });
  after(seq);
}

// ── header: auth state + wish badge ───────────────────────────────────
const authBox = document.getElementById('bm-auth');
function renderAuth(u) {
  if (!authBox) return;
  if (!u) {
    authBox.innerHTML = '<button type="button" class="bm-btn bm-btn-sm bm-btn-google" id="bm-hdr-in">' + GOOGLE_G + '<span>Sign in</span></button>';
    document.getElementById('bm-hdr-in').addEventListener('click', doSignIn);
  } else {
    const hasPhoto = u.photoURL && u.photoURL.indexOf('https://lh3.googleusercontent.com/') === 0;
    authBox.innerHTML = '<a href="#profile" class="bm-me" aria-label="My profile">' + avatar({ name: u.displayName || u.email || '?', photo: hasPhoto ? u.photoURL : '' }, 'sm') + '</a>';
  }
}
function updateBadge(n) {
  const b = document.getElementById('bm-wish-badge');
  if (!b) return;
  b.textContent = n > 9 ? '9+' : String(n);
  b.hidden = !n;
}

let firstAuth = true;
B.onUser(function (u) {
  renderAuth(u);
  cal.cache = {};
  if (firstAuth) { firstAuth = false; render(); return; }
  closeModal(true);
  render();
});
B.watchWishCount(function (fresh) { if (route() !== 'wishes') updateBadge(fresh); });
window.addEventListener('hashchange', function () { render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
