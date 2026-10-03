// Тесты движка расписания. Запускаются перед каждой сборкой APK:
// если хоть один не прошёл — APK не собирается.
//
//   cd tests && npm install && node run.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.join(HERE, '..', 'android', 'app', 'src', 'main', 'assets', 'engine.js');
const FIX = path.join(HERE, 'fixtures');
const engine = await import('file://' + ENGINE.replace(/\\/g, '/'));
const { parsePdf, decide, normGroup } = engine;

let failed = 0;
const ok = (cond, name, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
};
const files = fs.readdirSync(FIX).filter((f) => f.endsWith('.pdf')).sort();
const read = (f) => new Uint8Array(fs.readFileSync(path.join(FIX, f)));

// ---------------------------------------------------------------- 1. все PDF разбираются без замечаний
console.log('1. Разбор всех PDF и самопроверки');
const expected = { '1-1-kurs-BO.pdf': 16, '2-2-kurs-BO.pdf': 15, '2-2-kurs-BO-0310.pdf': 15, '3-1-kurs-SPO.pdf': 5, '4-2-kurs-SPO.pdf': 4, '5-3-kurs-SPO-9.pdf': 16, '6-3-kurs-SPO-11.pdf': 4, '7-4-kurs-SPO.pdf': 16 };
const parsed = {};
for (const f of files) {
  const res = await parsePdf(pdfjs, read(f), '2026-09-30');
  parsed[f] = res;
  const nGroups = Object.keys(res.groups).length;
  ok(res.warnings.length === 0, `${f}: самопроверки`, res.warnings.map((w) => w.msg).slice(0, 3).join('; '));
  ok(nGroups === expected[f], `${f}: групп ${nGroups}`, `ожидалось ${expected[f]}`);
  ok(res.dates.join() === '2026-09-28,2026-09-29,2026-09-30,2026-10-01,2026-10-02,2026-10-03', `${f}: дни пн–сб`, res.dates.join());
  for (const [norm, g] of Object.entries(res.groups)) {
    for (const [d, ls] of Object.entries(g.days)) {
      for (const l of ls) {
        if (l.pairs.length) {
          const bad = l.pairs.some((p) => !(p in engine.BELLS)) || l.start !== engine.BELLS[l.pairs[0]][0];
          if (bad) ok(false, `${f}: ${norm} ${d} время пары`, JSON.stringify(l));
        }
      }
    }
  }
}

// ---------------------------------------------------------------- 2. эталон: группа 2507сб1, проверено вручную по PDF
console.log('2. Эталонное расписание 2507сб1 (сверено с PDF глазами)');
const golden = JSON.parse(fs.readFileSync(path.join(HERE, 'golden-2507sb1.json'), 'utf8'));
const g1 = parsed['4-2-kurs-SPO.pdf'].groups['2507сб1'];
for (const [d, want] of Object.entries(golden)) {
  const got = (g1.days[d] || []).map((l) => [l.pairs.join(','), l.start, l.subject, l.kind, l.teacher, l.room, l.cancelled]);
  ok(JSON.stringify(got) === JSON.stringify(want), `2507сб1 ${d}`, JSON.stringify(got) === JSON.stringify(want) ? '' : `получено ${JSON.stringify(got)}`);
}

// ---------------------------------------------------------------- 2б. трудные места реальных PDF (сверено глазами)
console.log('2б. Трудные места PDF');
{
  const pick = (f, g, d) => (parsed[f].groups[g].days[d] || []);
  const at = (ls, n) => ls.filter((l) => l.pairs.includes(n));
  // нет вертикальной границы между 2407г2 и 2407е1–е2: у каждой группы — свой текст
  const g2 = pick('5-3-kurs-SPO-9.pdf', '2407г2', '2026-10-01');
  ok(at(g2, 3).length === 1 && at(g2, 3)[0].subject === 'Обеспечение качества функционирования компьютерных систем' && at(g2, 3)[0].teacher === 'Козулин И.А.',
    'нет границы в PDF: 2407г2 3 пара — только своя лекция', JSON.stringify(at(g2, 3).map((l) => l.text)));
  for (const g of ['2407е1', '2407е2']) {
    const e = at(pick('5-3-kurs-SPO-9.pdf', g, '2026-10-01'), 3);
    ok(e.length === 1 && e[0].text === 'Физическая культура (практическое заняти) Пивоваров А.А.', `нет границы в PDF: ${g} 3 пара — только физкультура`, JSON.stringify(e.map((l) => l.text)));
  }
  // текст не влез в ячейку и вылез на строку следующей пары
  ok(at(g2, 4).length === 1 && at(g2, 4)[0].teacher === 'Красильникова Е.А.' && at(g2, 4)[0].room === '402' && !at(g2, 5).length,
    'вылезший текст: преподаватель 4 пары на месте, лишней 5 пары нет', JSON.stringify(g2.map((l) => `${l.pairs}:${l.text}`)));
  const a2 = pick('5-3-kurs-SPO-9.pdf', '2408а2', '2026-10-02');
  ok(at(a2, 4).length === 1 && at(a2, 4)[0].teacher === 'Ленский Д.Л.' && !at(a2, 5).length,
    'вылезший (и скрытый в PDF) текст: «Ленский Д.Л.» — преподаватель 4 пары', JSON.stringify(a2.map((l) => `${l.pairs}:${l.text}`)));
  // раскладка текста ячейки на поля: ничего не теряется
  const S = (t) => { const r = engine.splitLesson(t); return `${r.subject} | ${r.kind} | ${r.teacher} | ${r.room}`; };
  for (const [text, want] of [
    ['Математика (Практические занятия) Медвяцкая А.М. 235', 'Математика | Практические занятия | Медвяцкая А.М. | 235'],
    ['Учебная практика (рассредоточенная) ПМ.11 Разработка, администрирование и защита баз данных (Лабораторные работы) Плотников В.А. 201',
      'Учебная практика — ПМ.11 Разработка, администрирование и защита баз данных | рассредоточенная, Лабораторные работы | Плотников В.А. | 201'],
    ['Лекция ИНФОРМАТИКА Читальный зал-А Белякова М.А.', 'Информатика | Лекция | Белякова М.А. | Читальный зал-А'],
    ['ФИЗИЧЕСКАЯ КУЛЬТУРА Чугурова Л.Д.', 'Физическая культура |  | Чугурова Л.Д. | '],
    ['Разработка программных модулей (Лабораторные работы) Муратова О.В. 310, 302', 'Разработка программных модулей | Лабораторные работы | Муратова О.В. | 310, 302'],
    ['Тестирование ауд. 314, 310 психолог Семенова Н.Е. Явка обязательна!', 'Тестирование психолог Явка обязательна! |  | Семенова Н.Е. | 314, 310'],
    ['отмена Русский язык (Практические занятия). Клюшова Е.В. 233', 'Русский язык | Практические занятия | Клюшова Е.В. | 233'],
    ['Разработка прикладных приложений ( (Лекция) Рогулин В. 102', 'Разработка прикладных приложений | Лекция | Рогулин В. | 102'],
  ]) ok(S(text) === want, `поля: «${text.slice(0, 50)}…»`, S(text));
  // случайный «\» в пустой ячейке — не пара
  const b2 = pick('2-2-kurs-BO-0310.pdf', '2507б2', '2026-10-03');
  ok(!at(b2, 1).length && b2.every((l) => /[а-яё]{3}/i.test(l.text)), 'случайный символ в пустой ячейке — не пара', JSON.stringify(b2.map((l) => `${l.pairs}:${l.text}`)));
}

// ---------------------------------------------------------------- 2в. фоновая проверка: кэш и ленивый pdf.js
console.log('2в. Кэш разбора');
{
  const bytes = read('2-2-kurs-BO-0310.pdf');
  const html = '<h3>Неделя</h3><a href="/upload/a/Расписание 2 курса БО на 03.10.26.pdf">Открыть</a>';
  let loads = 0, downloads = 0;
  const lazy = async () => { loads++; return pdfjs; };
  const args = { fetchText: async () => html, fetchBytes: async () => { downloads++; return new Uint8Array(bytes); }, today: '2026-10-03' };
  const first = await engine.buildSchedule({ ...args, pdfjs: lazy, cache: {} });
  ok(loads === 1 && first.fresh === 1 && !!first.data.groups['2507б2'], 'новый PDF: pdf.js загружен, файл разобран');
  const second = await engine.buildSchedule({ ...args, pdfjs: lazy, cache: JSON.parse(JSON.stringify(first.cache)) });
  ok(loads === 1 && second.fresh === 0 && downloads === 1, 'тот же PDF: без pdf.js и без скачивания', `загрузок pdf.js ${loads}, скачиваний ${downloads}`);
  ok(JSON.stringify(second.data) === JSON.stringify(first.data), 'из кэша — то же самое расписание');
  const stale = Object.fromEntries(Object.entries(first.cache).map(([k, v]) => [k, { ...v, v: engine.PARSER_VERSION - 1 }]));
  const third = await engine.buildSchedule({ ...args, pdfjs: lazy, cache: stale });
  ok(third.fresh === 1, 'кэш от прошлой версии разбора выбрасывается — PDF разбирается заново');
}

// ---------------------------------------------------------------- 3. ввод группы в любом написании
console.log('3. Ввод группы');
for (const [input, want] of [['2507сб1', '2507сб1'], ['2507 СБ1', '2507сб1'], ['2507sb1', '2507сб1'], ['B2507ca1', '2507са1'], ['в2507СА1', '2507са1'], ['2507sb2', '2507сб2'], ['2401а 2', '2401а2'], ['b2307v1', '2307в1']]) {
  ok(normGroup(input) === want, `«${input}» → ${want}`, normGroup(input));
}

// ---------------------------------------------------------------- 4. уведомления
console.log('4. Логика уведомлений');
const data = { groups: { '2507сб1': structuredClone(g1) } };
const cfg = { group: '2507сб1', evening_time: '20:00', morning_time: '07:00', timezone: 'Asia/Novosibirsk' };
let state = { notified: {} };
const at = (iso, hhmm) => ({ iso, min: +hhmm.slice(0, 2) * 60 + +hhmm.slice(3) });
const step = (iso, hhmm) => { const r = decide({ data, state, cfg, now: at(iso, hhmm) }); state = r.state; return r.messages; };
let m = step('2026-09-30', '14:00');
ok(m.length === 0, 'днём ничего не приходит');
m = step('2026-09-30', '20:07');
ok(m.length === 1 && m[0].title === 'Завтра, чт 1 октября: к первой паре (09:00)', 'в 20:00 — пары на завтра', m[0] && m[0].title);
ok(m[0] && m[0].body.split('\n')[0] === '4 пары, до 16:20' && m[0].body.split('\n').length === 5 && m[0].body.includes('Основы алгоритмизации'), 'в тексте сводка и все 4 пары', m[0] && m[0].body);
ok(step('2026-09-30', '20:22').length === 0, 'повторно не присылает');
data.groups['2507сб1'].days['2026-10-01'][1].text = 'отмена ' + data.groups['2507сб1'].days['2026-10-01'][1].text;
data.groups['2507сб1'].days['2026-10-01'][1].cancelled = true;
m = step('2026-09-30', '21:37');
ok(m.length === 1 && m[0].kind === 'change' && m[0].body.includes('❌ 2.'), 'изменение приходит сразу', m[0] && m[0].body);
ok(step('2026-09-30', '21:52').length === 0, 'об изменении — один раз');
m = step('2026-10-01', '07:07');
ok(m.length === 1 && m[0].title === 'Сегодня, чт 1 октября: к первой паре (09:00)' && m[0].body.startsWith('3 пары, до 16:20\n'), 'в 07:00 — пары на сегодня (с учётом отмены)', m[0] && m[0].title + ' / ' + m[0].body.split('\n')[0]);
ok(step('2026-10-03', '20:07').length === 0, 'в субботу вечером (завтра вс) — тишина');
m = step('2026-10-04', '20:07');
ok(m.length === 1 && m[0].title.includes('ещё не выложили'), 'в вс вечером: понедельник ещё не выложили', m[0] && m[0].title);
data.groups['2507сб1'].days['2026-10-05'] = [{ pairs: [1], start: '09:00', end: '10:35', text: 'Математика (Лекции) 101', cancelled: false, subject: 'Математика', kind: 'Лекции', teacher: '', room: '101' }];
m = step('2026-10-04', '21:07');
ok(m.length === 1 && m[0].title.startsWith('📅 Выложили расписание'), 'как только выложили — сразу приходит', m[0] && m[0].title);
const none = decide({ data, state, cfg: { ...cfg, group: '' }, now: at('2026-10-05', '20:07') });
ok(none.messages.length === 0 && none.error, 'без выбранной группы уведомлений нет');

// ---------------------------------------------------------------- 4а. «ко второй паре»: не к первой — видно сразу
console.log('4а. К какой паре приходить');
const { dayPlan, lateNote, toPair } = engine;
ok(toPair(1) === 'к первой паре' && toPair(2) === 'ко второй паре' && toPair(4) === 'к четвёртой паре', 'склонение: к первой / ко второй / к четвёртой', `${toPair(1)}, ${toPair(2)}, ${toPair(4)}`);
{
  // в эталонном PDF у 2507сб1 понедельник 28.09 — со второй пары, среда 30.09 — с третьей
  const mon = decide({ data: { groups: { '2507сб1': structuredClone(g1) } }, state: {}, cfg, now: at('2026-09-27', '20:07') }).messages[0];
  ok(mon && mon.title === 'Завтра, пн 28 сентября: ко второй паре (10:45)', 'уведомление: «ко второй паре» в заголовке', mon && mon.title);
  let lines = mon ? mon.body.split('\n') : [];
  ok(lines[0] === 'Первой пары нет · 3 пары, до 16:20' && lines[1] === '1. — пары нет' && lines[2].startsWith('2. 10:45'), 'уведомление: «первой пары нет» и прочерк на месте 1 пары', lines.slice(0, 3).join(' | '));
  const wed = decide({ data: { groups: { '2507сб1': structuredClone(g1) } }, state: {}, cfg, now: at('2026-09-29', '20:07') }).messages[0];
  ok(wed && wed.title === 'Завтра, ср 30 сентября: к третьей паре (13:00)', 'уведомление: «к третьей паре» в заголовке', wed && wed.title);
  lines = wed ? wed.body.split('\n') : [];
  ok(lines[0] === 'Первых двух пар нет · 2 пары, до 16:20' && lines[1] === '1–2. — пар нет' && lines[2].startsWith('3. 13:00'), 'уведомление: «первых двух пар нет» и одна строка-прочерк на 1–2 пары', lines.slice(0, 3).join(' | '));
}
const L = (pairs, extra = {}) => ({ pairs, start: engine.BELLS[pairs[0]][0], end: engine.BELLS[pairs[pairs.length - 1]][1], text: 'X', subject: 'X', kind: '', teacher: '', room: '', cancelled: false, ...extra });
{
  const p = dayPlan([L([3]), L([4])]);
  ok(p.first === 3 && p.start === '13:00' && p.late && JSON.stringify(p.slots.map((s) => [s.kind, s.pairs, s.at])) === '[["before",[1,2],0]]' && lateNote(p) === 'первых двух пар нет',
    'к 3 паре: пары 1–2 одной строкой «нет пар»', JSON.stringify(p));
  const q = dayPlan([L([1]), L([2]), L([4])]);
  ok(!q.late && JSON.stringify(q.slots.map((s) => [s.kind, s.pairs, s.at])) === '[["gap",[3],2]]', 'окно на месте 3 пары', JSON.stringify(q.slots));
  const c = dayPlan([L([1], { cancelled: true, text: 'ОТМЕНА' }), L([2])]);
  ok(c.first === 2 && c.slots.length === 0 && lateNote(c) === 'первую пару отменили', 'отменённая 1 пара: «ко второй», без прочерка (у отмены своя карточка)', JSON.stringify(c));
  ok(dayPlan([L([1], { cancelled: true })]) === null && dayPlan([]) === null, 'день без пар — без «к какой паре»');
}
{
  // изменение: первую пару убрали — в уведомлении об изменении это первой строкой
  const d2 = { groups: { '2507сб1': structuredClone(g1) } };
  let st = decide({ data: d2, state: {}, cfg, now: at('2026-10-02', '20:07') }).state;
  d2.groups['2507сб1'].days['2026-10-03'].shift();
  const r = decide({ data: d2, state: st, cfg, now: at('2026-10-02', '21:37') });
  const msg = r.messages[0];
  ok(msg && msg.kind === 'change' && msg.title === '⚠️ Завтра, сб 3 октября: теперь ко второй паре (10:45)' && msg.body.startsWith('👉 Теперь ко второй паре, в 10:45 — первой пары нет'),
    'убрали первую пару — «теперь ко второй паре» в заголовке изменения', msg && `${msg.title} / ${msg.body.split('\n')[0]}`);
}

// ---------------------------------------------------------------- 4б. старый WebView
console.log('4б. Старый WebView (Chrome 113) с нашими полифилами');
{
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [path.join(HERE, 'old-webview.mjs')], { encoding: 'utf8', cwd: HERE });
  let out = null;
  try { out = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { /* */ }
  ok(!!out && out.groups === 4 && out.warnings === 0 && out.lessons === 4, 'PDF разбирается без новых функций браузера', out ? JSON.stringify(out) : (r.stderr || r.stdout).slice(0, 300));
}

// ---------------------------------------------------------------- 5. самопроверки ловят поломки (мутации)
console.log('5. Самопроверки ловят намеренные поломки движка');
const code = fs.readFileSync(ENGINE, 'utf8');
const mutations = {
  'пары съезжают на соседнюю строку': ['for (const s of hit) (out[norm] ||= []).push([s, c]);', 'for (const s of hit) { const i = block.slots.indexOf(s); (out[norm] ||= []).push([block.slots[Math.min(i + 1, block.slots.length - 1)], c]); }'],
  'часть ячеек теряется': ["if (!meaningful(c.text)) continue;\n    if (service.some", "if (!meaningful(c.text) || c.text.length % 7 === 3) continue;\n    if (service.some"],
  'объединённая ячейка достаётся не всем группам': ['if (c.x0 - 1 <= col.xc && col.xc <= c.x1 + 1) {\n        for (const s of hit)', 'if (c.x0 - 1 <= col.xc && col.xc <= (c.x0 + c.x1) / 2 + 1) {\n        for (const s of hit)'],
  'текст попадает не в ту ячейку': ['out.push({ str: it.str, xc: cx, yc: H - cy,', 'out.push({ str: it.str, xc: cx + 25, yc: H - cy,'],
  'неверный день недели': ['if (wd < 0) continue;', 'if (wd < 0) continue; if (wd < 6) { const m2 = DATE_RE.exec(cand); return [wd + 1, m2 ? validDate(2000 + +m2[3], +m2[2], +m2[1]) : null]; }'],
  'линии таблицы находятся не все': ['edges = mergeEdges(edges, 3).filter((e) => edgeLen(e) >= 3);', 'edges = mergeEdges(edges, 3).filter((e) => edgeLen(e) >= 3).filter((e, i) => !(e.o === "v" && i % 5 === 2));'],
  'ячейка без границы между группами не делится': ['parts.set(c, clusters.map(', '((..._) => 0)(c, clusters.map('],
  'вылезший за ячейку текст остаётся в чужой паре': ['if (there < here && there < it.size * 2.5) at[k] = other;', 'if (false) at[k] = other;'],
  'случайный символ в пустой ячейке считается парой': ['  for (const c of body) {\n    if (!meaningful(c.text)) continue;', '  for (const c of body) {\n    if (!clean(c.text)) continue;'],
};
for (const [name, [from, to]] of Object.entries(mutations)) {
  if (!code.includes(from)) { ok(false, `мутация «${name}» не применилась — обнови тест`); continue; }
  const tmp = path.join(HERE, `.mut-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(tmp, code.replace(from, to));
  try {
    const mut = await import('file://' + tmp.replace(/\\/g, '/'));
    let warnings = 0;
    for (const f of files) warnings += (await mut.parsePdf(pdfjs, read(f), '2026-09-30')).warnings.length;
    ok(warnings > 0, `поймано: ${name}`, `${warnings} предупреждений`);
  } finally {
    fs.unlinkSync(tmp);
  }
}

console.log(failed ? `\nПРОВАЛЕНО: ${failed}` : '\nВСЕ ТЕСТЫ ПРОЙДЕНЫ');
process.exit(failed ? 1 : 0);
