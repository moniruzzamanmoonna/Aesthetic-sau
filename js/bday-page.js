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
const ROUTES = ['twins', 'districts', 'today', 'calendar', 'wishes', 'profile'];
let renderSeq = 0;

function route() {
  const h = (location.hash || '').replace(/^#\/?/, '').split(/[/?]/)[0];
  return ROUTES.indexOf(h) >= 0 ? h : 'today';
}

function setActiveTab(r) {
  const tab = r === 'districts' ? 'twins' : r;
  document.querySelectorAll('.bm-tabs a[data-tab]').forEach(function (a) {
    const on = a.getAttribute('data-tab') === tab;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const titles = { twins: 'Birthday Twins', districts: 'District Mates', today: "Today's Birthdays", calendar: 'Birthday Calendar', wishes: 'My Wishes', profile: 'My Birthday Profile' };
  document.title = titles[r] + ' — Birthday Mate · Aesthetic SAU';
}

async function render() {
  const r = route();
  const seq = ++renderSeq;
  setActiveTab(r);
  try { ACCESS = await B.access(); } catch (e) { /* keep last known */ }
  if (seq !== renderSeq) return;
  const views = { twins: viewTwins, districts: viewDistricts, today: viewToday, calendar: viewCalendar, wishes: viewWishes, profile: viewProfile };
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
// Give-to-get: members-only birthdays are shown only to people who share their own.
let ACCESS = { signedIn: false, hasProfile: false, sharing: false, visibility: '' };
function membersNote() {
  if (!ACCESS.signedIn) return '<p class="bm-note">🔒 Some birthdays are shared with <strong>SAU members only</strong>. <button type="button" class="bm-link" data-signin>Sign in</button> and share your birthday to see them too.</p>';
  if (!ACCESS.hasProfile) return '<p class="bm-note">🔒 Members-only birthdays are visible to people who share their own. <a href="#profile">Create your profile →</a></p>';
  if (!ACCESS.sharing) return '<p class="bm-note">🔒 Your birthday is private, so members-only birthdays are hidden from you too. <a href="#profile">Share yours (Public or SAU Members Only) →</a></p>';
  return '';
}
/** "🔒 N more birthdays — sign in to see them" (counts come from bday-marks, never names). */
function lockedHtml(n, more) {
  if (!n) return '';
  const what = n + (more ? ' more' : '') + ' birthday' + (n > 1 ? 's' : '');
  let text, action;
  if (!ACCESS.signedIn) {
    text = 'Please sign in to see others\' birthdays.';
    action = '<button type="button" class="bm-btn bm-btn-google bm-btn-sm" data-signin>' + GOOGLE_G + 'Sign in with Google</button>';
  } else if (!ACCESS.hasProfile) {
    text = 'Create your profile and share your birthday to see them.';
    action = '<a class="bm-btn bm-btn-primary bm-btn-sm" href="#profile">Create my profile</a>';
  } else {
    text = 'Your birthday is private. Share yours (Public or SAU Members Only) to see them.';
    action = '<a class="bm-btn bm-btn-primary bm-btn-sm" href="#profile">Change visibility</a>';
  }
  return '<div class="bm-locked"><span class="bm-locked-icon" aria-hidden="true">🔒</span>'
    + '<span class="bm-locked-text"><b>' + what + '</b><small>' + text + '</small></span>' + action + '</div>';
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
  const [items, hiddenN] = await Promise.all([B.birthdaysOn(now), B.hiddenOn(C.celebrationKeys(now))]);
  if (stale(seq)) return;
  const total = items.length + hiddenN;
  const leapNote = items.some(function (i) { return i.md === '02-29'; }) && !(now.getMonth() === 1 && now.getDate() === 29)
    ? '<p class="bm-note">🐸 Leap-day babies (29 February) are celebrated today because this year has no 29 February.</p>' : '';
  main.innerHTML = head('🎉 Birthday Today', esc(C.formatLongDate(now)),
    total ? 'Happy Birthday! 🎂 ' + total + ' SAU ' + (total === 1 ? 'student is' : 'students are') + ' celebrating today.' : 'Happy Birthday! 🎂')
    + leapNote
    + (items.length ? '<div class="bm-grid">' + items.map(function (i) { return personCard(i, { showDate: false }); }).join('') + '</div>' : '')
    + (hiddenN ? lockedHtml(hiddenN, items.length > 0) : '')
    + (total ? '' : emptyState('🎈', 'No Birthday Mates today.', 'Tomorrow is another day to celebrate! 💚',
        '<a class="bm-btn" href="#calendar">🗓️ Open the calendar</a>'))
    + (hiddenN ? '' : membersNote());
  after(seq);
}

// ── 🎂 Twins ──────────────────────────────────────────────────────────
async function viewTwins(seq) {
  main.innerHTML = seg('twins') + head('🎂 Birthday Twins', 'Your Birthday Twins', '') + skeleton(3);
  const res = await B.twins();
  if (stale(seq)) return;
  if (!res.md) {
    main.innerHTML = seg('twins') + head('🎂 Birthday Twins', 'Your Birthday Twins', 'Same day and month, any year.')
      + emptyState('🎂', 'Add your birthday to find your twins', 'Create your Birthday Mate profile, or use the quick form on the homepage.',
        '<a class="bm-btn bm-btn-primary" href="#profile">Create my profile</a><a class="bm-btn" href="index.html#birthday">Quick form</a>');
    after(seq);
    return;
  }
  const hiddenN = await B.hiddenOn([res.md]);
  if (stale(seq)) return;
  const dateTxt = esc(C.formatMd(res.md));
  const n = res.items.length + hiddenN;
  const sub = n
    ? 'You share your birthday (<strong>' + dateTxt + '</strong>) with ' + n + ' other SAU ' + (n === 1 ? 'student' : 'students') + '.'
    : 'Your birthday: <strong>' + dateTxt + '</strong>';
  const leap = res.md === '02-29' ? '<p class="bm-note">🐸 Leap-day birthday! Your twins are others born on 29 February.</p>' : '';
  main.innerHTML = seg('twins') + head('🎂 Birthday Twins', 'Your Birthday Twins', sub) + leap
    + (res.items.length ? '<div class="bm-grid">' + res.items.map(function (i) { return personCard(i); }).join('') + '</div>' : '')
    + (hiddenN ? lockedHtml(hiddenN, res.items.length > 0) : '')
    + (n ? '' : emptyState('🌱', "No Birthday Twins found yet. Maybe you're the first one!", 'Maybe someone with the same birthday will join soon! 🎂'))
    + (hiddenN ? '' : membersNote());
  after(seq);
}

// ── 🗓️ Calendar ───────────────────────────────────────────────────────
const cal = { year: 0, month: 0, selected: '', cache: {} };
function calKey(y, m) { return y + '-' + m + '-' + (ACCESS.sharing ? 'm' : B.user() ? 's' : 'p'); }

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
  const anyHidden = Object.keys(data.hidden).length > 0;
  main.innerHTML = shell(calendarGrid(data, today) + '<div class="bm-cal-day" id="bm-cal-day" aria-live="polite"></div>' + (anyHidden ? '' : membersNote()));
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
      if (data) c.keys.forEach(function (k) { count += (data.byMd[k] || []).length + (data.hidden[k] || 0); });
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
  let hiddenN = 0;
  keys.forEach(function (k) { items = items.concat(data.byMd[k] || []); hiddenN += data.hidden[k] || 0; });
  const total = items.length + hiddenN;
  const title = '🎂 Birthdays on ' + esc(C.formatMd(md));
  if (!total) {
    box.innerHTML = '<h2 class="bm-h2">' + title + '</h2><p class="bm-muted">No visible birthdays on this day.</p>';
    return;
  }
  box.innerHTML = '<h2 class="bm-h2">' + title + ' <span class="bm-pill">' + total + ' birthday' + (total > 1 ? 's' : '') + '</span></h2>'
    + (items.length ? '<div class="bm-grid">' + items.map(function (i) { return personCard(i, { showDate: i.md !== md }); }).join('') + '</div>' : '')
    + lockedHtml(hiddenN, items.length > 0);
  bindWishButtons(box);
  bindSignIn(box, render);
}

// ── 📍 District Mates ─────────────────────────────────────────────────
function seg(active) {
  return '<nav class="bm-seg" aria-label="Mates">'
    + '<a href="#twins"' + (active === 'twins' ? ' class="active" aria-current="page"' : '') + '>🎂 Birthday Twins</a>'
    + '<a href="#districts"' + (active === 'districts' ? ' class="active" aria-current="page"' : '') + '>📍 District Mates</a></nav>';
}
const dist = { showAll: false, selected: '' };

async function viewDistricts(seq) {
  main.innerHTML = seg('districts') + head('📍 District Mates', 'Your District Mates', '') + skeleton(2);
  const [dc, profile] = await Promise.all([B.districtCounts(), ACCESS.hasProfile ? B.getProfile() : Promise.resolve(null)]);
  const counts = dc.total;
  if (stale(seq)) return;
  const myDk = profile && profile.district ? C.districtKey(profile.district) : '';
  let mine = '';
  if (myDk) {
    const people = (await B.districtPeople(myDk)).filter(function (p) { return !p.isSelf; });
    if (stale(seq)) return;
    const total = Math.max(0, (counts[myDk] || 0) - (profile.visibility !== 'private' ? 1 : 0));
    const liveOthers = Math.max(0, (+dc.live[myDk] || 0) - (profile.visibility !== 'private' ? 1 : 0));
    mine = (people.length ? '<div class="bm-grid">' + people.map(function (p) { return personCard(p, { showDate: false }); }).join('') + '</div>' : '')
      + districtHidden(Math.max(0, liveOthers - people.length), +dc.legacy[myDk] || 0, people.length > 0)
      + (total ? '' : emptyState('🌱', 'No District Mates yet', 'You\'re the first SAUian from ' + esc(profile.district) + ' here. Share Birthday Mate with friends from home! 💚'));
    mine = '<p class="bm-sub bm-dist-sub">' + (total ? total + ' other SAUian' + (total > 1 ? 's' : '') + ' from <strong>' + esc(profile.district) + '</strong>' : '') + '</p>' + mine;
  } else {
    mine = emptyState('📍', 'Add your district to find District Mates',
      ACCESS.signedIn ? 'Pick your home district in your profile. It\'s optional.' : 'Sign in, create your profile and pick your home district.',
      ACCESS.signedIn ? '<a class="bm-btn bm-btn-primary" href="#profile">Add my district</a>' : '<button type="button" class="bm-btn bm-btn-google" data-signin>' + GOOGLE_G + 'Sign in with Google</button>');
  }
  main.innerHTML = seg('districts') + head('📍 District Mates', myDk ? 'From ' + esc(profile.district) : 'District Mates', myDk ? '' : 'Find SAUians from your home district.')
    + mine + districtChart(counts, myDk);
  bindDistrictChart(dc);
  after(seq);
}

/** People counted in a district but not listed: either locked for this viewer, or anonymous earlier registrations. */
function districtHidden(locked, anon, more) {
  return (locked ? districtLockedHtml(locked, more) : '')
    + (anon ? '<p class="bm-note">+ ' + anon + ' from earlier registrations, which stay anonymous.</p>' : '');
}
function districtLockedHtml(n, more) {
  // same wording/actions as the birthday lock, but about people from a district
  return lockedHtml(n, more).replace(/birthday(s?)<\/b>/, 'SAUian$1</b>').replace('see others\' birthdays', 'see them');
}

function districtChart(counts, myDk) {
  const rows = Object.keys(counts).filter(function (k) { return counts[k] > 0 && C.districtName(k); })
    .sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
  if (!rows.length) return '';
  const total = rows.reduce(function (s, k) { return s + counts[k]; }, 0);
  const max = counts[rows[0]];
  const shown = dist.showAll ? rows : rows.slice(0, 10);
  return '<section class="bm-dist" aria-labelledby="bm-dist-title">'
    + '<h2 class="bm-h2" id="bm-dist-title">🗺️ SAUians by district <span class="bm-pill">' + total + ' from ' + rows.length + ' districts</span></h2>'
    + '<p class="bm-fine">Tap a district to see who\'s from there. Counts include earlier registrations; names are shown only for people who share them.</p>'
    + '<div class="bm-bars">' + shown.map(function (k) {
      const w = Math.max(4, Math.round(counts[k] / max * 100));
      return '<button type="button" class="bm-bar' + (k === myDk ? ' mine' : '') + (k === dist.selected ? ' sel' : '') + '" data-dk="' + k + '" aria-label="' + esc(C.districtName(k)) + ': ' + counts[k] + '">'
        + '<span class="bm-bar-name">' + esc(C.districtName(k)) + (k === myDk ? ' <i>You</i>' : '') + '</span>'
        + '<span class="bm-bar-track"><span class="bm-bar-fill" style="width:' + w + '%"></span></span>'
        + '<span class="bm-bar-n">' + counts[k] + '</span></button>';
    }).join('') + '</div>'
    + (rows.length > 10 ? '<button type="button" class="bm-link bm-dist-more" id="bm-dist-more">' + (dist.showAll ? 'Show top 10' : 'Show all ' + rows.length + ' districts') + '</button>' : '')
    + '<div id="bm-dist-pick" aria-live="polite"></div></section>';
}

function bindDistrictChart(dc) {
  const counts = dc.total;
  const more = document.getElementById('bm-dist-more');
  if (more) more.addEventListener('click', function () { dist.showAll = !dist.showAll; render(); });
  main.querySelectorAll('[data-dk]').forEach(function (b) {
    b.addEventListener('click', async function () {
      const dk = b.getAttribute('data-dk');
      dist.selected = dk;
      main.querySelectorAll('[data-dk]').forEach(function (x) { x.classList.toggle('sel', x === b); });
      const box = document.getElementById('bm-dist-pick');
      box.innerHTML = '<p class="bm-muted">Loading…</p>';
      try {
        const people = await B.districtPeople(dk);
        const locked = Math.max(0, (+dc.live[dk] || 0) - people.length);
        box.innerHTML = '<h3 class="bm-h2 bm-h3">📍 ' + esc(C.districtName(dk)) + ' <span class="bm-pill">' + (counts[dk] || 0) + '</span></h3>'
          + (people.length ? '<div class="bm-grid">' + people.map(function (p) { return personCard(p, { showDate: false }); }).join('') + '</div>' : '')
          + districtHidden(locked, +dc.legacy[dk] || 0, people.length > 0);
        bindWishButtons(box);
        bindSignIn(box, render);
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (e) {
        box.innerHTML = '<p class="bm-muted">Couldn\'t load this district. Please try again.</p>';
      }
    });
  });
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
  ['public', 'Public', 'Anyone can see your name, faculty, batch and birthday (day & month) and send you a wish, no sign-in needed. Recommended.'],
  ['members', 'SAU Members Only', 'Only signed-in members who share their own birthday can see you.'],
  ['private', 'Private', 'Hidden from Birthday Twins, Today\'s Birthdays and the Calendar. Nobody can send you wishes, and you won\'t see members-only birthdays either.']
];

async function viewProfile(seq) {
  await B.ready;
  const u = B.user();
  if (!u) {
    main.innerHTML = head('👤 Profile', 'Your Birthday Mate profile', '')
      + signInPromptHtml('Sign in with Google', 'Create your profile to choose who sees your birthday, find your Birthday Twins and receive secret birthday wishes.')
      + anonBoxCard();
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
    visibility: 'public'
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
    + '<div class="bm-field"><label class="bm-label" for="pf-district">District <span class="bm-opt">(optional)</span></label><select class="bm-input" id="pf-district"><option value="">Choose your district</option>'
    + C.DISTRICTS.map(function (d) { return '<option' + (d === v.district ? ' selected' : '') + '>' + esc(d) + '</option>'; }).join('') + '</select>'
    + '<p class="bm-fine">📍 For District Mates. Shown on your card to the same people who can see your birthday.</p></div>'
    + '<div class="bm-field"><label class="bm-label" for="pf-anon">AnonBox username <span class="bm-opt">(optional)</span></label>'
    + '<div class="bm-prefix"><span>anon-box2026.web.app/u/</span><input class="bm-input" id="pf-anon" maxlength="80" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="username" value="' + esc(v.anonbox || '') + '"/></div>'
    + '<p class="bm-fine">💬 Adds an "Anonymous message" button to your card, so people can text you on AnonBox. You can paste your AnonBox link too. No AnonBox yet? <a href="https://anon-box2026.web.app" target="_blank" rel="noopener noreferrer">Create one free →</a></p></div>'
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
    + (p ? '<button type="button" class="bm-btn bm-btn-sm" id="pf-link">Link an earlier registration</button><button type="button" class="bm-btn bm-btn-sm bm-btn-danger" id="pf-del">Delete my profile</button>' : '') + '</div></div>'
    + anonBoxCard();

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
      district: document.getElementById('pf-district').value,
      anonbox: document.getElementById('pf-anon').value,
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
      await render();
      // First profile: ask whether one of the earlier (no-login) registrations is this person.
      if (!p && !res.claimed) offerClaim(true);
    } catch (ex) {
      errEl.textContent = /permission/i.test(ex && (ex.code || ex.message) || '') ? 'Could not save. Please check your details and try again.' : (ex.message || 'Could not save.');
      btn.disabled = false; btn.textContent = p ? 'Save changes' : 'Create profile';
    }
  });
  document.getElementById('pf-out').addEventListener('click', async function () { await B.signOut(); toast('Signed out'); });
  const link = document.getElementById('pf-link');
  if (link) link.addEventListener('click', function () { offerClaim(false); });
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

// ── "Is one of these you?" — link an earlier no-login registration ───
async function offerClaim(auto) {
  let list = [];
  try { list = await B.claimCandidates(); } catch (e) { list = []; }
  if (!list.length) { if (!auto) toast('No earlier registrations found on your birthday.'); return; }
  const day = esc(C.formatMd(list[0].md));
  const m = openModal('<div class="bm-modal-icon" aria-hidden="true">🎂</div>'
    + '<h2 class="bm-modal-title" id="bm-modal-title">' + (list.length === 1 ? 'Is this you?' : 'Is one of these you?') + '</h2>'
    + '<p class="bm-modal-text">' + (list.length === 1 ? 'Someone' : list.length + ' people') + ' registered earlier with your birthday (' + day + '). If one of them is you, we\'ll sync it with your account.</p>'
    + '<div class="bm-claim-list">' + list.map(function (c) {
      return '<button type="button" class="bm-claim" data-claim="' + esc(c.key) + '">' + avatar(c, 'sm')
        + '<span class="bm-claim-who"><b>' + esc(c.name) + '</b><small>' + esc(c.faculty) + '</small></span>'
        + '<span class="bm-claim-yes">This is me</span></button>';
    }).join('') + '</div>'
    + '<p class="bm-fine" id="bm-claim-err" role="alert"></p>'
    + '<button type="button" class="bm-btn bm-full" data-close>None of these — I\'m new</button>'
    + '<p class="bm-fine bm-center">For safety, an entry is linked only if its full date of birth matches yours.</p>',
    { focus: '.bm-claim' });
  m.querySelectorAll('[data-claim]').forEach(function (b) {
    b.addEventListener('click', async function () {
      const err = m.querySelector('#bm-claim-err');
      err.textContent = '';
      m.querySelectorAll('[data-claim]').forEach(function (x) { x.disabled = true; });
      try {
        await B.claimEntry(b.getAttribute('data-claim'));
        m.querySelector('.bm-modal-box').innerHTML = '<button type="button" class="bm-modal-x" data-close aria-label="Close">✕</button>'
          + '<div class="bm-modal-icon bm-pop" aria-hidden="true">💚</div>'
          + '<h2 class="bm-modal-title" id="bm-modal-title">Synced with your account ✓</h2>'
          + '<p class="bm-modal-text">Your earlier registration is now part of your profile, and your visibility choice applies to it.</p>'
          + '<button type="button" class="bm-btn bm-btn-primary bm-full" data-close>Done</button>';
        cal.cache = {};
        render();
      } catch (e) {
        err.textContent = e.message || 'Could not link this entry.';
        m.querySelectorAll('[data-claim]').forEach(function (x) { x.disabled = false; });
        b.disabled = true;
      }
    });
  });
}

// ── 💬 AnonBox: get anonymous messages ────────────────────────────────
function anonBoxCard() {
  return '<a class="bm-anonbox" href="https://anon-box2026.web.app" target="_blank" rel="noopener noreferrer">'
    + '<span class="bm-anonbox-icon" aria-hidden="true">💬</span>'
    + '<span class="bm-anonbox-text"><b>Get anonymous messages</b><small>Share your AnonBox link and let friends send you anonymous messages — no login needed.</small></span>'
    + '<span class="bm-anonbox-go" aria-hidden="true">→</span></a>';
}