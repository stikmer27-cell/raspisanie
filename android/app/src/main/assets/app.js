// Интерфейс приложения. Данные готовит фоновая проверка (worker.html + engine.js),
// здесь только показываем их и общаемся с Android через window.Android.
import { STICKERS, ICONS } from './stickers.js';
import { normGroup, nowTz, addDays, weekday, toMin, dayPlan, lateNote, toPair } from './engine.js';

const $ = (s) => document.querySelector(s);
const WD = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const WD_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const native = window.Android;
const S = { cfg: {}, data: null, group: null, sel: null, manual: false, loaded: false };

// ---------------------------------------------------------------- утилиты

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tz = () => S.cfg.timezone || 'Asia/Novosibirsk';
const now = () => nowTz(tz());
const dayNum = (iso) => +iso.slice(8, 10);
const monthName = (iso) => MONTHS[+iso.slice(5, 7) - 1];
const hhmm = (ms) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz(), hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
const longDate = (d) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz(), day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(d));

function plural(n, one, few, many) {
  if (n % 10 === 1 && n % 100 !== 11) return one;
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) return few;
  return many;
}
function dur(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return [h ? `${h} ч` : '', m ? `${m} мин` : ''].filter(Boolean).join(' ') || 'меньше минуты';
}
function kindInfo(kind) {
  const k = (kind || '').toLowerCase();
  if (/лекц/.test(k)) return ['k-lec', 'Лекция'];
  if (/лаб/.test(k)) return ['k-lab', 'Лабораторная'];
  if (/практ|семин/.test(k)) return ['k-prac', 'Практика'];
  if (/курсов/.test(k)) return ['k-oth', 'Курсовая'];
  if (/консульт/.test(k)) return ['k-oth', 'Консультация'];
  return kind ? ['k-oth', kind] : null;
}
const active = (ls) => (ls || []).filter((l) => !l.cancelled && l.pairs.length && l.start);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const pairsWord = (n) => `${n} ${plural(n, 'пара', 'пары', 'пар')}`;

/** Мини-расписание дня в кнопке: точка на каждую пару, пустая — пары нет. */
function pairDots(ls) {
  const plan = dayPlan(ls);
  if (!plan) return ls.length ? '✕' : '—';
  const busy = new Set(active(ls).flatMap((l) => l.pairs));
  const last = Math.max(...busy);
  let html = '';
  for (let p = 1; p <= Math.min(last, 7); p++) html += `<i class="${busy.has(p) ? 'on' : p < plan.first ? 'skip' : 'off'}"></i>`;
  return `<span class="pdots${plan.late ? ' late' : ''}">${html}</span>`;
}

function readCfg() {
  try { S.cfg = JSON.parse(native.getConfig()); } catch { S.cfg = {}; }
  S.group = normGroup(S.cfg.group || '');
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// отклик на нажатие: вдавливание, волна от пальца и лёгкая вибрация.
// :active в WebView срабатывает с задержкой (ждёт, не прокрутка ли это), поэтому класс ставим сами.
let pressedEl = null;
let pressedAt = 0;
const release = () => {
  const el = pressedEl;
  if (!el) return;
  pressedEl = null;
  setTimeout(() => el.classList.remove('pressed'), Math.max(0, 110 - (Date.now() - pressedAt)));
};
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.press, .day, .group-list button, .btn, .theme-switch');
  if (!el) return;
  if (native.haptic) native.haptic();
  if (el.classList.contains('theme-switch')) return;
  el.classList.add('press', 'pressed');
  pressedEl = el;
  pressedAt = Date.now();
  const r = el.getBoundingClientRect();
  const size = Math.max(r.width, r.height);
  const span = document.createElement('span');
  span.className = 'ripple';
  span.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  el.appendChild(span);
  span.addEventListener('animationend', () => span.remove());
}, { passive: true });
document.addEventListener('pointerup', release, { passive: true });
document.addEventListener('pointercancel', release, { passive: true });

// ---------------------------------------------------------------- тема: авто / светлая / тёмная

const systemDark = () => (typeof S.cfg.systemDark === 'boolean' ? S.cfg.systemDark : matchMedia('(prefers-color-scheme: dark)').matches);
const isDark = () => { const t = S.cfg.theme || 'system'; return t === 'dark' || (t !== 'light' && systemDark()); };

// Текст чёрной темы берём из dark.css и вставляем/удаляем отдельным <style>.
// Добавление и удаление таблицы стилей пересчитывается в любом WebView; смену атрибутов
// на :root и media у <link> старый WebView (Chrome 113) до страницы не доносил.
const darkCssText = fetch('dark.css').then((r) => r.text()).catch(() => '');

async function paintTheme() {
  const dark = isDark();
  document.documentElement.dataset.dark = dark ? '1' : '0';
  $('#themeBtn').setAttribute('aria-checked', String(dark));
  const text = await darkCssText;
  if (!text) return; // файл не прочитался — остаётся <link> из index.html
  // на время смены темы выключаем CSS-переходы: старый WebView «застревает» в переходе цвета
  const root = document.documentElement;
  root.classList.add('theme-switching');
  const link = document.getElementById('darkCss');
  if (link) link.remove();
  let st = document.getElementById('darkStyle');
  if (dark && !st) {
    st = document.createElement('style');
    st.id = 'darkStyle';
    st.textContent = text;
    document.head.appendChild(st);
  } else if (!dark && st) {
    st.remove();
  }
  void document.body.offsetHeight;
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
  console.log(`theme ${S.cfg.theme || 'system'} dark=${dark} bg=${getComputedStyle(document.body).backgroundColor} text=${getComputedStyle(document.querySelector('h1')).color}`);
}

// View Transitions в старом WebView применяют новые стили с опозданием на одно переключение
// (проверено на эмуляторе с Chrome 113) — там используем свою анимацию.
const chromeMajor = +((navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1] || 0);
const canViewTransition = !!document.startViewTransition && chromeMajor >= 120;

/** Смена темы: новая тема «разливается» кругом от переключателя. */
function setTheme(mode, from) {
  const willDark = mode === 'dark' || (mode === 'system' && systemDark());
  // переключатель откликается сразу, не дожидаясь смены темы
  document.documentElement.dataset.dark = willDark ? '1' : '0';
  $('#themeBtn').setAttribute('aria-checked', String(willDark));
  const apply = () => {
    S.cfg.theme = mode;
    if (native.setTheme) native.setTheme(mode);
    return paintTheme();
  };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!from || reduce) {
    apply();
    return;
  }
  const r = from.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const circle = [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`];
  if (canViewTransition) {
    // вся страница в новой теме проявляется кругом
    const vt = document.startViewTransition(apply);
    vt.ready.then(() => {
      document.documentElement.animate({ clipPath: circle },
        { duration: 720, easing: 'cubic-bezier(.3, .7, .1, 1)', pseudoElement: '::view-transition-new(root)' });
    }).catch(() => {});
    return;
  }
  // старый WebView: круг цвета новой темы, под ним меняем тему, затем круг растворяется
  const ov = document.createElement('div');
  ov.className = 'theme-reveal';
  ov.style.background = willDark ? '#050507' : '#f3f5fb';
  document.body.appendChild(ov);
  ov.animate({ clipPath: circle }, { duration: 480, easing: 'cubic-bezier(.3, .7, .1, 1)', fill: 'forwards' }).onfinish = async () => {
    await apply();
    ov.animate({ opacity: [1, 0] }, { duration: 320, easing: 'ease-out', fill: 'forwards' }).onfinish = () => ov.remove();
  };
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if ((S.cfg.theme || 'system') === 'system') paintTheme(); });

// ---------------------------------------------------------------- данные

async function loadData() {
  try {
    const r = await fetch('/data/schedule.json?t=' + Date.now(), { cache: 'no-store' });
    S.data = r.ok ? await r.json() : null;
  } catch {
    S.data = null;
  }
  S.loaded = true;
}

// пока идёт проверка — сами следим за её окончанием (на случай, если событие от Android потерялось)
let watchTimer = null;
function watchRunning() {
  clearInterval(watchTimer);
  const started = Date.now();
  let seen = false;
  watchTimer = setInterval(async () => {
    readCfg();
    if (S.cfg.running) seen = true;
    // фоновая задача стартует не мгновенно — первые секунды считаем, что она уже идёт
    if (!S.cfg.running && !seen && Date.now() - started < 8000) S.cfg.running = true;
    if (!S.cfg.running) {
      clearInterval(watchTimer);
      watchTimer = null;
      await loadData();
      render(null);
    }
    renderStatus();
  }, 1500);
}

function refresh(manual = true) {
  if (manual) {
    S.manual = true;
    toast(S.cfg.running ? 'Уже проверяю сайт…' : 'Проверяю сайт колледжа…');
  }
  if (!S.cfg.running) native.refresh();
  S.cfg.running = true;
  renderStatus();
  watchRunning();
}

// события от Android
window.onNative = async (type, arg) => {
  if (type === 'running') {
    S.cfg.running = true;
    renderStatus();
  } else if (type === 'done') {
    const info = arg ? JSON.parse(arg) : {};
    clearInterval(watchTimer);
    watchTimer = null;
    readCfg();
    await loadData();
    render('fade');
    if (S.manual) {
      if (info.error) toast('Не получилось связаться с сайтом');
      else toast(info.changed ? 'Расписание обновлено' : 'Изменений нет — всё актуально');
    }
    S.manual = false;
  } else if (type === 'resume') {
    readCfg();
    await loadData();
    render(null);
  } else if (type === 'open') {
    S.sel = arg;
    render('fade');
  } else if (type === 'settings') {
    readCfg();
    paintTheme();
    if ($('#settingsDlg').open) renderSettings();
    refreshBell();
    renderUpdateBar();
  }
};

// ---------------------------------------------------------------- обновление приложения

/** Скачана новая версия: короткая плашка сверху. Сама поставится, когда выйдешь из приложения. */
function renderUpdateBar() {
  const u = S.cfg.update || {};
  let bar = $('#updateBar');
  if (!u.pending || !S.cfg.group) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'updateBar';
    bar.className = 'update-bar';
    $('#main').insertBefore(bar, $('#pull'));
  }
  bar.innerHTML = `${ICONS.bolt}<div><b>Вышло обновление ${esc(u.pending)}</b><span>Поставится само, когда выйдешь из приложения</span></div>
    <button type="button" class="btn press" data-act="update-now">Обновить</button>`;
}

function updateState(u) {
  if (!u.enabled) return 'выключено в этой сборке';
  if (u.busy) return 'проверяю…';
  if (u.pending) return `скачана версия ${u.pending} — поставится, когда выйдешь из приложения`;
  if (u.error) return `не получилось: ${u.error}`;
  if (u.checked) return `у тебя последняя версия · проверено ${longDate(u.checked)}`;
  return 'ещё не проверял';
}

// кнопка «назад» на телефоне сначала закрывает шторки
window.handleBack = () => {
  const open = [...document.querySelectorAll('dialog[open]')].pop();
  if (open) { closeSheet(open); return true; }
  return false;
};

// ---------------------------------------------------------------- дни

function dayList() {
  const g = S.data && S.data.groups[S.group];
  const { iso: today } = now();
  const set = new Set(Object.keys((g && g.days) || {}));
  set.add(today);
  set.add(addDays(today, 1));
  return [...set].filter((d) => weekday(d) !== 6 || (g && g.days[d] && g.days[d].length)).sort();
}

function defaultDay(days) {
  const { iso, min } = now();
  const g = S.data.groups[S.group];
  const todays = active(g && g.days[iso]);
  // сегодняшний день показываем ещё час после последней пары, потом — следующий
  if (days.includes(iso) && todays.length && min < Math.max(...todays.map((l) => toMin(l.end || l.start))) + 60) return iso;
  return days.find((d) => d > iso) || (days.includes(iso) ? iso : days[days.length - 1]);
}

function relName(iso) {
  const { iso: today } = now();
  return { [today]: 'Сегодня', [addDays(today, 1)]: 'Завтра', [addDays(today, -1)]: 'Вчера' }[iso] || '';
}

function selectDay(d) {
  if (!d || d === S.sel) return;
  const dir = S.sel && d < S.sel ? 'left' : 'right';
  S.sel = d;
  render(dir);
}

// ---------------------------------------------------------------- отрисовка

function renderStatus() {
  const sub = $('#sub');
  sub.classList.remove('err');
  $('#refreshBtn').classList.toggle('spin', !!S.cfg.running);
  const week = S.data && S.data.week ? S.data.week.replace(/^.*·\s*/, '') : '';
  if (S.cfg.running) sub.textContent = 'Проверяю сайт колледжа…';
  else if (S.cfg.lastError && S.data) { sub.textContent = `Нет связи с сайтом · показаны данные на ${hhmm(S.cfg.lastOk || Date.now())}`; sub.classList.add('err'); }
  else if (S.cfg.lastOk) sub.textContent = [week, `проверено в ${hhmm(S.cfg.lastOk)}`].filter(Boolean).join(' · ');
  else sub.textContent = week || ' ';
}

function empty(sticker, title, text, btn = '') {
  return `<div class="empty">${STICKERS[sticker]}<h3>${title}</h3><p>${text}</p>${btn}</div>`;
}

// ---------------------------------------------------------------- первый вход: вписать группу

function levenshtein(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

function renderOnboarding() {
  document.body.classList.add('onboard');
  const view = $('#view');
  if (!view.querySelector('.onb')) {
    view.innerHTML = `<div class="onb">
      ${STICKERS.group}
      <h2>Привет!</h2>
      <p>Впиши свою группу — покажу расписание и буду присылать уведомления.</p>
      <form id="onbForm" autocomplete="off">
        <input id="onbInput" class="search big" placeholder="например, 2401а1" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done">
        <div id="onbHint" class="onb-hint"></div>
        <div id="onbSugg" class="onb-sugg"></div>
        <button class="btn wide press" id="onbBtn">Готово</button>
      </form>
    </div>`;
    animate(view, 'fade');
    $('#onbInput').addEventListener('input', () => updateOnboarding());
    $('#onbForm').addEventListener('submit', (e) => { e.preventDefault(); submitOnboarding(); });
  }
  updateOnboarding();
}

function updateOnboarding(errorText) {
  const input = $('#onbInput');
  if (!input) return;
  const nq = normGroup(input.value);
  const hint = $('#onbHint');
  const groups = S.data ? Object.entries(S.data.groups) : null;
  hint.classList.toggle('err', !!errorText);
  let sugg = [];
  if (!groups) {
    hint.innerHTML = S.cfg.running || !S.cfg.lastError
      ? '<span class="dots">Загружаю список групп с сайта</span>'
      : 'Не получилось загрузить список групп. <a href="#" data-act="retry">Повторить</a>';
  } else if (errorText) {
    hint.textContent = errorText;
    sugg = groups.map(([k, g]) => [k, g, levenshtein(nq, k)]).sort((a, b) => a[2] - b[2]).slice(0, 6);
  } else {
    hint.textContent = nq ? '' : `В расписании ${groups.length} ${plural(groups.length, 'группа', 'группы', 'групп')}`;
    sugg = nq ? groups.filter(([k]) => k.includes(nq)).slice(0, 12) : [];
    if (nq && !sugg.length) hint.textContent = 'Такой группы пока не видно — проверь написание';
  }
  $('#onbSugg').innerHTML = sugg.map(([k, g], i) =>
    `<button type="button" class="press ${k === nq ? 'exact' : ''}" data-pick="${esc(k)}" style="--i:${i}">${esc(g.name)}</button>`).join('');
  $('#onbBtn').disabled = !groups || !nq;
}

function submitOnboarding() {
  if (!S.data) return;
  const input = $('#onbInput');
  const nq = normGroup(input.value);
  if (S.data.groups[nq]) { chooseGroup(nq); return; }
  input.classList.remove('shake');
  void input.offsetWidth;
  input.classList.add('shake');
  updateOnboarding('Такой группы нет в расписании. Может, одна из этих?');
}

function chooseGroup(norm) {
  if (document.activeElement) document.activeElement.blur(); // убрать клавиатуру
  window.scrollTo(0, 0);
  native.setGroup(norm);
  readCfg();
  S.group = norm;
  S.sel = null;
  document.body.classList.remove('onboard');
  closeSheet($('#groupDlg'));
  render('fade');
  const g = S.data.groups[norm];
  toast(`Готово! Уведомления будут для группы ${g ? g.name : norm}`);
}

function render(anim) {
  renderStatus();
  refreshBell();
  renderUpdateBar();
  if (!S.cfg.group) { renderOnboarding(); return; }
  document.body.classList.remove('onboard');
  const g = S.data && S.data.groups[S.group];
  $('#groupName').textContent = g ? g.name : (S.cfg.group || 'Группа?');
  const view = $('#view');

  if (!S.data) {
    $('#days').innerHTML = '';
    if (S.cfg.lastError && !S.cfg.running) {
      view.innerHTML = empty('offline', 'Нет связи с сайтом', 'Проверь интернет — и попробуем ещё раз.', '<button class="btn press" data-act="retry">Повторить</button>');
    } else {
      view.innerHTML = empty('load', 'Загружаю расписание', 'Скачиваю PDF с сайта колледжа и разбираю его. Это займёт несколько секунд.');
    }
    animate(view, 'fade');
    renderFoot();
    return;
  }
  if (!g) {
    $('#days').innerHTML = '';
    view.innerHTML = empty('group', 'Выбери свою группу', `Группа «${esc(S.cfg.group || '')}» не нашлась в расписании.`, '<button class="btn press" data-act="group">Выбрать группу</button>');
    animate(view, 'fade');
    renderFoot();
    return;
  }

  const days = dayList();
  if (!S.sel || !days.includes(S.sel)) S.sel = defaultDay(days);
  const { iso: today } = now();
  $('#days').innerHTML = days.map((d) => {
    const ls = g.days[d];
    const plan = ls ? dayPlan(ls) : null;
    const cnt = ls === undefined ? '?' : pairDots(ls);
    const cls = ['day', 'press', d === today && 'today', d === S.sel && 'sel', ls === undefined && 'missing'].filter(Boolean).join(' ');
    const label = `${WD[weekday(d)]} ${dayNum(d)} ${monthName(d)}${plan ? `, ${toPair(plan.first)}, ${pairsWord(plan.count)}` : ''}`;
    return `<button class="${cls}" data-day="${d}" aria-pressed="${d === S.sel}" aria-label="${label}">
      <span class="wd">${WD_SHORT[weekday(d)]}</span><span class="dn">${dayNum(d)}</span><span class="cnt">${cnt}</span></button>`;
  }).join('');
  const selBtn = document.querySelector(`.day[data-day="${S.sel}"]`);
  if (selBtn && anim) selBtn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });

  view.innerHTML = dayHtml(g, S.sel);
  animate(view, anim);
  renderFoot();
}

function animate(view, anim) {
  view.classList.remove('in-right', 'in-left', 'in-fade', 'no-anim');
  if (!anim) { view.classList.add('no-anim'); return; }
  void view.offsetWidth;
  view.classList.add(anim === 'left' ? 'in-left' : anim === 'right' ? 'in-right' : 'in-fade');
}

function dayHtml(g, d) {
  const ls = g.days[d];
  const rel = relName(d);
  const title = `${rel ? rel + ', ' : ''}${WD[weekday(d)]}, ${dayNum(d)} ${monthName(d)}`;
  const act = active(ls);
  const plan = ls ? dayPlan(ls) : null;
  const { iso: today, min } = now();
  const isToday = d === today;
  // день ещё не начался — крупно «к какой паре приходить»; когда пары идут, хватит короткой сводки
  const upcoming = plan && (d > today || (isToday && min < toMin(plan.start)));
  const sum = plan && !upcoming ? `${pairsWord(plan.count)} · ${plan.start}–${plan.end}` : '';
  let html = `<div class="day-head"><h2>${esc(cap(title))}</h2><span class="sum">${sum}</span></div>`;
  if (upcoming) html += arriveHtml(plan);

  const warns = (g.warnings || []).filter((w) => !w.date || w.date === d);
  if (warns.length && ls !== undefined) {
    html += `<div class="banner">${ICONS.warn}<div><b>Сверь этот день с PDF</b>Приложение нашло место, которое не смогло разобрать однозначно.
      <details><summary>Подробнее</summary>${warns.map((w) => `<div>• ${esc(w.msg)}</div>`).join('')}</details>
      <button class="btn press" data-act="pdf">${ICONS.file} Открыть PDF</button></div></div>`;
  }

  if (ls === undefined) {
    return html + empty('wait', 'Расписание ещё не выложили', 'Как только на сайте появится PDF — пришлю уведомление.');
  }
  if (!ls.length) return html + empty('free', 'Пар нет', 'Можно отдыхать!');
  if (!act.length) {
    html += empty('cancel', 'Занятия отменены', 'Посмотри подробности ниже.');
  }

  const nextIdx = isToday ? ls.findIndex((l) => !l.cancelled && l.start && l.pairs.length && toMin(l.start) > min) : -1;
  let prev = null;
  let i = 0;
  ls.forEach((l, idx) => {
    const real = l.pairs.length && !l.cancelled && l.start && l.end;
    // пустые пары — прочерком на своём месте: перед первой («пары нет») и окна между парами
    for (const s of (plan ? plan.slots : [])) {
      if (s.at !== idx) continue;
      const gapMin = s.kind === 'gap' && prev && l.start ? toMin(l.start) - toMin(prev.end) : 0;
      html += slotCard(s, isToday && s.end && toMin(s.end) <= min, gapMin, i++);
    }
    html += lessonCard(l, isToday, min, idx === nextIdx, i++);
    if (real) prev = l;
  });
  return html;
}

/** «Ко второй паре — 10:45»: главное, что нужно знать про день, крупно и сверху. */
function arriveHtml(plan) {
  const note = lateNote(plan);
  const sub = [cap(note), `${pairsWord(plan.count)}${plan.end ? `, до ${plan.end}` : ''}`].filter(Boolean).join(' · ');
  return `<div class="arrive${plan.late ? ' late' : ''}">
    <div class="arrive-num" aria-hidden="true">${plan.first}</div>
    <div class="arrive-text"><b>${cap(toPair(plan.first))} — ${plan.start}</b><span>${sub}</span></div>
  </div>`;
}

function slotCard(s, past, gapMin, i) {
  const num = s.pairs.length > 1 ? `${s.pairs[0]}–${s.pairs[s.pairs.length - 1]}` : s.pairs[0];
  const text = s.kind === 'gap' ? `Окно${gapMin > 0 ? ` · ${dur(gapMin)}` : ''}` : (s.pairs.length > 1 ? 'Пар нет' : 'Пары нет');
  return `<article class="lesson slot ${s.kind}${past ? ' past' : ''}" style="--i:${i}">
    <div class="when"><div class="num">${num}</div><div class="t">${s.start || ''}</div></div>
    <p class="slot-text"><span class="dash" aria-hidden="true"></span>${text}</p>
  </article>`;
}

function lessonCard(l, isToday, min, isNext, i) {
  const note = !l.pairs.length;
  const cls = ['lesson', note && 'note', l.cancelled && /^\s*отмен/i.test(l.text) && 'cancel'];
  let status = '', bar = '';
  if (isToday && !l.cancelled && l.start && l.end) {
    const s = toMin(l.start), e = toMin(l.end);
    if (min >= s && min < e) {
      cls.push('now');
      status = `<div class="status"><span class="pill badge-now">Сейчас · ещё ${dur(e - min)}</span></div>`;
      bar = `<div class="bar"><i style="width:${Math.round(((min - s) / (e - s)) * 100)}%"></i></div>`;
    } else if (min >= e) {
      cls.push('past');
    } else if (isNext) {
      status = `<div class="status"><span class="pill badge-next">Через ${dur(s - min)}</span></div>`;
    }
  }
  if (l.cancelled) status = `<div class="status"><span class="pill badge-cancel">Отменено</span></div>`;
  const num = l.pairs.length ? (l.pairs.length > 1 ? `${l.pairs[0]}–${l.pairs[l.pairs.length - 1]}` : l.pairs[0]) : '·';
  const time = l.start ? `${l.start}${l.end ? '<br>' + l.end : ''}` : '';
  const kind = kindInfo(l.kind);
  const meta = [
    kind && `<span class="pill ${kind[0]}">${esc(kind[1])}</span>`,
    l.teacher && `<span class="ic">${ICONS.user}${esc(l.teacher)}</span>`,
    l.room && `<span class="ic room">${ICONS.pin}${esc(l.room)}</span>`,
  ].filter(Boolean).join('');
  return `<article class="${cls.filter(Boolean).join(' ')}" style="--i:${i}">
    <div class="when"><div class="num">${num}</div><div class="t">${time}</div></div>
    <div>${status}<p class="subj">${esc(l.subject || l.text)}</p>${meta ? `<div class="meta">${meta}</div>` : ''}${bar}</div>
  </article>`;
}

function sourceUrl() {
  const g = S.data && S.data.groups[S.group];
  const src = g && S.data.sources[g.source];
  return src ? src.url : 'https://ci.nsu.ru/education/schedule/';
}

function renderFoot() {
  const parts = [];
  if (S.data && S.data.updated) parts.push(`Расписание менялось: ${longDate(S.data.updated)}`);
  parts.push(`<a href="#" data-act="pdf">PDF с сайта</a> · <a href="#" data-act="site">ci.nsu.ru</a>`);
  $('#foot').innerHTML = parts.join('<br>');
}

// ---------------------------------------------------------------- шторки

function openSheet(dlg) {
  dlg.classList.remove('closing');
  if (!dlg.open) dlg.showModal();
}
function closeSheet(dlg) {
  if (!dlg.open || dlg.classList.contains('closing')) return;
  dlg.classList.add('closing');
  setTimeout(() => { dlg.classList.remove('closing'); dlg.close(); }, 210);
}
for (const dlg of document.querySelectorAll('dialog')) {
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeSheet(dlg); });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(dlg); });
  dlg.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); closeSheet(dlg); });
}

function openGroups() {
  $('#groupSearch').value = '';
  fillGroups('');
  openSheet($('#groupDlg'));
}
function fillGroups(q) {
  const nq = normGroup(q);
  const items = Object.entries((S.data && S.data.groups) || {}).filter(([k]) => !nq || k.includes(nq));
  $('#groupList').innerHTML = items.map(([k, g], i) =>
    `<button type="button" data-group="${esc(k)}" class="${k === S.group ? 'sel' : ''}" style="--i:${Math.min(i, 40)}">${esc(g.name)}</button>`,
  ).join('') || '<p class="hint">Ничего не нашлось</p>';
}

function refreshBell() {
  $('#bellDot').hidden = S.cfg.notifications !== false && S.cfg.battery !== false;
}

function renderSettings() {
  const c = S.cfg;
  const yes = '<span class="ok">✓</span>';
  const last = c.lastOk ? `последняя: ${longDate(c.lastOk)}` : 'ещё не было';
  $('#settingsBody').innerHTML = `
    <section class="card-flat">
      <div class="state"><span class="lbl">Уведомления<small>${c.notifications ? 'разрешены' : 'телефон их блокирует'}</small></span>
        ${c.notifications ? yes : '<button type="button" class="btn press" data-act="notif">Разрешить</button>'}</div>
      <div class="state"><span class="lbl">Работа в фоне<small>${c.battery ? 'телефон не мешает проверкам' : 'экономия батареи может задерживать уведомления'}</small></span>
        ${c.battery ? yes : '<button type="button" class="btn press" data-act="battery">Разрешить</button>'}</div>
      <div class="state"><span class="lbl">Проверка сайта<small>${c.running ? 'идёт сейчас…' : last}${c.lastError ? ' · последняя попытка не удалась' : ''}</small></span>
        ${c.lastError ? '<span class="bad">!</span>' : c.lastOk ? yes : ''}</div>
      <div class="row">
        <button type="button" class="btn press" data-act="test">${ICONS.bell} Тестовое уведомление</button>
        <button type="button" class="btn secondary press" data-act="check">Проверить сейчас</button>
      </div>
    </section>
    <section class="card-flat">
      <h3>Тема</h3>
      <div class="seg" role="radiogroup">
        ${[['system', 'Авто'], ['light', 'Светлая'], ['dark', 'Тёмная']].map(([k, label]) =>
          `<button type="button" role="radio" aria-checked="${(c.theme || 'system') === k}" class="press ${(c.theme || 'system') === k ? 'on' : ''}" data-theme-set="${k}">${label}</button>`).join('')}
      </div>
    </section>
    <section class="card-flat">
      <h3>Виджет</h3>
      <p>Пары на сегодня прямо на главном экране: что сейчас и что дальше.</p>
      <button type="button" class="btn secondary press wide" data-act="widget">Добавить виджет на главный экран</button>
    </section>
    <section class="card-flat">
      <div class="state"><span class="lbl">Автообновление · версия ${esc(c.version || '')}<small>${esc(updateState(c.update || {}))}</small></span>
        ${(c.update || {}).pending ? '<button type="button" class="btn press" data-act="update-now">Обновить</button>'
          : (c.update || {}).enabled ? `<button type="button" class="btn secondary press" data-act="update-check"${(c.update || {}).busy ? ' disabled' : ''}>Проверить</button>` : ''}</div>
    </section>
    <section class="card-flat">
      <h3>${ICONS.clock} Когда присылать</h3>
      <div class="times">
        <label>Вечером — на завтра<input type="time" id="tEvening" value="${esc(c.evening_time || '20:00')}"></label>
        <label>Утром — на сегодня<input type="time" id="tMorning" value="${esc(c.morning_time || '07:00')}"></label>
      </div>
      <p class="hint">А если расписание поменяют — сразу. Сайт проверяется примерно раз в полчаса.</p>
    </section>
    <p class="hint">Группа: <b>${esc((S.data && S.data.groups[S.group] && S.data.groups[S.group].name) || c.group || '—')}</b></p>`;
  const save = () => {
    const e = $('#tEvening').value, m = $('#tMorning').value;
    if (/^\d{2}:\d{2}$/.test(e) && /^\d{2}:\d{2}$/.test(m)) {
      native.setTimes(e, m);
      S.cfg.evening_time = e;
      S.cfg.morning_time = m;
      toast(`Сохранено: ${e} и ${m}`);
    }
  };
  $('#tEvening').addEventListener('change', save);
  $('#tMorning').addEventListener('change', save);
}

// ---------------------------------------------------------------- события

document.addEventListener('click', (e) => {
  const themeSet = e.target.closest('[data-theme-set]');
  if (themeSet) {
    setTheme(themeSet.dataset.themeSet, themeSet);
    for (const b of document.querySelectorAll('[data-theme-set]')) {
      b.classList.toggle('on', b === themeSet);
      b.setAttribute('aria-checked', String(b === themeSet));
    }
    return;
  }
  const day = e.target.closest('.day');
  if (day) { selectDay(day.dataset.day); return; }
  const grp = e.target.closest('[data-group], [data-pick]');
  if (grp) { chooseGroup(grp.dataset.group || grp.dataset.pick); return; }
  const act = e.target.closest('[data-act]');
  if (!act) return;
  e.preventDefault();
  const a = act.dataset.act;
  if (a === 'retry' || a === 'check') { refresh(true); if (a === 'check') toast('Проверяю…'); }
  else if (a === 'group') openGroups();
  else if (a === 'pdf') native.openUrl(sourceUrl());
  else if (a === 'site') native.openUrl('https://ci.nsu.ru/education/schedule/');
  else if (a === 'notif') native.requestNotifications();
  else if (a === 'battery') native.openBatterySettings();
  else if (a === 'test') { native.testNotification(); toast('Сейчас придёт тестовое уведомление'); }
  else if (a === 'update-check') {
    if (native.checkUpdate) native.checkUpdate();
    S.cfg.update = { ...(S.cfg.update || {}), busy: true };
    renderSettings();
    toast('Ищу новую версию…');
  } else if (a === 'update-now') {
    if (native.installUpdate) native.installUpdate();
    toast('Обновляю — приложение закроется и пришлёт уведомление, когда всё готово');
  } else if (a === 'widget') {
    const ok = native.pinWidget && native.pinWidget();
    toast(ok ? 'Подтверди добавление — виджет появится на главном экране'
      : 'Зажми пустое место на главном экране → Виджеты → Расписание');
  }
});

$('#groupBtn').addEventListener('click', openGroups);
$('#themeBtn').addEventListener('click', (e) => setTheme(isDark() ? 'light' : 'dark', e.currentTarget));
$('#groupSearch').addEventListener('input', (e) => fillGroups(e.target.value));
$('#refreshBtn').addEventListener('click', () => refresh(true));
$('#settingsBtn').addEventListener('click', () => { readCfg(); renderSettings(); openSheet($('#settingsDlg')); });

// жесты: свайп влево/вправо — соседний день, потянуть вниз — обновить
const pull = $('#pull');
let g0 = null;
document.addEventListener('touchstart', (e) => {
  if (e.target.closest('dialog, .days')) return;
  g0 = { x: e.touches[0].clientX, y: e.touches[0].clientY, mode: null, top: window.scrollY <= 0 };
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!g0) return;
  const dx = e.touches[0].clientX - g0.x, dy = e.touches[0].clientY - g0.y;
  if (!g0.mode && Math.hypot(dx, dy) > 12) g0.mode = Math.abs(dx) > Math.abs(dy) ? 'x' : (dy > 0 && g0.top ? 'pull' : 'scroll');
  if (g0.mode === 'pull') {
    const h = Math.min(dy * 0.45, 72);
    pull.style.transition = 'none';
    pull.style.height = `${h}px`;
    pull.classList.toggle('ready', h > 56);
  }
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!g0) return;
  const dx = e.changedTouches[0].clientX - g0.x;
  const mode = g0.mode;
  g0 = null;
  if (mode === 'pull') {
    pull.style.transition = '';
    if (pull.classList.contains('ready')) {
      pull.classList.remove('ready');
      pull.classList.add('go');
      pull.style.height = '44px';
      refresh(true);
      setTimeout(() => { pull.classList.remove('go'); pull.style.height = '0'; }, 900);
    } else {
      pull.style.height = '0';
    }
  } else if (mode === 'x' && Math.abs(dx) > 60 && S.data && S.data.groups[S.group]) {
    const days = dayList();
    const i = days.indexOf(S.sel) + (dx < 0 ? 1 : -1);
    if (i >= 0 && i < days.length) selectDay(days[i]);
  }
}, { passive: true });

// раз в 30 секунд обновляем «сейчас / через N минут» (без анимаций)
setInterval(() => { if (S.data && document.visibilityState === 'visible') render(null); }, 30000);

// ---------------------------------------------------------------- старт

readCfg();
paintTheme();
S.sel = (native.takeOpenDay && native.takeOpenDay()) || null; // открыли из уведомления — сразу нужный день
await loadData();
render('fade');
if (!S.data || !S.cfg.lastOk || Date.now() - S.cfg.lastOk > 15 * 60 * 1000) refresh(false);
