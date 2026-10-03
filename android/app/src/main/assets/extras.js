// Остальное полезное с сайта колледжа: новости и объявления, сессия (расписание экзаменов
// и пересдач, вопросы к зачётам), учебные пособия. Работает и в WebView, и в Node (тесты).
import { SITE, normGroup, unescapeHtml, addDays } from './engine.js';

export const NEWS_URL = SITE + '/news/';
export const ADVERT_URL = SITE + '/advert/';
export const EXAMS_URL = SITE + '/education/raspisanie-ekzamenov/';
export const QUESTIONS_URL = SITE + '/education/voprosy-k-zachetam-i-ekzamenam/';
export const MATERIALS_URL = SITE + '/about/sveden/metodicheskie-materialy/';

/** Версия разбора страниц: при исправлениях увеличиваем — всё перечитается сразу. */
export const EXTRAS_VERSION = 1;
const HOUR = 3600 * 1000;
// новости проверяем при каждой проверке сайта; страницы сессии и пособий меняются редко
const EVERY = { news: 0, advert: 6 * HOUR, exams: 6 * HOUR, questions: 6 * HOUR, materials: 24 * HOUR };

const toText = (html) => unescapeHtml(String(html || '').replace(/\r/g, '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' '))
  .replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
const abs = (href) => new URL(href, SITE).href;
const fileName = (url) => { try { return decodeURIComponent(url.split('/').pop()); } catch { return url.split('/').pop(); } };
const lower = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');

// ---------------------------------------------------------------- новости и объявления

/** Карточки новостей (/news/) и объявлений (/advert/): [{url, date, title, text, kind}]. */
export function parseNews(html, kind = 'news') {
  const out = [];
  const marker = kind === 'news' ? 'class="news-card"' : 'class="events-card"';
  const parts = String(html || '').split(marker).slice(1);
  for (const part of parts) {
    const chunk = part.split(marker)[0];
    const name = /<a href="([^"]+)" class="name">([\s\S]*?)<\/a>/.exec(chunk);
    if (!name) continue;
    let date = null;
    const d1 = /class="date">\s*(\d{2})\.(\d{2})\.(\d{4})/.exec(chunk);
    const d2 = /<span class="day">\s*(\d{1,2})\s*<\/span>\s*<span>\s*(\d{1,2})\s*<\/span>\s*<span>\s*(\d{4})\s*<\/span>/.exec(chunk);
    const d = d1 || d2;
    if (d) date = `${d[3]}-${String(d[2]).padStart(2, '0')}-${String(d[1]).padStart(2, '0')}`;
    const after = chunk.slice(name.index + name[0].length).split('<div class="tags"')[0];
    const text = toText(after.replace(/<a[^>]*class="img-wrap"[\s\S]*?<\/a>/g, ''));
    out.push({ url: abs(name[1]), date, title: toText(name[2]), text, kind });
  }
  return out;
}

// ---------------------------------------------------------------- списки файлов

/**
 * Все ссылки на файлы страницы с «путём» разделов, под которыми они лежат:
 * [{url, title, path: ['Базовое отделение', 'Расписание пересдач', '1 курс']}].
 */
export function parseFiles(html) {
  const out = [];
  let section = '', sub = '', h3 = '';
  // только основное содержимое страницы: в меню и подвале сайта свои PDF («Вакансии», памятки)
  const page = String(html || '');
  const start = page.search(/<h1[\s>]/i);
  const end = page.search(/<footer[\s>]|class="footer/i);
  html = page.slice(start >= 0 ? start : 0, end > start ? end : page.length);
  const re = /<span class="bold">([\s\S]*?)<\/span>|<span class="name line">([\s\S]*?)<\/span>|<h3[^>]*>([\s\S]*?)<\/h3>|<a\s+href="([^"]+\.(?:pdf|docx?|xlsx?|pptx?|zip|rar))"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    if (m[1] !== undefined) { section = toText(m[1]); sub = ''; h3 = ''; }
    else if (m[2] !== undefined) { sub = toText(m[2]); h3 = ''; }
    else if (m[3] !== undefined) h3 = toText(m[3]);
    else {
      const inner = /<div class="file-name">([\s\S]*?)<\/div>/.exec(m[5]);
      let title = toText(inner ? inner[1] : m[5]).replace(/\s*Открыть\s*$/i, '').replace(/\n/g, ' ').trim();
      const url = abs(m[4]);
      if (!title) title = fileName(url).replace(/\.\w+$/, '');
      if (!out.some((f) => f.url === url && f.title === title)) out.push({ url, title, path: [section, sub, h3].filter(Boolean) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- группы и курсы в названиях

const LAT = { a: 'а', b: 'б', c: 'с', e: 'е', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у', v: 'в', g: 'г', d: 'д', s: 'с' };
const ALPHABET = 'абвгдежзийклмнопрстуфхцчшщэюя';
const cyr = (s) => lower(s).replace(/(\d{4})\s*([a-z]{1,2})(?![a-z])/g, (_, n, l) => n + [...l].map((ch) => LAT[ch] || ch).join(''));

/**
 * Группы, упомянутые в тексте: «2507а-д», «2507са-сб», «2501а,б», «В2601а1», «2513 а».
 * Возвращает [{num: '2507', from: 'а', to: 'д'}].
 */
export function mentionedGroups(text) {
  const t = cyr(text);
  const out = [];
  const re = /(?:^|[^\d])(\d{4})\s?([а-я]{1,2})(?:\s*[-–]\s*(?:\d{4})?([а-я]{1,2}))?((?:\s*,\s*[а-я](?![а-я\d]))*)/g;
  let m;
  while ((m = re.exec(t))) {
    const [, num, from, toRaw, extra] = m;
    let to = toRaw || from;
    if (to.length < from.length) to = from.slice(0, from.length - to.length) + to;
    out.push({ num, from, to });
    for (const x of (extra || '').match(/[а-я]/g) || []) {
      const one = from.length > 1 ? from.slice(0, -1) + x : x;
      out.push({ num, from: one, to: one });
    }
  }
  return out;
}

const ord = (s) => [...s].map((ch) => ALPHABET.indexOf(ch));
const between = (x, a, b) => {
  if (x.length !== a.length || x.length !== b.length) return false;
  const [ox, oa, ob] = [ord(x), ord(a), ord(b)];
  const cmp = (p, q) => { for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return p[i] - q[i]; return 0; };
  return cmp(oa, ox) <= 0 && cmp(ox, ob) <= 0;
};

/** Упоминается ли группа (например «2507в1») в тексте — с учётом диапазонов «2507а-д». */
export function mentionsGroup(text, group) {
  const g = /^(\d{4})([а-яё]{1,3}?)\d?$/.exec(normGroup(group));
  if (!g) return false;
  const [, num, lets] = g;
  return mentionedGroups(text).some((m) => m.num === num && between(lets.replace('ё', 'е'), m.from, m.to));
}

/** Курс в названии: «1 курса БО», «1,2 курса БО», «3 курса СПО (после 9 класса)». */
export function courseOf(text) {
  const t = lower(text);
  const m = /(\d(?:\s*,\s*\d)*)\s*курс\S*\s*(бо|спо)?(?:[^)]*?\(после\s*(\d+)\s*класса\))?/.exec(t);
  if (!m) return null;
  return { nums: m[1].split(',').map((x) => +x.trim()), prog: m[2] ? m[2].toUpperCase() : null, after: m[3] || null };
}

const sameCourse = (file, mine) => !!file && !!mine && file.nums.some((n) => mine.nums.includes(n))
  && (!file.prog || !mine.prog || file.prog === mine.prog) && (!file.after || !mine.after || file.after === mine.after);

/** Курс пользователя — по названию PDF расписания, где нашлась его группа. */
export function myCourse(data, group) {
  const g = data && data.groups && data.groups[normGroup(group)];
  const src = g && data.sources && data.sources[g.source];
  return src ? courseOf(src.title) : null;
}

// не предметы: тестирование у психолога, классный час, собрания
const NOT_SUBJECT = /тестирован|психолог|классн\S* час|разговоры о важном|собрани|экскурси|линейк/i;

/**
 * Предметы группы для «какие предметы не сдал»: из вопросов к зачётам (это как раз то, что сдают)
 * и из расписания.
 */
export function groupSubjects(data, group, questions = []) {
  const g = data && data.groups && data.groups[normGroup(group)];
  const set = new Set(questions.map((q) => q.subject).filter(Boolean));
  for (const ls of Object.values((g && g.days) || {})) {
    for (const l of ls) if (l.pairs.length && !l.cancelled && l.subject && l.subject.length < 80) set.add(l.subject.split(': ')[0]);
  }
  return [...set].filter((s) => !NOT_SUBJECT.test(s)).sort((a, b) => a.localeCompare(b, 'ru'));
}

// ---------------------------------------------------------------- сессия

// \b в JS не работает с кириллицей — границы слов задаём сами
const word = (w) => new RegExp(`(?:^|[^а-я])${w}(?![а-я])`);
const QUESTION_KIND = [[word('дз'), 'дифф. зачёт'], [word('кр'), 'контрольная работа'], [/(?:^|[^а-я])э(?![а-я])|экзам/, 'экзамен'], [/зач/, 'зачёт']];

/** Вид файла на странице «Промежуточная аттестация». */
export function sessionKind(file) {
  const t = lower(file.title + ' ' + file.path.join(' '));
  if (/приказ/.test(t)) return 'order';
  if (/пересдач|ликвидац|задолженност/.test(t)) return 'retake';
  if (/экзамен|сесси|аттестац/.test(t)) return 'exam';
  return 'other';
}

/**
 * Относится ли файл сессии к группе: по группам в названии; если в названии только курс —
 * по группам внутри PDF (у прошлогоднего «1 курса» там другие группы).
 * Возвращает true / false / 'course' (на весь курс, групп не указано).
 */
export function sessionRelevance(file, group, course, pdf) {
  const own = file.title + ' ' + fileName(file.url);
  if (mentionedGroups(own).length) return mentionsGroup(own, group);
  // группы внутри PDF решают: пересдачи «1 курса» за прошлый год — это уже нынешний 2 курс
  if (pdf && pdf.groups && pdf.groups.length) return pdf.groups.some((g) => mentionsGroup(g, group));
  const fc = courseOf(own);
  return fc && sameCourse(fc, course) ? 'course' : false;
}

/** Вопросы к зачётам: «Химия (2501а)» → {subject, kind} или null, если не для этой группы. */
export function questionFor(file, group) {
  const own = file.title + ' ' + fileName(file.url);
  if (!mentionsGroup(own, group)) return null;
  const subject = file.title.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const tail = lower(fileName(file.url).replace(/\.\w+$/, '').replace(/^.*\)/, ''));
  const kinds = QUESTION_KIND.filter(([re]) => re.test(tail)).map(([, k]) => k);
  return { subject, kind: [...new Set(kinds)].join(', ') };
}

// ---------------------------------------------------------------- пособия к предметам

// у пособий в названии не всегда предмет: «Тригонометрия» — это математика
const TOPIC_SUBJECTS = [[/тригонометр|логарифм/, (s) => /^математика/.test(s)], [/вероятност|статистик/, (s) => s.includes('вероятност')], [/python|алгоритмиз/, (s) => s.includes('алгоритмиз')]];

/** Пособия колледжа, подходящие к предмету пары. */
export function materialsFor(subject, materials) {
  const s = lower(subject);
  if (!s) return [];
  return (materials || []).filter((m) => {
    const t = lower(m.title);
    if (t.includes(s)) return true;
    return TOPIC_SUBJECTS.some(([re, fits]) => re.test(t) && fits(s) && !/рекомендац/.test(t));
  });
}

// ---------------------------------------------------------------- сбор и уведомления

const norm = (s) => lower(s).replace(/[^a-zа-я0-9]+/g, ' ').trim();

/**
 * Скачивает страницы (не чаще EVERY) и собирает extras.json.
 * pdfText(url) — текст PDF (для файлов «на весь курс» и поиска предметов-долгов), только для новых файлов.
 */
export async function buildExtras({ fetchText, pdfText, prev = null, group, debts = [], now = Date.now() }) {
  const ex = prev ? JSON.parse(JSON.stringify(prev)) : {};
  // новая версия разбора — перечитываем всё сразу, не дожидаясь расписания проверок
  if (ex.v !== EXTRAS_VERSION) { ex.fetched = {}; ex.pdf = {}; ex.v = EXTRAS_VERSION; }
  ex.fetched ||= {};
  ex.pdf ||= {};
  const errors = [];
  const failedBefore = ex.failed || {};
  const due = (k) => !ex.fetched[k] || now - ex.fetched[k] >= EVERY[k] || !!failedBefore[k];
  ex.failed = {};
  const load = async (key, url, fn) => {
    if (!due(key)) return;
    try {
      fn(await fetchText(url));
      ex.fetched[key] = now;
    } catch (e) {
      ex.failed[key] = true;
      errors.push(`${key}: ${(e && e.message) || e}`);
    }
  };
  await load('news', NEWS_URL, (h) => { const n = parseNews(h, 'news'); if (n.length) ex.news = n; });
  await load('advert', ADVERT_URL, (h) => { const n = parseNews(h, 'advert'); if (n.length) ex.adverts = n; });
  await load('exams', EXAMS_URL, (h) => { ex.exams = parseFiles(h); });
  await load('questions', QUESTIONS_URL, (h) => { ex.questions = parseFiles(h); });
  await load('materials', MATERIALS_URL, (h) => { ex.materials = parseFiles(h).filter((f) => /\.pdf$/i.test(f.url)); });

  // файлы сессии «на весь курс»: смотрим внутрь PDF — какие там группы и есть ли предметы-долги
  const debtKey = [...debts].sort().join('|');
  for (const f of ex.exams || []) {
    const kind = sessionKind(f);
    if (kind !== 'exam' && kind !== 'retake') continue;
    const own = f.title + ' ' + fileName(f.url);
    if (mentionedGroups(own).length || !courseOf(own)) continue;
    const cached = ex.pdf[f.url];
    if (cached && (kind !== 'retake' || cached.debtKey === debtKey)) continue;
    if (!pdfText) continue;
    try {
      const text = await pdfText(f.url);
      const groups = [...new Set(mentionedGroups(text).map((m) => `${m.num}${m.from}${m.to !== m.from ? '-' + m.to : ''}`))];
      const hay = norm(text);
      const hits = debts.filter((d) => hay.includes(norm(d)));
      ex.pdf[f.url] = { groups, hits, debtKey };
    } catch (e) {
      errors.push(`pdf: ${(e && e.message) || e}`);
    }
  }
  // кэш PDF — только для файлов, которые ещё на сайте
  const live = new Set((ex.exams || []).map((f) => f.url));
  for (const u of Object.keys(ex.pdf)) if (!live.has(u)) delete ex.pdf[u];
  return { extras: ex, errors };
}

/** Начало учебного года (1 сентября) для даты ISO. */
export function yearStart(today) {
  const y = +today.slice(0, 4);
  return today.slice(5) >= '09-01' ? `${y}-09-01` : `${y - 1}-09-01`;
}

/** Дата в названии документа: «от 06.05.2026» → '2026-05-06'. */
const titleDate = (t) => { const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(t); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

/** Что из extras относится к группе: новости, файлы сессии, вопросы, пособия. */
export function extrasFor(ex, data, group, today = null) {
  const course = myCourse(data, group);
  const session = [];
  const from = today ? yearStart(today) : null;
  for (const f of (ex && ex.exams) || []) {
    const kind = sessionKind(f);
    // приказы прошлого учебного года не показываем
    if (kind === 'order' && from && titleDate(f.title) && titleDate(f.title) < from) continue;
    const rel = kind === 'order' ? (courseOf(f.title) ? sameCourse(courseOf(f.title), course) && 'course' : 'all') : sessionRelevance(f, group, course, ex.pdf && ex.pdf[f.url]);
    if (!rel) continue;
    session.push({ ...f, kind, rel, hits: (ex.pdf && ex.pdf[f.url] && ex.pdf[f.url].hits) || [] });
  }
  const questions = [];
  for (const f of (ex && ex.questions) || []) {
    const q = questionFor(f, group);
    if (q && !questions.some((x) => x.url === f.url && x.subject === q.subject)) questions.push({ ...f, ...q });
  }
  const news = [...((ex && ex.news) || []), ...((ex && ex.adverts) || [])]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { course, session, questions, news, materials: (ex && ex.materials) || [] };
}

/**
 * Уведомления: новые новости (за последнюю неделю), новые файлы сессии и вопросы для группы.
 * Самый первый раз — только запоминаем, что уже есть на сайте (без потока старых уведомлений).
 */
export function decideExtras({ extras, data, state, cfg, today }) {
  const st = state;
  // самый первый раз (и после смены группы) — только запоминаем, что уже есть на сайте
  const groupKey = normGroup(cfg.group);
  const first = !st.extrasInit || st.extrasGroup !== groupKey;
  if (st.extrasGroup !== groupKey) st.extrasSeen = {};
  const seen = (st.extrasSeen ||= {});
  st.extrasInit = true;
  st.extrasGroup = groupKey;
  const mine = extrasFor(extras, data, cfg.group, today);
  const messages = [];
  const weekAgo = addDays(today, -7);
  for (const n of mine.news) {
    if (seen[n.url]) continue;
    seen[n.url] = 1;
    if (first || !n.date || n.date < weekAgo || messages.length >= 3) continue;
    messages.push({ kind: 'news', tag: `news-${n.url}`, url: n.url,
      title: `${n.kind === 'advert' ? '📌 Объявление' : '📰 Новость'} ВКИ НГУ: ${n.title}`, body: n.text || 'Открой, чтобы прочитать' });
  }
  const debts = cfg.debts || [];
  for (const f of mine.session) {
    const key = `s:${f.url}`;
    if (seen[key]) continue;
    seen[key] = 1;
    if (first || f.kind === 'order' || f.kind === 'other') continue;
    const what = f.kind === 'retake' ? 'расписание пересдач' : 'расписание экзаменов';
    let body = f.title;
    if (f.kind === 'retake' && debts.length) {
      body = f.hits.length
        ? `Там есть: ${f.hits.join(', ')}. Открой файл, в нём дата, время и аудитория.`
        : `Твоих предметов (${debts.join(', ')}) в файле не нашлось. На всякий случай проверь сам.`;
    }
    messages.push({ kind: 'session', tag: `session-${f.url}`, url: f.url, title: `📅 Выложили ${what}`, body });
  }
  for (const q of mine.questions) {
    const key = `q:${q.url}`;
    if (seen[key]) continue;
    seen[key] = 1;
    if (first) continue;
    messages.push({ kind: 'session', tag: `q-${q.url}`, url: q.url, title: `📝 Вопросы: ${q.subject}`, body: `Выложили вопросы${q.kind ? ' (' + q.kind + ')' : ''} для твоей группы` });
  }
  // не копим бесконечно: только то, что сейчас на сайте
  const live = new Set([...mine.news.map((n) => n.url), ...mine.session.map((f) => `s:${f.url}`), ...mine.questions.map((q) => `q:${q.url}`)]);
  for (const k of Object.keys(seen)) if (!live.has(k)) delete seen[k];
  return { messages, state: st };
}
