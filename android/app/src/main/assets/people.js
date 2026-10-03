// Вкладка «Поиск»: расписание любой группы и преподавателя. Данные те же, что уже скачаны
// (PDF всех курсов), с сайта ничего дополнительно не грузим. Здесь только разметка и поиск.
import { normGroup, toMin } from './engine.js';
import { ICONS } from './stickers.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const low = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
const squash = (s) => low(s).replace(/[\s.]+/g, '');
const WD = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const wdOf = (iso) => (new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7;
const dayTitle = (iso, today) => {
  const t = `${iso === today ? 'Сегодня, ' : ''}${WD[wdOf(iso)]}, ${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]}`;
  return t[0].toUpperCase() + t.slice(1);
};
function plural(n) {
  if (n % 10 === 1 && n % 100 !== 11) return 'пара';
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) return 'пары';
  return 'пар';
}

// ---------------------------------------------------------------- преподаватели

const NAME_RE = /([А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?)\s*([А-ЯЁ])(?:\.\s*|\s+|$)(?:([А-ЯЁ])\.?)?/u;

/** «Пауль С. А.» и «Пауль С.А.» один человек: ключ «пауль са». */
export function teacherKey(name) {
  const m = NAME_RE.exec(String(name || ''));
  return m ? low(`${m[1]} ${m[2]}${m[3] || ''}`) : low(name).trim();
}
function teacherName(name) {
  const m = NAME_RE.exec(String(name || ''));
  return m ? `${m[1]} ${m[2]}.${m[3] ? m[3] + '.' : ''}` : String(name || '').trim();
}

const splitKey = (k) => { const i = k.lastIndexOf(' '); return i < 0 ? [k, ''] : [k.slice(0, i), k.slice(i + 1)]; };
/** Слова отличаются ровно одной буквой: заменой, пропуском или лишней буквой. */
function oneEdit(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

const cache = new WeakMap();
/**
 * Все преподаватели из расписания всех групп: key -> {key, name, lessons: [{date, pairs, start, end,
 * subject, kind, room, groups}]}. Пара сразу у нескольких групп (поток) идёт одной записью.
 */
export function teacherIndex(data) {
  if (!data || !data.groups) return new Map();
  if (cache.has(data)) return cache.get(data);
  const idx = new Map();
  for (const g of Object.values(data.groups)) {
    for (const [date, ls] of Object.entries(g.days || {})) {
      for (const l of ls) {
        if (!l.teacher || !l.pairs.length || l.cancelled) continue;
        const key = teacherKey(l.teacher);
        if (!key) continue;
        if (!idx.has(key)) idx.set(key, { key, name: teacherName(l.teacher), lessons: [] });
        idx.get(key).lessons.push({ date, pairs: l.pairs, start: l.start, end: l.end, subject: l.subject, kind: l.kind, room: l.room, groups: [g.name] });
      }
    }
  }
  // написание с опечаткой -> основной ключ (фамилия в карточке пары нажимается и с опечаткой)
  idx.alias = new Map();
  const absorb = (into, key) => {
    const t = idx.get(key);
    into.lessons.push(...t.lessons);
    into.aliases = [...new Set([...(into.aliases || []), t.name, ...(t.aliases || [])])];
    for (const [a, to] of idx.alias) if (to === key) idx.alias.set(a, into.key);
    idx.alias.set(key, into.key);
    idx.delete(key);
  };
  // «Рогулин В» без второго инициала: если такой Рогулин В.* один, это он
  for (const key of [...idx.keys()]) {
    if (!/ \S$/u.test(key)) continue;
    const full = [...idx.keys()].filter((k) => k !== key && k.startsWith(key) && k.length === key.length + 1);
    if (full.length === 1) absorb(idx.get(full[0]), key);
  }
  // опечатки в фамилии в PDF («Литвинва О.В.», «Литвиновв О.В.» рядом с «Литвинова О.В.»): те же
  // два инициала и одна буква разницы. Основное написание то, что ближе всех к остальным.
  // «Литвинов» и «Литвинова» разные люди: такие группы не склеиваем.
  const keys = [...idx.keys()];
  const gender = (a, b) => a + 'а' === b || b + 'а' === a;
  const near = (a, b) => {
    const [s1, i1] = splitKey(a), [s2, i2] = splitKey(b);
    return i1.length === 2 && i1 === i2 && Math.min(s1.length, s2.length) >= 5 && !gender(s1, s2) && oneEdit(s1, s2);
  };
  const root = new Map(keys.map((k) => [k, k]));
  const top = (k) => (root.get(k) === k ? k : top(root.get(k)));
  const degree = new Map(keys.map((k) => [k, 0]));
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      if (!near(keys[i], keys[j])) continue;
      degree.set(keys[i], degree.get(keys[i]) + 1);
      degree.set(keys[j], degree.get(keys[j]) + 1);
      root.set(top(keys[j]), top(keys[i]));
    }
  }
  const clusters = new Map();
  for (const k of keys) { const r = top(k); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(k); }
  const distinct = (k) => new Set(idx.get(k).lessons.map((l) => `${l.date} ${l.pairs}`)).size;
  for (const ks of clusters.values()) {
    if (ks.length < 2 || ks.some((a) => ks.some((b) => gender(splitKey(a)[0], splitKey(b)[0])))) continue;
    const main = ks.reduce((a, b) => (degree.get(b) > degree.get(a) || (degree.get(b) === degree.get(a) && distinct(b) > distinct(a)) ? b : a));
    for (const k of ks) if (k !== main) absorb(idx.get(main), k);
  }
  for (const t of idx.values()) {
    const merged = [];
    for (const l of t.lessons) {
      const same = merged.find((x) => x.date === l.date && x.pairs.join() === l.pairs.join() && x.subject === l.subject && x.room === l.room);
      if (same) { for (const g of l.groups) if (!same.groups.includes(g)) same.groups.push(g); } else merged.push({ ...l, groups: [...l.groups] });
    }
    t.lessons = merged.sort((a, b) => a.date.localeCompare(b.date) || a.pairs[0] - b.pairs[0]);
  }
  cache.set(data, idx);
  return idx;
}

/** Преподаватель по ключу (в том числе по написанию с опечаткой). */
export function findTeacher(data, key) {
  const idx = teacherIndex(data);
  return idx.get(key) || idx.get(idx.alias && idx.alias.get(key)) || null;
}

/** Поиск по группам (номер) и преподавателям (фамилия). */
export function searchAll(data, query) {
  const q = low(query).trim();
  if (!q || !data || !data.groups) return { groups: [], teachers: [] };
  const nq = normGroup(query);
  const groups = /\d/.test(q)
    ? Object.entries(data.groups).filter(([k]) => k.includes(nq)).slice(0, 30).map(([k, g]) => ({ norm: k, name: g.name }))
    : [];
  const sq = squash(q);
  const teachers = sq.length < 2 ? [] : [...teacherIndex(data).values()]
    .filter((t) => [t.name, ...(t.aliases || [])].some((n) => squash(n).includes(sq)))
    .sort((a, b) => (squash(a.name).startsWith(sq) ? 0 : 1) - (squash(b.name).startsWith(sq) ? 0 : 1) || a.name.localeCompare(b.name, 'ru'))
    .slice(0, 30);
  return { groups, teachers };
}

/** Где преподаватель сейчас или где будет дальше. */
export function teacherNow(t, today, min) {
  const now = t.lessons.find((l) => l.date === today && l.start && l.end && toMin(l.start) <= min && min < toMin(l.end));
  if (now) return { kind: 'now', l: now };
  const next = t.lessons.find((l) => l.start && (l.date > today || (l.date === today && toMin(l.start) > min)));
  return next ? { kind: 'next', l: next } : null;
}

// ---------------------------------------------------------------- разметка

export const backLink = (label = 'Назад') =>
  `<button type="button" class="back-link press" data-act="find-back"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M15 5l-7 7 7 7"/></svg>${esc(label)}</button>`;

export function searchShellHtml() {
  return `<div class="day-head"><h2>Поиск</h2><span class="sum">группы и преподаватели</span></div>
    <form id="searchForm" autocomplete="off"><input id="searchInput" class="search" type="search" placeholder="Группа или фамилия, например 2507" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search"></form>
    <div id="searchResults"></div>
    <section class="card-flat why">
      <h3>Зачем это</h3>
      <p><b>Другая группа.</b> Посмотреть расписание друга или соседней подгруппы, не меняя свою.</p>
      <p><b>Преподаватель.</b> Узнать, где и когда у него пары на этой неделе, чтобы подойти сдать долг или задать вопрос. Можно и прямо из расписания: нажми на фамилию у пары.</p>
      <p>Твоя группа и уведомления от этого не меняются.</p>
    </section>`;
}

export function searchResultsHtml(res, recent, q) {
  if (!q.trim()) {
    if (!recent.length) return '';
    return `<h3 class="sec-title">Недавно смотрел</h3><div class="chips">${recent.map((r) =>
      `<button type="button" class="chip-toggle press" data-open-${r.type}="${esc(r.id)}">${r.type === 'teacher' ? ICONS.user : ''}${esc(r.label)}</button>`).join('')}</div>`;
  }
  if (!res.groups.length && !res.teachers.length) {
    return `<p class="hint sec-empty">Ничего не нашлось. ${/\d/.test(q) ? 'Проверь номер группы.' : 'Проверь фамилию. Ищу только тех, у кого есть пары на этой неделе.'}</p>`;
  }
  let html = '';
  if (res.groups.length) {
    html += `<h3 class="sec-title">Группы</h3><div class="chips">${res.groups.map((g) =>
      `<button type="button" class="chip-toggle press" data-open-group="${esc(g.norm)}">${esc(g.name)}</button>`).join('')}</div>`;
  }
  if (res.teachers.length) {
    html += `<h3 class="sec-title">Преподаватели</h3><div class="card-flat list">${res.teachers.map((t) =>
      `<button type="button" class="list-row press" data-open-teacher="${esc(t.key)}"><span><b>${esc(t.name)}</b><small>${t.lessons.length} ${plural(t.lessons.length)} на этой неделе</small></span>${ICONS.arrow}</button>`).join('')}</div>`;
  }
  return html;
}

/** Плашка над чужой группой: чьё это расписание и что своя группа не изменилась. */
export function otherGroupBanner(name, mine) {
  return `<div class="note-card other">${ICONS.user}<div><b>Расписание группы ${esc(name)}</b>
    <span>Только посмотреть. Твоя группа ${esc(mine)}, уведомления приходят для неё.</span></div></div>`;
}

export function teacherHtml(t, { today, min, kindPill = () => '' }) {
  if (!t) return '<p class="hint sec-empty">Этого преподавателя нет в расписании на эту неделю.</p>';
  let html = `<div class="day-head"><h2>${esc(t.name)}</h2><span class="sum">${t.lessons.length} ${plural(t.lessons.length)} на этой неделе</span></div>`;
  const nw = teacherNow(t, today, min);
  if (nw) {
    const l = nw.l;
    const title = nw.kind === 'now' ? `Сейчас на паре, до ${l.end}` : `Ближайшая пара: ${l.date === today ? 'сегодня' : dayTitle(l.date, today).toLowerCase()} в ${l.start}`;
    const where = [l.room && `ауд. ${l.room}`, `${l.groups.length > 1 ? 'группы' : 'группа'} ${l.groups.join(', ')}`].filter(Boolean).join(', ');
    html += `<div class="note-card${nw.kind === 'now' ? ' now' : ''}">${ICONS.pin}<div><b>${esc(title)}</b>
      <span>${esc(where)}. ${esc(l.subject)}</span></div></div>`;
  } else {
    html += '<p class="hint sec-empty">На этой неделе пар больше нет.</p>';
  }
  let lastDate = '';
  t.lessons.forEach((l, i) => {
    if (l.date !== lastDate) { html += `<h3 class="sec-title">${esc(dayTitle(l.date, today))}</h3>`; lastDate = l.date; }
    const num = l.pairs.length > 1 ? `${l.pairs[0]}-${l.pairs[l.pairs.length - 1]}` : l.pairs[0];
    const past = l.date < today || (l.date === today && l.end && toMin(l.end) <= min);
    const now = l.date === today && l.start && l.end && toMin(l.start) <= min && min < toMin(l.end);
    html += `<article class="lesson${past ? ' past' : ''}${now ? ' now' : ''}" style="--i:${Math.min(i, 10)}">
      <div class="when"><div class="num">${num}</div><div class="t">${esc(l.start || '')}${l.end ? '<br>' + esc(l.end) : ''}</div></div>
      <div><p class="subj">${esc(l.subject)}</p><div class="meta">
        ${kindPill(l.kind)}
        ${l.room ? `<span class="ic room">${ICONS.pin}${esc(l.room)}</span>` : ''}
        ${l.groups.map((g) => `<button type="button" class="ic glink press" data-open-group="${esc(normGroup(g))}" data-day="${esc(l.date)}">${esc(g)}</button>`).join('')}
      </div></div>
    </article>`;
  });
  html += `<p class="hint">Собрано из расписания всех курсов на сайте колледжа.${t.aliases && t.aliases.length
    ? ` В PDF местами написано иначе (${esc(t.aliases.join(', '))}), такие пары тоже здесь.` : ''}</p>`;
  return html;
}
