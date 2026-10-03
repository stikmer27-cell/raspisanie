// Движок расписания ВКИ НГУ: скачивание страницы, разбор PDF (через pdf.js),
// логика уведомлений. Работает и в WebView на телефоне, и в Node (для тестов).
//
// PDF — таблица: слева день недели / время / номер пары, дальше колонка на
// группу. Ячейки часто объединены (одна пара у нескольких групп, одно
// объявление на весь день), поэтому разбираем по геометрии ячеек.

export const SITE = 'https://ci.nsu.ru';
export const PAGE = SITE + '/education/schedule/';

export const BELLS = {
  1: ['09:00', '10:35'],
  2: ['10:45', '12:20'],
  3: ['13:00', '14:35'],
  4: ['14:45', '16:20'],
  5: ['16:30', '18:05'],
  6: ['18:15', '19:50'],
};
const START_TO_PAIR = Object.fromEntries(Object.entries(BELLS).map(([k, v]) => [v[0], +k]));

export const WEEKDAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const WD_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
  'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// Латиница, которую легко спутать с кириллицей или набрать вместо неё ("2401a1").
const LAT = 'aAbBcCeEkKmMhHoOpPtTxXyYgGdDvVsS';
const LOOK = Object.fromEntries([...LAT].map((ch, i) => [ch, 'аАбБсСеЕкКмМнНоОрРтТхХуУгГдДвВсС'[i]]));
const GROUP_RE = /^в?\d{4}[а-яё]{1,3}\d?$/;
const DATE_RE = /(\d{2})\.(\d{2})\.(\d{2,4})/;
const TIME_RANGE_RE = /(\d{1,2}):(\d{2})(?::\d{2})?-(\d{1,2}):(\d{2})/;

export function normGroup(name) {
  // буква перед цифрами — это префикс «В» (ВКИ), как бы его ни набрали
  const s = String(name || '').replace(/\s+/g, '').replace(/^[^\d]{1}(?=\d{4})/, '');
  return s.replace(/[a-zA-Z]/g, (ch) => LOOK[ch] || ch).toLowerCase();
}

const clean = (t) => String(t || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
const squash = (t) => String(t || '').replace(/\s+/g, '');
// в ячейке есть хоть одна буква или цифра (случайный «\» в пустой ячейке — не пара)
const meaningful = (t) => /[\p{L}\p{N}]/u.test(String(t || ''));
const pad2 = (n) => String(n).padStart(2, '0');

// ---------------------------------------------------------------- даты

export function isoDate(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}
function validDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? isoDate(y, m, d) : null;
}
export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const weekday = (iso) => (new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7;
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
export const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** Текущие дата и минуты в нужном часовом поясе. */
export function nowTz(tz = 'Asia/Novosibirsk', date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return { iso: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
}

// ---------------------------------------------------------------- текст ячеек

function parseDayLabel(raw) {
  const s = squash(raw);
  for (const cand of [[...s].reverse().join(''), s]) {
    const low = cand.toLowerCase();
    const wd = WEEKDAYS.findIndex((name) => low.includes(name.toLowerCase()));
    if (wd < 0) continue;
    let date = null;
    const m = DATE_RE.exec(cand);
    if (m) {
      let [d, mth, y] = m.slice(1).map(Number);
      if (y < 100) y += 2000;
      date = validDate(y, mth, d);
    }
    return [wd, date];
  }
  return [null, null];
}

function parseTime(raw) {
  const m = TIME_RANGE_RE.exec(squash(raw));
  if (!m) return [null, null];
  return [`${pad2(+m[1])}:${m[2]}`, `${pad2(+m[3])}:${m[4]}`];
}

const ROOM_SRC = String.raw`(Читальн[\p{L}\p{N}_]*\s*з+ал[\p{L}\p{N}_]*(?:\s*-\s*[АA])?|Актов[\p{L}\p{N}_]*\s+зал|Студ\.?\s*КБ|(?<!\d)\d{3}\s?[а-яА-Я]?(?![\dа-яё]))`;
const ROOM_RE = new RegExp(ROOM_SRC, 'iu');
const ROOM_RE_ALL = new RegExp(ROOM_SRC, 'giu');
const TEACHER_RE = /[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ]\.\s?[А-ЯЁ]\.?/u;

const isUpper = (s) => s === s.toUpperCase() && s !== s.toLowerCase();
const stripChars = (s, chars) => {
  let a = 0, b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
};

const KIND_LEAD_RE = /^(лекци[яи]|практическ\S*\s+заняти\S*|лабораторн\S*\s+работ\S*|семинар\S*)\s+/iu;
const normRoom = (r) => r.replace(/\s+/g, ' ').replace(/\s*-\s*/g, '-').trim();
const tidy = (s) => {
  const t = stripChars(s
    .replace(/(^|\s)[,;:]+(?=\s|$)/g, ' ') // запятая, оставшаяся от вынутых аудиторий «314, 310»
    .replace(/\s+/g, ' ').replace(/\s+([,.;:!])/g, '$1').replace(/([,;:])(?:\s*[,;:])+/g, '$1'), ' ,;:-–—');
  return t.replace(/^\.+\s*/, ''); // точку в конце предложения оставляем
};

/**
 * Раскладка текста ячейки на поля: 'Математика (Практические занятия) Сурмин А.Г. 101'.
 * Ничего не теряем: всё, что не стало видом занятия, преподавателем или аудиторией,
 * остаётся в названии («Учебная практика — ПМ.11 Разработка…»); аудиторий может быть несколько.
 */
export function splitLesson(text) {
  const body = text.replace(/^\s*отмена[:!.\s]*/i, '').trim() || text;
  let subject = body, kind = '', rest = '';
  const m = /^([^()]+?)\s*\(([^)]*)\)\.?\s*(.*)$/.exec(body);
  if (m) [subject, kind, rest] = [m[1].trim(), stripChars(m[2], ' ('), m[3].trim()];
  // в PDF бывает название, набранное дважды подряд: «Разработка программных модулейРазработка программных модулей»
  if (m) subject = subject.replace(/^(\S.{5,}?)\s*\1$/u, '$1');
  else {
    // «Лекция ИНФОРМАТИКА Читальный зал-А Белякова М.А.» — вид занятия впереди, без скобок
    const k = KIND_LEAD_RE.exec(body);
    if (k) { kind = k[1]; subject = body.slice(k[0].length); }
    rest = subject;
  }
  // аудитории и преподаватель — из хвоста (а если скобок нет — из всего текста)
  const rooms = [...new Set((rest.match(ROOM_RE_ALL) || []).map(normRoom))];
  const t = TEACHER_RE.exec(rest);
  let teacher = t ? t[0].trim() : '';
  let extra = rest;
  if (teacher) extra = extra.replace(t[0], ' ');
  extra = extra.replace(ROOM_RE_ALL, ' ').replace(/(^|\s)ауд(итория)?\.?(?=\s|$)/giu, ' ');
  if (m) {
    // второй вид занятия в скобках в хвосте: «… ПМ.11 Разработка… (Лабораторная работа)»
    extra = extra.replace(/\(([^)]*)\)/g, (_, k2) => { const v = tidy(k2); if (v && !kind.toLowerCase().includes(v.toLowerCase())) kind = kind ? `${kind}, ${v}` : v; return ' '; });
    extra = tidy(extra);
    if (!teacher && extra && !/[а-яё]{4}/.test(extra.replace(/^[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.?$/u, ''))) { teacher = extra; extra = ''; } // «Рогулин В»
    if (/\p{L}{3}/u.test(extra)) subject = `${subject}: ${extra}`;
  } else {
    subject = tidy(extra) || subject;
  }
  if (isUpper(subject) && subject.length > 8) subject = subject[0].toUpperCase() + subject.slice(1).toLowerCase();
  kind = tidy(kind);
  return { subject: tidy(subject), kind, teacher, room: rooms.join(', ') };
}

// ---------------------------------------------------------------- геометрия PDF

const mul = (m1, m2) => [
  m1[0] * m2[0] + m1[1] * m2[2], m1[0] * m2[1] + m1[1] * m2[3],
  m1[2] * m2[0] + m1[3] * m2[2], m1[2] * m2[1] + m1[3] * m2[3],
  m1[4] * m2[0] + m1[5] * m2[2] + m2[4], m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Горизонтальные и вертикальные отрезки всех закрашенных/обведённых путей. */
async function pageEdges(pdfjs, page, H) {
  const O = pdfjs.OPS;
  const PAINT = new Set([O.stroke, O.closeStroke, O.fill, O.eoFill, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke]);
  const ops = await page.getOperatorList();
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const edges = [];
  const seg = (p, q) => {
    const dx = Math.abs(q[0] - p[0]), dy = Math.abs(q[1] - p[1]);
    if (dy < 0.01 && dx > 0) {
      edges.push({ o: 'h', x0: Math.min(p[0], q[0]), x1: Math.max(p[0], q[0]), top: H - p[1], bottom: H - p[1] });
    } else if (dx < 0.01 && dy > 0) {
      edges.push({ o: 'v', x0: p[0], x1: p[0], top: H - Math.max(p[1], q[1]), bottom: H - Math.min(p[1], q[1]) });
    }
  };
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], args = ops.argsArray[i];
    if (fn === O.save) stack.push(ctm);
    else if (fn === O.restore) ctm = stack.pop() || ctm;
    else if (fn === O.transform) ctm = mul(args, ctm);
    else if (fn === O.paintFormXObjectBegin) { stack.push(ctm); if (args && args[0]) ctm = mul(args[0], ctm); }
    else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === O.constructPath) {
      const [paint, paths] = args;
      if (!PAINT.has(paint) || !paths) continue;
      for (const buf of paths) {
        if (!buf) continue;
        let start = null, cur = null;
        for (let k = 0; k < buf.length;) {
          const op = buf[k++];
          if (op === 0) { cur = start = apply(ctm, buf[k], buf[k + 1]); k += 2; }
          else if (op === 1) { const p = apply(ctm, buf[k], buf[k + 1]); k += 2; if (cur) seg(cur, p); cur = p; }
          else if (op === 2) { cur = apply(ctm, buf[k + 4], buf[k + 5]); k += 6; }
          else if (op === 3) { cur = apply(ctm, buf[k + 2], buf[k + 3]); k += 4; }
          else if (op === 4) { if (cur && start) seg(cur, start); cur = start; }
          else break;
        }
      }
    }
  }
  return edges;
}

// Кластеризация как в pdfplumber: соседние значения ближе допуска — в одну группу.
function snap(edges, key, tol) {
  const sorted = edges.map((e) => ({ ...e })).sort((a, b) => a[key] - b[key]);
  const out = [];
  let group = [];
  const flush = () => {
    if (!group.length) return;
    const avg = group.reduce((s, e) => s + e[key], 0) / group.length;
    for (const e of group) {
      if (key === 'x0') { e.x0 = avg; e.x1 = avg; } else { e.top = avg; e.bottom = avg; }
      out.push(e);
    }
    group = [];
  };
  for (const e of sorted) {
    if (group.length && e[key] > group[group.length - 1][key] + tol) flush();
    group.push(e);
  }
  flush();
  return out;
}

function joinGroup(edges, o, tol) {
  const [minP, maxP] = o === 'h' ? ['x0', 'x1'] : ['top', 'bottom'];
  const sorted = [...edges].sort((a, b) => a[minP] - b[minP]);
  const joined = [{ ...sorted[0] }];
  for (const e of sorted.slice(1)) {
    const last = joined[joined.length - 1];
    if (e[minP] <= last[maxP] + tol) {
      if (e[maxP] > last[maxP]) last[maxP] = e[maxP];
    } else joined.push({ ...e });
  }
  return joined;
}

function mergeEdges(edges, tol = 3) {
  const h = snap(edges.filter((e) => e.o === 'h'), 'top', tol);
  const v = snap(edges.filter((e) => e.o === 'v'), 'x0', tol);
  const groups = new Map();
  for (const e of [...h, ...v]) {
    const k = e.o === 'h' ? `h${e.top}` : `v${e.x0}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const out = [];
  for (const [k, es] of groups) out.push(...joinGroup(es, k[0], tol));
  return out;
}

const edgeLen = (e) => (e.o === 'h' ? e.x1 - e.x0 : e.bottom - e.top);

/** Ячейки таблицы по пересечениям линий (алгоритм pdfplumber). */
function edgesToCells(rawEdges) {
  let edges = rawEdges.filter((e) => edgeLen(e) >= 1);
  edges = mergeEdges(edges, 3).filter((e) => edgeLen(e) >= 3);
  edges.forEach((e, i) => { e.id = i; });
  const vs = edges.filter((e) => e.o === 'v').sort((a, b) => a.x0 - b.x0 || a.top - b.top);
  const hs = edges.filter((e) => e.o === 'h').sort((a, b) => a.top - b.top || a.x0 - b.x0);
  const tol = 3;
  const inter = new Map();
  for (const v of vs) {
    for (const h of hs) {
      if (v.top <= h.top + tol && v.bottom >= h.top - tol && v.x0 >= h.x0 - tol && v.x0 <= h.x1 + tol) {
        const key = `${v.x0},${h.top}`;
        if (!inter.has(key)) inter.set(key, { x: v.x0, y: h.top, v: new Set(), h: new Set() });
        const p = inter.get(key);
        p.v.add(v.id);
        p.h.add(h.id);
      }
    }
  }
  const pts = [...inter.values()].sort((a, b) => a.x - b.x || a.y - b.y);
  const shares = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };
  const connects = (p1, p2) => (p1.x === p2.x && shares(p1.v, p2.v)) || (p1.y === p2.y && shares(p1.h, p2.h));
  const cells = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const pt = pts[i];
    const rest = pts.slice(i + 1);
    const below = rest.filter((p) => p.x === pt.x);
    const right = rest.filter((p) => p.y === pt.y);
    let found = null;
    outer:
    for (const b of below) {
      if (!connects(pt, b)) continue;
      for (const r of right) {
        if (!connects(pt, r)) continue;
        const br = inter.get(`${r.x},${b.y}`);
        if (br && connects(br, r) && connects(br, b)) { found = [pt.x, pt.y, br.x, br.y]; break outer; }
      }
    }
    if (found) cells.push(found);
  }
  return cells;
}

/** Кусочки текста страницы с центрами (координаты сверху-вниз, как в pdfplumber). */
async function pageTexts(page, H) {
  const tc = await page.getTextContent();
  const out = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const [a, b, c, d, e, f] = it.transform;
    const na = Math.hypot(a, b) || 1, nc = Math.hypot(c, d) || 1;
    const size = Math.hypot(c, d) || it.height || 1;
    const dir = [a / na, b / na], up = [c / nc, d / nc];
    const w = it.width, h = it.height || size;
    const cx = e + dir[0] * w / 2 + up[0] * h * 0.35;
    const cy = f + dir[1] * w / 2 + up[1] * h * 0.35;
    out.push({ str: it.str, xc: cx, yc: H - cy, x: e, top: H - f, w, size, horiz: Math.abs(dir[0]) > 0.7 });
  }
  return out;
}

function cellText(all) {
  // «жирный» в этих PDF рисуют повторной печатью того же текста со сдвигом на доли пункта
  const items = [];
  for (const it of all) {
    const near = Math.max(1, it.size * 0.5);
    if (!items.some((k) => k.str === it.str && Math.abs(k.x - it.x) < near && Math.abs(k.top - it.top) < near)) items.push(it);
  }
  if (!items.length) return '';
  if (!items.every((i) => i.horiz)) return items.map((i) => i.str).join('');
  const sorted = [...items].sort((a, b) => a.top - b.top || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].top - it.top) < Math.max(1.5, it.size * 0.5)) line.push(it);
    else lines.push([it]);
  }
  return lines.map((ln) => {
    ln.sort((a, b) => a.x - b.x);
    let s = '';
    let end = null;
    for (const it of ln) {
      if (end !== null && it.x - end > it.size * 0.15 && !s.endsWith(' ') && !it.str.startsWith(' ')) s += ' ';
      s += it.str;
      end = it.x + it.w;
    }
    return s;
  }).join('\n');
}

function makeCell([x0, top, x1, bottom], text = '') {
  return { x0, top, x1, bottom, text, xc: (x0 + x1) / 2, yc: (top + bottom) / 2 };
}

function fillTexts(cells, items) {
  const order = cells.map((c, i) => i).sort((i, j) =>
    (cells[i].x1 - cells[i].x0) * (cells[i].bottom - cells[i].top) - (cells[j].x1 - cells[j].x0) * (cells[j].bottom - cells[j].top));
  const find = (x, y) => {
    for (const i of order) {
      const c = cells[i];
      if (c.x0 <= x && x <= c.x1 && c.top <= y && y <= c.bottom) return i;
    }
    return -1;
  };
  const at = items.map((it) => find(it.xc, it.yc));

  // Текст, который не влез в ячейку, вылезает за её линию (строка перечёркнута границей).
  // По центру такая строка попадает в соседнюю ячейку — возвращаем её к своему абзацу:
  // туда, где ближе соседняя строка того же столбца.
  const overlapX = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w;
  const nearestLine = (k, cell) => {
    let best = Infinity;
    items.forEach((o, m) => {
      if (m === k || at[m] !== cell || !o.horiz || !overlapX(o, items[k])) return;
      const dy = Math.abs(o.top - items[k].top);
      if (dy > items[k].size * 0.5) best = Math.min(best, dy); // строки той же строки не считаем
    });
    return best;
  };
  items.forEach((it, k) => {
    const i = at[k];
    if (i < 0 || !it.horiz) return;
    const c = cells[i];
    const reach = it.size * 0.4;
    let other = -1;
    if (it.yc - c.top < reach) other = find(it.xc, c.top - reach - 0.5);
    else if (c.bottom - it.yc < reach) other = find(it.xc, c.bottom + reach + 0.5);
    if (other < 0 || other === i) return;
    const there = nearestLine(k, other), here = nearestLine(k, i);
    if (there < here && there < it.size * 2.5) at[k] = other;
  });

  const buckets = cells.map(() => []);
  items.forEach((it, k) => { if (at[k] >= 0) buckets[at[k]].push(it); });
  cells.forEach((c, i) => { c.items = buckets[i]; c.text = cellText(buckets[i]); c.used = false; });
}

/**
 * Горизонтальные «кучки» текста в ячейке: [x0, x1, items]. Строки одного абзаца перекрываются по x.
 * Если все кучки стоят на одних и тех же строках — это один текст с большими пробелами
 * («История (Практические занятия)        Подрезова Т.В. 105»), а не два разных.
 */
function textClustersX(items) {
  const lines = [];
  for (const it of [...items].sort((a, b) => a.top - b.top || a.x - b.x)) {
    const ln = lines.find((l) => Math.abs(l.top - it.top) < it.size * 0.5);
    if (ln) ln.items.push(it);
    else lines.push({ top: it.top, items: [it] });
  }
  const segs = [];
  lines.forEach((ln, li) => {
    let cur = null;
    for (const it of ln.items.sort((a, b) => a.x - b.x)) {
      if (cur && it.x <= cur[1] + it.size * 1.2) { cur[1] = Math.max(cur[1], it.x + it.w); cur[2].push(it); }
      else { cur = [it.x, it.x + it.w, [it], li]; segs.push(cur); }
    }
  });
  const out = [];
  for (const s of segs.sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1] + 1) { last[1] = Math.max(last[1], s[1]); last[2].push(...s[2]); last[3].add(s[3]); }
    else out.push([s[0], s[1], [...s[2]], new Set([s[3]])]);
  }
  const same = out.every((k) => k[3].size === lines.length);
  return same ? [[Math.min(...out.map((k) => k[0])), Math.max(...out.map((k) => k[1])), items]] : out;
}

/** Вертикальные абзацы в ячейке: строки подряд (интервал меньше ~2 строк) — один абзац. */
function textClustersY(items) {
  const out = [];
  for (const it of [...items].sort((a, b) => a.top - b.top)) {
    const last = out[out.length - 1];
    if (last && it.top - last[1] <= it.size * 2.2) { last[1] = Math.max(last[1], it.top); last[2].push(it); }
    else out.push([it.top, it.top, [it]]);
  }
  return out;
}

/**
 * В PDF бывает не нарисована вертикальная граница между соседними группами — тогда две ячейки
 * сливаются в одну, и в ней оказываются два разных текста (каждый — под своей группой).
 * Делим такую ячейку по колонкам: если каждый текст стоит над своими колонками и каждая колонка
 * накрыта ровно одним текстом. Неоднозначные случаи помечаем — самопроверка выдаст предупреждение.
 */
function splitMergedCells(body, columns) {
  const cols = Object.values(columns);
  const coveredBy = (c) => cols.filter((col) => c.x0 - 1 <= col.xc && col.xc <= c.x1 + 1);
  const textItems = (c) => (c.items || []).filter((it) => it.horiz && meaningful(it.str));
  // части деления: [x0, x1] каждой — по своим колонкам
  const parts = new Map();
  for (const c of body) {
    const covered = coveredBy(c);
    const items = textItems(c);
    const clusters = covered.length > 1 && items.length > 1 ? textClustersX(items) : [];
    if (clusters.length < 2) continue;
    const owner = covered.map((col) => {
      const hits = clusters.map((k, i) => [i, Math.min(k[1], col.x1) - Math.max(k[0], col.x0)]).filter(([, ov]) => ov > 0.5);
      return hits.length === 1 ? hits[0][0] : -1;
    });
    if (owner.some((o) => o < 0) || new Set(owner).size !== clusters.length) continue; // неоднозначно — поймает самопроверка 7
    parts.set(c, clusters.map((_, i) => {
      const mine = covered.filter((_, j) => owner[j] === i);
      return [Math.max(c.x0, Math.min(...mine.map((m) => m.x0))), Math.min(c.x1, Math.max(...mine.map((m) => m.x1)))];
    }));
  }
  // та же ячейка без границы бывает разрезана по высоте на куски (той же ширины, стык в стык) —
  // их делим по тем же колонкам
  let grown = true;
  while (grown) {
    grown = false;
    for (const c of body) {
      if (parts.has(c) || coveredBy(c).length < 2) continue;
      for (const [s, p] of parts) {
        if (Math.abs(s.x0 - c.x0) < 1.5 && Math.abs(s.x1 - c.x1) < 1.5 && c.bottom >= s.top - 1.5 && c.top <= s.bottom + 1.5) {
          parts.set(c, p);
          grown = true;
          break;
        }
      }
    }
  }
  const out = [];
  for (const c of body) {
    const p = parts.get(c);
    if (!p) { out.push(c); continue; }
    p.forEach(([x0, x1]) => {
      const its = (c.items || []).filter((it) => x0 - 0.5 <= it.xc && it.xc <= x1 + 0.5);
      const sub = makeCell([x0, c.top, x1, c.bottom], cellText(its));
      sub.items = its;
      sub.used = false;
      sub.split = true;
      out.push(sub);
    });
  }
  return out;
}

// ---------------------------------------------------------------- разбор таблицы

function serviceColumns(cells, headerBottom, groupsX0) {
  const left = cells.filter((c) => c.top >= headerBottom - 1 && c.x1 <= groupsX0 + 2);
  const clusters = new Map();
  for (const c of left) {
    const k = Math.round(c.xc / 4);
    if (!clusters.has(k)) clusters.set(k, []);
    clusters.get(k).push(c);
  }
  const score = (kind, cs) => {
    if (kind === 'time') return cs.filter((c) => TIME_RANGE_RE.test(squash(c.text))).length;
    if (kind === 'num') return cs.filter((c) => /^[1-8]$/.test(squash(c.text))).length;
    return cs.filter((c) => parseDayLabel(c.text)[0] !== null).length;
  };
  const found = {};
  for (const kind of ['time', 'num', 'day']) {
    let best = null, bestScore = 0;
    for (const cs of clusters.values()) {
      const s = score(kind, cs);
      if (s > bestScore) { best = cs; bestScore = s; }
    }
    if (best) found[kind] = makeCell([Math.min(...best.map((c) => c.x0)), 0, Math.max(...best.map((c) => c.x1)), 0]);
  }
  return found;
}

function collect(block, body, columns, special) {
  const out = {};
  const top = Math.min(...block.slots.map((s) => s.top));
  const bottom = Math.max(...block.slots.map((s) => s.bottom));
  const service = Object.values(special);
  for (const c of body) {
    if (!meaningful(c.text)) continue;
    if (service.some((sc) => sc.x0 - 1 <= c.xc && c.xc <= sc.x1 + 1 && c.x1 <= sc.x1 + 2)) continue;
    if (c.bottom <= top + 1 || c.top >= bottom - 1) continue;
    let hit = block.slots.filter((s) => c.top - 1 <= (s.top + s.bottom) / 2 && (s.top + s.bottom) / 2 <= c.bottom + 1);
    if (!hit.length) hit = block.slots.filter((s) => s.top - 1 <= c.yc && c.yc <= s.bottom + 1);
    if (!hit.length) continue;
    for (const [norm, col] of Object.entries(columns)) {
      if (c.x0 - 1 <= col.xc && col.xc <= c.x1 + 1) {
        for (const s of hit) (out[norm] ||= []).push([s, c]);
        c.used = true;
      }
    }
  }
  return out;
}

function mergeLessons(items) {
  const byCell = new Map();
  for (const [s, c] of items) {
    if (!byCell.has(c)) byCell.set(c, []);
    byCell.get(c).push(s);
  }
  const bySlots = new Map();
  for (const [c, slots] of byCell) {
    const key = [...new Set(slots.map((s) => s.id))].sort((a, b) => a - b).join(',');
    if (!bySlots.has(key)) bySlots.set(key, { slots: [...new Set(slots)], cells: [] });
    bySlots.get(key).cells.push(c);
  }
  const lessons = [];
  for (const { slots: raw, cells } of bySlots.values()) {
    const slots = [...raw].sort((a, b) => a.top - b.top);
    cells.sort((a, b) => a.top - b.top || a.x0 - b.x0);
    // подстроки одной пары — это обычно продолжение того же текста
    const text = [...new Set(cells.map((c) => clean(c.text)).filter(Boolean))].join(' ');
    const nums = [...new Set(slots.map((s) => s.num).filter((n) => n !== null))];
    let starts = slots.map((s) => s.start).filter(Boolean);
    const ends = slots.map((s) => s.end).filter(Boolean);
    if (!nums.length && !starts.length) {
      const m = /(\d{1,2})[-:.](\d{2})/.exec(text);
      if (m) starts = [`${pad2(+m[1])}:${m[2]}`];
    }
    const lesson = {
      pairs: nums,
      start: starts[0] || null,
      end: ends.length ? ends[ends.length - 1] : null,
      text,
      cancelled: text.toLowerCase().includes('отмен'),
      ...splitLesson(text),
    };
    // для самопроверки; в результат не попадает
    Object.defineProperty(lesson, 'slotIds', { value: slots.map((s) => s.id), enumerable: false });
    lessons.push(lesson);
  }
  return lessons;
}

/**
 * Независимые самопроверки разбора. Каждая ловит свой класс ошибок:
 *  1. текст из таблицы, не попавший ни в одну пару (потеря данных);
 *  2. текст, лежащий в колонке группы на строке пары, но не вошедший в эту пару
 *     (перепутаны пары/группы) — проверка по «полосам», без геометрии ячеек;
 *  3. день недели не совпадает с датой, дни идут не по порядку, день без подписи;
 *  4. номера пар идут не подряд, время не совпадает со звонками;
 *  5. у группы в одной паре две разные записи;
 *  6. ячейка лишь частично заходит в колонку группы;
 *  7. в ячейке на несколько групп — отдельные тексты над разными колонками (нет границы в PDF);
 *  8. в ячейке на несколько пар — отдельные тексты для разных пар;
 *  9. запись без названия предмета (обрывок текста из соседней ячейки, случайный символ).
 */
function selfCheck({ pages, blocks, groups }) {
  const warnings = [];
  const warn = (group, date, msg) => warnings.push({ group, date, msg });
  const short = (s) => (s.length > 60 ? s.slice(0, 57) + '...' : s);

  // индекс: группа + строка-пара -> текст разобранных пар
  const bySlot = new Map();
  for (const [norm, g] of Object.entries(groups)) {
    for (const ls of Object.values(g.days)) {
      for (const l of ls) {
        for (const id of l.slotIds || []) {
          const k = `${norm}|${id}`;
          bySlot.set(k, (bySlot.get(k) || '') + squash(l.text));
        }
      }
    }
  }

  for (const pg of pages) {
    const service = Object.values(pg.special);
    const groupCols = Object.values(pg.columns);
    const slots = pg.blocks.flatMap((b) => b.slots);
    if (!slots.length) continue;
    const top = Math.min(...slots.map((s) => s.top));
    const bottom = Math.max(...slots.map((s) => s.bottom));

    // 6. ячейка, отданная группе, должна целиком накрывать её колонку
    //    (иначе неверно найдены линии таблицы и пара «расползлась» на чужие группы)
    for (const c of pg.body) {
      if (!c.used) continue;
      for (const [norm, col] of Object.entries(pg.columns)) {
        if (c.x0 - 1 <= col.xc && col.xc <= c.x1 + 1 && (c.x0 > col.x0 + 2 || c.x1 < col.x1 - 2)) {
          warn(norm, null, `Ячейка "${short(clean(c.text))}" лишь частично заходит в колонку группы`);
        }
      }
    }

    // 7. ячейка на несколько групп, а в ней отдельные тексты над разными колонками
    //    (в PDF не нарисована граница между группами, и ячейку не удалось поделить)
    for (const c of pg.body) {
      if (!c.used) continue;
      const covered = Object.entries(pg.columns).filter(([, col]) => c.x0 - 1 <= col.xc && col.xc <= c.x1 + 1);
      if (covered.length < 2) continue;
      if (textClustersX((c.items || []).filter((it) => it.horiz && meaningful(it.str))).length < 2) continue;
      for (const [norm] of covered) warn(norm, null, `В одной ячейке несколько разных текстов: "${short(clean(c.text))}"`);
    }

    // 8. ячейка на несколько пар, а в ней отдельные тексты для каждой пары
    //    (в PDF не нарисована граница между парами — тексты слиплись бы в одну запись)
    for (const c of pg.body) {
      if (!c.used) continue;
      const hit = slots.filter((s) => s.num !== null && c.top - 1 <= (s.top + s.bottom) / 2 && (s.top + s.bottom) / 2 <= c.bottom + 1);
      if (hit.length < 2) continue;
      const parts = textClustersY((c.items || []).filter((it) => it.horiz && meaningful(it.str)));
      if (parts.length < 2) continue;
      const slotOf = (p) => hit.findIndex((s) => s.top - 1 <= p[0] - p[2][0].size && p[1] <= s.bottom + 1);
      const own = parts.map(slotOf);
      if (own.every((i) => i >= 0) && new Set(own).size === parts.length) {
        for (const [norm, col] of Object.entries(pg.columns)) {
          if (c.x0 - 1 <= col.xc && col.xc <= c.x1 + 1) warn(norm, hit[0].block && hit[0].block.date, `Ячейка на ${hit.length} пары, но в ней отдельные тексты: "${short(clean(c.text))}"`);
        }
      }
    }

    // 1. потерянный текст
    for (const c of pg.body) {
      if (c.used || !meaningful(c.text)) continue;
      if (service.some((sc) => sc.x0 - 1 <= c.xc && c.xc <= sc.x1 + 1 && c.x1 <= sc.x1 + 2)) continue;
      if (!groupCols.some((col) => c.x0 - 1 <= col.xc && col.xc <= c.x1 + 1)) continue;
      if (c.bottom <= top + 1 || c.top >= bottom - 1) continue;
      warn(null, null, `Текст не попал ни в одну пару: "${short(clean(c.text))}"`);
    }

    // 2. полосы «колонка группы × строка пары»
    for (const [norm, col] of Object.entries(pg.columns)) {
      for (const s of slots) {
        const date = s.block && s.block.date;
        const got = bySlot.get(`${norm}|${s.id}`) || '';
        for (const it of pg.items) {
          if (it.xc < col.x0 + 0.5 || it.xc > col.x1 - 0.5 || it.yc < s.top || it.yc > s.bottom) continue;
          const want = squash(it.str);
          // строка, вылезшая за границу пары (не влезла в ячейку), может принадлежать соседней паре
          const near = (dy) => slots.find((o) => o !== s && o.top <= it.yc + dy && it.yc + dy <= o.bottom);
          const spill = it.yc - s.top < it.size * 0.4 ? near(-it.size * 0.8) : s.bottom - it.yc < it.size * 0.4 ? near(it.size * 0.8) : null;
          if (spill && (bySlot.get(`${norm}|${spill.id}`) || '').includes(want)) continue;
          if (want && meaningful(want) && !got.includes(want)) {
            warn(norm, date, `${s.num ? s.num + ' пара' : 'строка ' + (s.start || '')}: "${short(it.str.trim())}" не совпал с разобранным "${short(got) || 'пусто'}"`);
          }
        }
      }
    }

    // 4. порядок пар и звонки
    for (const b of pg.blocks) {
      const nums = b.slots.map((s) => s.num).filter((n) => n !== null);
      const uniq = [...new Set(nums)];
      if (uniq.some((n, i) => i > 0 && n !== uniq[i - 1] + 1) || uniq.join() !== nums.filter((n, i) => i === 0 || n !== nums[i - 1]).join()) {
        warn(null, b.date, `Номера пар идут не подряд: ${nums.join(', ')}`);
      }
      for (const s of b.slots) {
        if (s.num !== null && !(s.num in BELLS)) warn(null, b.date, `Неизвестный номер пары: ${s.num}`);
        if (s.num !== null && s.parsedStart && s.parsedStart !== BELLS[s.num]?.[0]) {
          warn(null, b.date, `${s.num} пара: в PDF время ${s.parsedStart}, по звонкам ${BELLS[s.num]?.[0]}`);
        }
      }
    }
  }

  // 3. дни
  const seen = new Set();
  let prevDate = null;
  for (const [b] of blocks) {
    if (!b.named) warn(null, b.date, 'День без подписи в PDF, определён по порядку');
    if (b.labelDate && weekday(b.labelDate) !== b.weekday) warn(null, b.date, `Дата ${b.labelDate} не совпадает с днём недели "${WEEKDAYS[b.weekday]}"`);
    if (b.date && seen.has(b.date)) warn(null, b.date, 'День встречается в PDF дважды');
    if (b.date && prevDate && b.date < prevDate) warn(null, b.date, 'Дни идут не по порядку');
    if (b.date) { seen.add(b.date); prevDate = b.date; }
  }

  // 9. запись без названия — только преподаватель / аудитория / знаки: обрывок чужого текста
  //    (вылез из соседней ячейки) или случайный символ в пустой ячейке
  for (const [norm, g] of Object.entries(groups)) {
    for (const [date, ls] of Object.entries(g.days)) {
      for (const l of ls) {
        const rest = l.text.replace(new RegExp(TEACHER_RE.source, 'gu'), ' ').replace(ROOM_RE_ALL, ' ').replace(/[^\p{L}]+/gu, '');
        if (rest.length < 3) warn(norm, date, `${l.pairs.length ? l.pairs.join('-') + ' пара' : 'запись'}: нет названия, только "${short(l.text)}"`);
      }
    }
  }

  // 5. две разные записи в одной паре
  for (const [norm, g] of Object.entries(groups)) {
    for (const [date, ls] of Object.entries(g.days)) {
      const taken = new Map();
      for (const l of ls) {
        for (const p of l.pairs) {
          if (taken.has(p) && taken.get(p) !== l.text) warn(norm, date, `${p} пара: две разные записи, "${short(taken.get(p))}" и "${short(l.text)}"`);
          taken.set(p, l.text);
        }
      }
    }
  }
  return warnings;
}

/** Разбор одного PDF. Возвращает {dates, groups: {norm: {name, days: {iso: [lesson]}}}}. */
export async function parsePdf(pdfjs, bytes, fallbackWeekDate = null) {
  const task = pdfjs.getDocument({ data: bytes, verbosity: 0, isEvalSupported: false, disableFontFace: true, useSystemFonts: false });
  const doc = await task.promise;
  const blocks = [];
  const pages = [];
  let columns = null;
  let special = {};
  let slotId = 0;
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const H = page.view[3];
      const cells = edgesToCells(await pageEdges(pdfjs, page, H)).map((b) => makeCell(b));
      const items = await pageTexts(page, H);
      fillTexts(cells, items);
      page.cleanup();
      if (!cells.length) continue;

      // шапка: колонки групп
      const header = {};
      for (const c of cells) {
        const raw = clean(c.text);
        if (raw && GROUP_RE.test(normGroup(raw))) header[normGroup(raw)] = makeCell([c.x0, c.top, c.x1, c.bottom], raw.replace(/ /g, ''));
      }
      let headerBottom;
      if (Object.keys(header).length) {
        columns = header;
        headerBottom = Math.max(...Object.values(header).map((c) => c.bottom));
      } else {
        headerBottom = Math.min(...cells.map((c) => c.top)) - 1;
      }
      if (!columns) continue;
      const found = serviceColumns(cells, headerBottom, Math.min(...Object.values(columns).map((c) => c.x0)));
      if (found.time || found.num) special = found;
      if (!Object.keys(special).length) continue;

      const inCol = (c, col) => col.x0 - 1 <= c.xc && c.xc <= col.x1 + 1;
      const body = splitMergedCells(cells.filter((c) => c.top >= headerBottom - 1), columns);
      const rowCol = special.time || special.num;
      const timeCells = body.filter((c) => inCol(c, rowCol)).sort((a, b) => a.top - b.top);
      const numCells = special.num ? body.filter((c) => inCol(c, special.num)) : [];
      const dayCells = special.day ? body.filter((c) => inCol(c, special.day)) : [];

      // строки-пары
      const slots = [];
      for (const tc of timeCells) {
        let [start, end] = parseTime(tc.text);
        const parsedStart = start;
        let num = null;
        for (const nc of numCells) {
          if (nc.top - 1 <= tc.yc && tc.yc <= nc.bottom + 1) {
            const digits = nc.text.match(/\d+/g) || [];
            if (digits.length === 1 && +digits[0] >= 1 && +digits[0] <= 8) num = +digits[0];
            break;
          }
        }
        if (start in START_TO_PAIR) {
          const byTime = START_TO_PAIR[start];
          if (num === null || (num !== byTime && numCells.length < timeCells.length)) num = byTime;
        }
        if (num in BELLS) [start, end] = BELLS[num];
        slots.push({ id: slotId++, top: tc.top, bottom: tc.bottom, num, start, end, parsedStart });
      }

      // дни: номер пары уменьшился или сменилась подпись дня -> новый день.
      // Повтор того же номера под той же подписью — подстрока той же пары.
      // Строки без номера ('Разговоры о важном') прилипают к следующему дню.
      const named = dayCells.map((c) => [c, ...parseDayLabel(c.text)]).filter(([, wd]) => wd !== null);
      const labelOf = (s) => named.findIndex(([c]) => c.top - 1 <= (s.top + s.bottom) / 2 && (s.top + s.bottom) / 2 <= c.bottom + 1);
      const pageBlocks = [];
      let pending = [];
      let prev = 0, prevLab = -1;
      for (const s of slots) {
        if (s.num === null) { pending.push(s); continue; }
        const lab = labelOf(s);
        if (!pageBlocks.length || s.num < prev || (lab >= 0 && prevLab >= 0 && lab !== prevLab)) {
          pageBlocks.push({ slots: [], weekday: null, date: null });
        }
        pageBlocks[pageBlocks.length - 1].slots.push(...pending, s);
        pending = [];
        prev = s.num;
        prevLab = lab;
      }
      if (pending.length) {
        if (pageBlocks.length) pageBlocks[pageBlocks.length - 1].slots.push(...pending);
        else pageBlocks.push({ slots: pending, weekday: null, date: null });
      }

      for (const b of pageBlocks) {
        const top = Math.min(...b.slots.map((s) => s.top));
        const bottom = Math.max(...b.slots.map((s) => s.bottom));
        let best = null, bestOverlap = 0;
        for (const [c, wd, d] of named) {
          const overlap = Math.min(bottom, c.bottom) - Math.max(top, c.top);
          if (overlap > bestOverlap) { best = [wd, d]; bestOverlap = overlap; }
        }
        if (!best && special.day) {
          // у ячейки дня бывает не нарисована граница — тогда читаем подпись прямо из текста колонки
          const col = special.day;
          const label = items
            .filter((it) => col.x0 - 1 <= it.xc && it.xc <= col.x1 + 1 && top <= it.yc && it.yc <= bottom)
            .map((it) => it.str).join(' ');
          const [wd, d] = parseDayLabel(label);
          if (wd !== null) best = [wd, d];
        }
        if (best) {
          [b.weekday, b.date] = best;
          b.named = true;
          b.labelDate = best[1];
        }
      }

      const checked = [...pageBlocks];
      // день, начавшийся на прошлой странице
      if (pageBlocks.length && pageBlocks[0].weekday === null && blocks.length) {
        const [prevBlock, prevLessons] = blocks[blocks.length - 1];
        const first = pageBlocks.shift();
        for (const [g, its] of Object.entries(collect(first, body, columns, special))) (prevLessons[g] ||= []).push(...its);
        for (const s of first.slots) s.block = prevBlock;
      }
      for (const b of pageBlocks) {
        for (const s of b.slots) s.block = b;
        blocks.push([b, collect(b, body, columns, special)]);
      }
      pages.push({ items, body, columns, special, blocks: checked, dayCells, cells });
    }
  } finally {
    await task.destroy();
  }

  // даты для дней, где в PDF дата не написана
  let monday = null;
  for (const [b] of blocks) {
    if (b.date && b.weekday !== null) { monday = addDays(b.date, -b.weekday); break; }
  }
  if (!monday && fallbackWeekDate) monday = addDays(fallbackWeekDate, -weekday(fallbackWeekDate));
  blocks.forEach(([b], i) => {
    if (b.weekday === null) b.weekday = Math.min(i, 6);
    if (!b.date && monday) b.date = addDays(monday, b.weekday);
  });

  const dates = [...new Set(blocks.filter(([b]) => b.date).map(([b]) => b.date))].sort();
  const groups = {};
  for (const [norm, col] of Object.entries(columns || {})) {
    groups[norm] = { name: col.text, days: Object.fromEntries(dates.map((d) => [d, []])) };
  }
  for (const [b, perGroup] of blocks) {
    if (!b.date) continue;
    for (const [norm, its] of Object.entries(perGroup)) {
      if (!groups[norm]) continue;
      (groups[norm].days[b.date] ||= []).push(...mergeLessons(its));
    }
  }
  for (const g of Object.values(groups)) {
    for (const ls of Object.values(g.days)) ls.sort((a, b) => (a.pairs[0] || 0) - (b.pairs[0] || 0));
  }
  const warnings = selfCheck({ pages, blocks, groups });
  if (!Object.keys(groups).length) warnings.push({ group: null, date: null, msg: 'В PDF не нашлось ни одной группы' });
  if (!dates.length) warnings.push({ group: null, date: null, msg: 'В PDF не нашлось ни одного дня' });
  const result = { dates, groups, warnings };
  if (parsePdf.debug) Object.defineProperty(result, 'debug', { value: { pages, blocks }, enumerable: false });
  return result;
}

// ---------------------------------------------------------------- страница сайта

export function unescapeHtml(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', ndash: '–', mdash: '—' };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1));
    return named[e.toLowerCase()] ?? m;
  });
}

export function findSources(html) {
  const sources = [];
  const re = /<a[^>]+href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const [, href, inner] = m;
    let title = clean(unescapeHtml(inner.replace(/<[^>]+>/g, ' ')));
    title = title.replace('Открыть', '').trim();
    let name = href.split('/').pop();
    try { name = decodeURIComponent(name); } catch { /* как есть */ }
    if (!(title + name).toLowerCase().includes('расписан')) continue;
    const dm = /на\s+(\d{2})\.(\d{2})\.(\d{2,4})/.exec(title) || /на\s+(\d{2})\.(\d{2})\.(\d{2,4})/.exec(name);
    let date = null;
    if (dm) {
      const [d, mth, y] = dm.slice(1).map(Number);
      date = validDate(y < 100 ? y + 2000 : y, mth, d);
    }
    sources.push({ title: title || name, url: new URL(href, SITE).href, date });
  }
  let week = '';
  const wm = /<h3[^>]*>([\s\S]*?)<\/h3>/.exec(html);
  if (wm) {
    week = unescapeHtml(wm[1].replace(/<br\s*\/?>/g, ' · ').replace(/<[^>]+>/g, ''));
    week = stripChars(week.replace(/\s+/g, ' '), ' ·');
  }
  return { sources, week };
}

/**
 * Версия разбора. Меняется при любом исправлении разбора PDF: старые результаты из кэша
 * (разобранные прошлой версией приложения) тогда выбрасываются и всё разбирается заново.
 */
export const PARSER_VERSION = 6;

/**
 * Скачивает страницу и PDF, собирает расписание всех групп.
 * cache: {url: разобранный PDF} — PDF с тем же адресом повторно не качаем (если разобран этой же версией).
 * fresh в ответе — сколько PDF разобрано заново (значит, кэш надо сохранить).
 */
export async function buildSchedule({ pdfjs, fetchText, fetchBytes, prev = null, cache = {}, today }) {
  const { sources, week } = findSources(await fetchText(PAGE));
  if (!sources.length) throw new Error('На странице не найдено ни одного PDF с расписанием');

  const errors = [];
  const groups = {};
  const newCache = {};
  let fresh = 0;
  const order = sources.map((s, i) => [i, s]).sort((a, b) => (a[1].date || '0000').localeCompare(b[1].date || '0000'));
  for (const [idx, src] of order) {
    let parsed = cache[src.url];
    if (parsed && parsed.v !== PARSER_VERSION) parsed = null;
    if (!parsed) {
      try {
        // pdfjs можно передать функцией — тогда библиотека грузится, только если есть что разбирать
        const lib = typeof pdfjs === 'function' ? await pdfjs() : pdfjs;
        parsed = { ...(await parsePdf(lib, await fetchBytes(src.url), src.date || today)), v: PARSER_VERSION };
        fresh++;
      } catch (e) {
        errors.push(`${src.title}: ${e && e.message ? e.message : e}`);
        continue;
      }
    }
    newCache[src.url] = parsed;
    const srcWarnings = [...parsed.warnings];
    if (src.date && parsed.dates.length && !parsed.dates.includes(src.date) && weekday(src.date) !== 6) {
      srcWarnings.push({ group: null, date: null, msg: `Файл подписан "на ${src.date}", но этого дня в нём нет` });
    }
    for (const [norm, g] of Object.entries(parsed.groups)) {
      const cur = (groups[norm] ||= { name: g.name, source: idx, days: {} });
      Object.assign(cur.days, g.days);
      cur.source = idx;
      cur.warnings = srcWarnings.filter((w) => !w.group || w.group === norm).map(({ date, msg }) => ({ date, msg }));
    }
  }
  if (!Object.keys(newCache).length) {
    // не разобрался ни один PDF — это сбой, а не «пустое расписание»: старые данные не трогаем
    throw new Error(`Не удалось разобрать ни один PDF: ${errors[0] || 'нет файлов'}`);
  }
  if (errors.length && prev) {
    // не теряем группы из PDF, который сейчас не скачался
    for (const [norm, g] of Object.entries(prev.groups || {})) if (!groups[norm]) groups[norm] = g;
  }
  if (prev && today) {
    // когда выкладывают PDF на следующую неделю, прошедшие дни (и сегодняшний) остаются
    // видны из прошлой версии; будущие дни берутся только из свежего PDF
    for (const [norm, g] of Object.entries(prev.groups || {})) {
      if (!groups[norm]) continue;
      for (const [day, ls] of Object.entries(g.days || {})) {
        if (day <= today && day >= addDays(today, -7) && !(day in groups[norm].days)) groups[norm].days[day] = ls;
      }
      groups[norm].days = Object.fromEntries(Object.entries(groups[norm].days).sort(([a], [b]) => (a < b ? -1 : 1)));
    }
  }
  const sortedGroups = Object.fromEntries(Object.entries(groups).sort((a, b) => (a[1].name < b[1].name ? -1 : a[1].name > b[1].name ? 1 : 0)));
  return {
    data: { week, sources: sources.map(({ title, url }) => ({ title, url })), groups: sortedGroups },
    cache: newCache,
    fresh,
    errors,
  };
}

// ---------------------------------------------------------------- тексты уведомлений

function plural(n, one, few, many) {
  if (n % 10 === 1 && n % 100 !== 11) return one;
  if (n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14)) return few;
  return many;
}

const KIND_SHORT = [[/лекц/, 'лекция'], [/лаб/, 'лаба'], [/практ/, 'практика'], [/семин/, 'семинар'], [/курсов/, 'курсовая'], [/консульт/, 'консультация']];
function shortKind(kind) {
  const low = (kind || '').toLowerCase();
  for (const [re, short] of KIND_SHORT) if (re.test(low)) return short;
  return (kind || '').trim();
}

/** Номер пары для текста: «2», «1-2». */
function pairLabel(l) {
  const p = l.pairs;
  if (!p.length) return l.start || '·';
  return p.length === 1 ? `${p[0]}` : `${p[0]}-${p[p.length - 1]}`;
}

// Ключ пары в снимках уже присланных уведомлений (state.json). Формат не меняем: иначе после
// обновления приложения все прошлые снимки «не совпали» бы и пришли ложные «Изменения».
function pairKey(l) {
  const p = l.pairs;
  if (!p.length) return l.start || '·';
  return p.length === 1 ? `${p[0]}` : `${p[0]}\u2013${p[p.length - 1]}`;
}

// ---------------------------------------------------------------- к какой паре приходить

const ORD_DAT = ['', 'первой', 'второй', 'третьей', 'четвёртой', 'пятой', 'шестой', 'седьмой', 'восьмой'];
const ORD_GEN = ['', '', 'двух', 'трёх', 'четырёх', 'пяти', 'шести', 'семи'];

/** «к первой паре», «ко второй паре», «к третьей паре»… */
export function toPair(n) {
  return `${n === 2 ? 'ко' : 'к'} ${ORD_DAT[n] || n} паре`;
}

/**
 * С какой пары начинается день и где в нём пустые места.
 *   first/start  — первая настоящая (не отменённая) пара и её начало;
 *   end, count   — конец последней пары и сколько всего пар;
 *   late         — первой пары нет, приходить позже;
 *   slots        — пустые пары: перед первой (kind 'before') и окна между парами ('gap'),
 *                  соседние склеены: {kind, pairs: [1, 2], start, end, at — перед каким уроком}.
 * Отменённая пара пустым местом не считается: у неё своя карточка «отменено».
 */
export function dayPlan(lessons) {
  const ls = lessons || [];
  const act = ls.filter((l) => !l.cancelled && l.pairs.length && l.start);
  if (!act.length) return null;
  const pairs = act.flatMap((l) => l.pairs);
  const first = Math.min(...pairs);
  const last = Math.max(...pairs);
  const busy = new Set(ls.flatMap((l) => l.pairs));
  const ends = act.map((l) => l.end).filter(Boolean).sort();
  const slots = [];
  for (let p = 1; p < last; p++) {
    if (busy.has(p)) continue;
    const kind = p < first ? 'before' : 'gap';
    const prev = slots[slots.length - 1];
    if (prev && prev.kind === kind && prev.pairs[prev.pairs.length - 1] === p - 1) prev.pairs.push(p);
    else slots.push({ kind, pairs: [p] });
  }
  for (const s of slots) {
    const to = s.pairs[s.pairs.length - 1];
    s.start = BELLS[s.pairs[0]] ? BELLS[s.pairs[0]][0] : null;
    s.end = BELLS[to] ? BELLS[to][1] : null;
    s.at = ls.findIndex((l) => l.pairs.length && l.pairs[0] > to);
  }
  return {
    first,
    start: act.find((l) => l.pairs.includes(first)).start,
    end: ends[ends.length - 1] || null,
    count: new Set(pairs).size,
    late: first > 1,
    cancelledBefore: ls.some((l) => l.cancelled && l.pairs.length && l.pairs[0] < first),
    slots,
  };
}

/** Почему не к первой: «первой пары нет», «первых двух пар нет», «первую пару отменили». */
export function lateNote(plan) {
  if (!plan || !plan.late) return '';
  const k = plan.first - 1;
  if (k === 1) return plan.cancelledBefore ? 'первую пару отменили' : 'первой пары нет';
  return `первых ${ORD_GEN[k] || k} пар нет`;
}

const slotLabel = (s) => (s.pairs.length > 1 ? `${s.pairs[0]}-${s.pairs[s.pairs.length - 1]}` : `${s.pairs[0]}`);
const slotLine = (s) => `${slotLabel(s)}. ${s.kind === 'gap' ? 'Окно' : s.pairs.length > 1 ? 'Пар нет' : 'Пары нет'}`;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function lessonLine(l) {
  const parts = [l.subject];
  const kind = shortKind(l.kind);
  if (kind) parts[0] += ` (${kind})`;
  if (l.room) parts.push(l.room);
  const prefix = l.cancelled ? '❌ ' : '';
  if (!l.pairs.length) return `${prefix}${pairLabel(l)} ${parts.join(' · ')}`;
  const time = l.start ? `${l.start} ` : '';
  return `${prefix}${pairLabel(l)}. ${time}${parts.join(' · ')}`;
}

function dayName(day, today) {
  const rel = { 0: 'Сегодня', 1: 'Завтра' }[daysBetween(today, day)];
  const base = `${WD_SHORT[weekday(day)]} ${+day.slice(8, 10)} ${MONTHS[+day.slice(5, 7) - 1]}`;
  return rel ? `${rel}, ${base}` : base[0].toUpperCase() + base.slice(1);
}

function daySnapshot(data, group, day) {
  const g = data.groups[group];
  if (!g || !(day in g.days)) return null;
  return g.days[day].map((l) => [pairKey(l), l.text]);
}

export function dayMessage(data, group, day, today) {
  const name = dayName(day, today);
  const g = data.groups[group];
  const lessons = g ? g.days[day] : undefined;
  if (lessons === undefined) {
    return { title: `${name}: расписание ещё не выложили`, body: 'Пришлю, как только оно появится на сайте.' };
  }
  const active = lessons.filter((l) => !l.cancelled && l.pairs.length);
  if (!active.length) {
    if (lessons.length) return { title: `${name}: занятия отменены`, body: lessons.map(lessonLine).join('\n') };
    return { title: `${name}: пар нет 🎉`, body: 'Можно отдыхать.' };
  }
  const plan = dayPlan(lessons);
  if (!plan) return { title: `${name}: ${active.length} ${plural(active.length, 'занятие', 'занятия', 'занятий')}`, body: lessons.map(lessonLine).join('\n') };
  // главное — в заголовке: к какой паре приходить. Пустые пары в списке — прочерком.
  const summary = [cap(lateNote(plan)), `${plan.count} ${plural(plan.count, 'пара', 'пары', 'пар')}${plan.end ? `, до ${plan.end}` : ''}`]
    .filter(Boolean).join(' · ');
  const lines = [];
  lessons.forEach((l, i) => {
    for (const s of plan.slots) if (s.at === i) lines.push(slotLine(s));
    lines.push(lessonLine(l));
  });
  return {
    title: `${name}: ${toPair(plan.first)} (${plan.start})`,
    body: [summary, ...lines].join('\n'),
  };
}

/** Первая пара по снимку уже присланного расписания ([номер, текст]). */
function snapshotFirst(snap) {
  // только номера пар («2», «1–2»); у записей без пары в снимке время «13:00» — их не считаем
  const nums = (snap || []).filter(([k, t]) => /^\d+([–-]\d+)?$/.test(k) && !String(t).toLowerCase().includes('отмен')).map(([k]) => parseInt(k, 10));
  return nums.length ? Math.min(...nums) : null;
}

function changeMessage(data, group, day, today, old) {
  const name = dayName(day, today);
  if (old === null) {
    const msg = dayMessage(data, group, day, today);
    return { ...msg, title: '📅 Выложили расписание. ' + msg.title };
  }
  const neu = data.groups[group].days[day];
  const newBy = new Map(neu.map((l) => [pairKey(l), l]));
  const oldBy = new Map(old.map(([k, t]) => [k, t]));
  const keys = [...new Set([...newBy.keys(), ...oldBy.keys()])].sort((a, b) => {
    const da = /^\d/.test(a) ? 0 : 1, db = /^\d/.test(b) ? 0 : 1;
    return da - db || (a < b ? -1 : a > b ? 1 : 0);
  });
  const lines = [];
  // поменялось, к какой паре приходить, — это первая строка, её нельзя пропустить
  const plan = dayPlan(neu);
  const was = snapshotFirst(old);
  let title = `⚠️ Изменения: ${name}`;
  if (plan && was !== null && plan.first !== was) {
    title = `⚠️ ${name}: теперь ${toPair(plan.first)} (${plan.start})`;
    lines.push(`👉 Теперь ${toPair(plan.first)}, в ${plan.start}${plan.late ? `. ${cap(lateNote(plan))}` : ''}`);
  } else if (!plan && was !== null) {
    lines.push('👉 Пар не будет');
  }
  for (const k of keys) {
    const l = newBy.get(k);
    if (!l) lines.push(`➖ ${k}: убрали (${oldBy.get(k).slice(0, 40)})`);
    else if (!oldBy.has(k)) lines.push(`➕ ${lessonLine(l)}`);
    else if (oldBy.get(k) !== l.text) lines.push(`🔄 ${lessonLine(l)}`);
  }
  return { title, body: lines.join('\n') || 'Расписание обновили.' };
}

/**
 * Решает, какие уведомления показать сейчас.
 *   * утром (morning_time..morning_until) — пары на сегодня;
 *   * вечером (после evening_time)        — пары на завтра;
 *   * в любой момент                      — если уже присланное расписание поменялось.
 */
export function decide({ data, state, cfg, now, test = false }) {
  state = JSON.parse(JSON.stringify(state || {}));
  const notified = (state.notified ||= {});
  const group = normGroup(cfg.group);
  const { iso: today, min } = now || nowTz(cfg.timezone);
  const tomorrow = addDays(today, 1);
  const messages = [];
  if (!data || !data.groups[group]) return { messages, state, error: `Группа ${cfg.group} не найдена в расписании` };

  const tagged = (msg, day, kind) => ({ ...msg, tag: `day-${day}`, day, kind });
  if (test) {
    const m = dayMessage(data, group, tomorrow, today);
    messages.push(tagged({ ...m, title: '🔔 Тест: ' + m.title }, tomorrow, 'test'));
  }

  const sent = new Set();
  const evening = toMin(cfg.evening_time || '20:00');
  const morning = toMin(cfg.morning_time || '07:00');
  const morningUntil = toMin(cfg.morning_until || '12:00');
  if (min >= morning && min < morningUntil && state.last_morning !== today) {
    state.last_morning = today;
    if (weekday(today) !== 6) {
      messages.push(tagged(dayMessage(data, group, today, today), today, 'daily'));
      notified[today] = daySnapshot(data, group, today);
      sent.add(today);
    }
  }
  if (min >= evening && state.last_evening !== today) {
    state.last_evening = today;
    if (weekday(tomorrow) !== 6) {
      messages.push(tagged(dayMessage(data, group, tomorrow, today), tomorrow, 'daily'));
      notified[tomorrow] = daySnapshot(data, group, tomorrow);
      sent.add(tomorrow);
    }
  }

  // изменения в уже присланном расписании (сегодня — пока пары не закончились)
  for (const day of [today, tomorrow]) {
    if (sent.has(day) || !(day in notified)) continue;
    if (day === today && min >= toMin('19:50')) continue;
    const snap = daySnapshot(data, group, day);
    if (snap !== null && JSON.stringify(snap) !== JSON.stringify(notified[day])) {
      messages.push(tagged(changeMessage(data, group, day, today, notified[day]), day, 'change'));
      notified[day] = snap;
    }
  }

  const cutoff = addDays(today, -2);
  for (const iso of Object.keys(notified)) if (iso < cutoff) delete notified[iso];
  return { messages, state };
}
