// Вкладки «Новости» и «Сессия» и карточки на экране расписания — только разметка по данным
// из extras.js. Состояние и обработка нажатий — в app.js.
import { STICKERS, ICONS } from './stickers.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function dateRu(iso, today) {
  if (!iso) return '';
  const d = `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]}`;
  return today && iso.slice(0, 4) !== today.slice(0, 4) ? `${d} ${iso.slice(0, 4)}` : d;
}

const empty = (sticker, title, text) => `<div class="empty small">${STICKERS[sticker]}<h3>${title}</h3><p>${text}</p></div>`;
const openBtn = (url, label = 'Открыть') => `<button type="button" class="link press" data-act="open-url" data-url="${esc(url)}">${label} ${ICONS.arrow}</button>`;

export function courseLabel(course) {
  if (!course) return '';
  return `${course.nums.join(', ')} курс${course.prog ? ' ' + course.prog : ''}${course.after ? ` (после ${course.after} класса)` : ''}`;
}

// ---------------------------------------------------------------- новости

export function newsHtml(news, { unread, today, loaded }) {
  let html = '<div class="day-head"><h2>Новости колледжа</h2><span class="sum">с сайта ci.nsu.ru · пришлю уведомление о новых</span></div>';
  if (!news.length) {
    return html + (loaded
      ? empty('wait', 'Новостей пока нет', 'Как появятся на сайте колледжа, покажу здесь и пришлю уведомление.')
      : empty('load', 'Загружаю новости', 'Проверю сайт колледжа при следующей проверке расписания.'));
  }
  news.forEach((n, i) => {
    html += `<article class="lesson news${unread.has(n.url) ? ' unread' : ''}" style="--i:${Math.min(i, 8)}">
      <div class="news-body">
        <div class="news-meta">${n.kind === 'advert' ? '<span class="pill k-oth">Объявление</span>' : ''}<span>${esc(dateRu(n.date, today))}</span>${unread.has(n.url) ? '<span class="pill badge-next">новое</span>' : ''}</div>
        <p class="subj">${esc(n.title)}</p>
        ${n.text ? `<p class="news-text">${esc(n.text)}</p>` : ''}
        ${openBtn(n.url, 'Читать на сайте')}
      </div>
    </article>`;
  });
  return html;
}

/** Свежая непрочитанная новость (за 2 дня) — карточкой над расписанием. */
export function freshNewsCard(news, unread, today, yesterday) {
  const n = news.find((x) => unread.has(x.url) && x.date && x.date >= yesterday && x.date <= today);
  if (!n) return '';
  return `<button type="button" class="note-card press" data-tab="news">
    ${ICONS.news}<div><b>${esc(n.title)}</b><span>${esc((n.text || '').slice(0, 120))}</span></div></button>`;
}

// ---------------------------------------------------------------- сессия

const KIND_LABEL = { exam: 'Экзамены', retake: 'Пересдачи', order: 'Приказ', other: 'Документ' };

function debtsCard({ debts, subjects, editing, draft }) {
  if (editing) {
    const all = [...new Set([...subjects, ...debts])];
    return `<section class="card-flat debts">
      <h3>Какие предметы не сдал?</h3>
      <p>Отметь их. Как только колледж выложит расписание пересдач, пришлю уведомление и подскажу, есть ли там твои предметы.</p>
      <div class="chips">${[...new Set([...all, ...draft])].map((s) => `<button type="button" class="chip-toggle press${draft.has(s) ? ' on' : ''}" data-debt="${esc(s)}" aria-pressed="${draft.has(s)}">${esc(s)}</button>`).join('') || '<p class="hint">Предметы появятся, когда загрузится расписание.</p>'}</div>
      <form class="add-debt" data-form="debt-add" autocomplete="off">
        <input class="search" id="debtOther" maxlength="100" placeholder="Другой предмет (если его нет в списке)" enterkeyhint="done">
        <button type="submit" class="btn secondary press">Добавить</button>
      </form>
      <div class="row">
        <button type="button" class="btn press" data-act="debts-save">${draft.size ? `Следить (${draft.size})` : 'Всё сдал, долгов нет'}</button>
        <button type="button" class="btn secondary press" data-act="debts-cancel">Отмена</button>
      </div>
    </section>`;
  }
  if (debts.length) {
    return `<section class="card-flat debts">
      <h3>Слежу за пересдачами</h3>
      <p>${debts.map((d) => `<b>${esc(d)}</b>`).join(', ')}. Как только выложат расписание пересдач, пришлю уведомление.</p>
      <div class="row">
        <button type="button" class="btn secondary press" data-act="debts-edit">Изменить</button>
        <button type="button" class="btn secondary press" data-act="debts-none">Всё сдал 🎉</button>
      </div>
    </section>`;
  }
  return `<section class="card-flat debts">
    <h3>Остались несданные предметы?</h3>
    <p>Если после сессии есть долги, отметь их. Как только выложат расписание пересдач, пришлю уведомление и подскажу, есть ли там твои предметы.</p>
    <button type="button" class="btn secondary press wide" data-act="debts-edit">Отметить предметы</button>
  </section>`;
}

export function sessionHtml(mine, { debts, subjects, editing, draft, unseen, today, loaded, mats = { mine: [], showAll: false } }) {
  const label = courseLabel(mine.course);
  let html = `<div class="day-head"><h2>Сессия</h2><span class="sum">${esc(label || 'зачёты, экзамены и пересдачи')}</span></div>`;
  html += debtsCard({ debts, subjects, editing, draft });

  const files = mine.session.filter((f) => f.kind === 'exam' || f.kind === 'retake');
  html += '<h3 class="sec-title">Экзамены и пересдачи</h3>';
  if (!files.length) {
    html += `<p class="hint sec-empty">${loaded ? 'Для твоей группы пока ничего не выложили. Как появится расписание экзаменов или пересдач, пришлю уведомление.' : 'Загружу с сайта колледжа при следующей проверке.'}</p>`;
  }
  files.forEach((f, i) => {
    html += `<article class="lesson doc${unseen.has('s:' + f.url) ? ' unread' : ''}" style="--i:${i}">
      <div class="news-body">
        <div class="news-meta"><span class="pill ${f.kind === 'retake' ? 'badge-cancel' : 'k-lec'}">${KIND_LABEL[f.kind]}</span>${f.rel === 'course' ? '<span>на весь курс</span>' : ''}</div>
        <p class="subj">${esc(f.title)}</p>
        ${f.kind === 'retake' && debts.length ? `<p class="news-text">${f.hits.length ? `✅ Есть твои: ${esc(f.hits.join(', '))}. Дата и время в файле` : 'Твоих предметов в файле не нашлось, на всякий случай проверь сам'}</p>` : ''}
        ${openBtn(f.url, 'Открыть PDF')}
      </div>
    </article>`;
  });

  html += '<h3 class="sec-title">Вопросы к зачётам и экзаменам</h3>';
  if (!mine.questions.length) html += `<p class="hint sec-empty">${loaded ? 'Для твоей группы пока не выложили, обычно появляются перед сессией. Пришлю уведомление.' : 'Загружу с сайта колледжа при следующей проверке.'}</p>`;
  else {
    html += '<div class="card-flat list">' + mine.questions.map((q) => `<button type="button" class="list-row press${unseen.has('q:' + q.url) ? ' unread' : ''}" data-act="open-url" data-url="${esc(q.url)}">
      <span><b>${esc(q.subject)}</b>${q.kind ? `<small>${esc(q.kind)}</small>` : ''}</span>${ICONS.arrow}</button>`).join('') + '</div>';
  }

  const orders = mine.session.filter((f) => f.kind === 'order' || f.kind === 'other');
  if (orders.length) {
    html += '<h3 class="sec-title">Приказы и документы</h3><div class="card-flat list">' + orders.map((f) => `<button type="button" class="list-row press" data-act="open-url" data-url="${esc(f.url)}">
      <span>${esc(f.title)}</span>${ICONS.arrow}</button>`).join('') + '</div>';
  }

  html += materialsHtml(mats, mine.materials);
  return html;
}

const matRow = (m) => `<button type="button" class="list-row press" data-act="open-url" data-url="${esc(m.url)}">
  <span>${ICONS.book} <span><b>${esc(m.title.replace(/^учебн\S*\s+(методическ\S*\s+)?пособие\s*/i, ''))}</b>${m.subject ? `<small>${m.byTopic ? 'по теме предмета' : 'к предмету'}: ${esc(m.subject)}</small>` : ''}</span></span>${ICONS.arrow}</button>`;

/** Пособия колледжа: сначала только к предметам группы, все остальные по кнопке. */
function materialsHtml({ mine, showAll }, all) {
  if (!all.length) return '';
  let html = '<h3 class="sec-title">Пособия к твоим предметам</h3>';
  if (mine.length) html += `<div class="card-flat list">${mine.map(matRow).join('')}</div>`;
  else html += '<p class="hint sec-empty">К предметам твоей группы на этой неделе пособий на сайте нет.</p>';
  const rest = all.filter((m) => !mine.some((x) => x.url === m.url));
  if (!rest.length) return html;
  if (showAll) {
    html += `<h3 class="sec-title">Остальные пособия</h3><div class="card-flat list">${rest.map(matRow).join('')}</div>
      <button type="button" class="btn secondary press wide" data-act="mats-all">Скрыть остальные</button>`;
  } else {
    html += `<button type="button" class="btn secondary press wide" data-act="mats-all">Показать все пособия (${all.length})</button>`;
  }
  return html;
}

/** Вопрос после сессии на экране расписания: «остались долги?» — пока не ответили для этих пересдач. */
export function debtsPromptCard() {
  return `<div class="note-card ask">
    ${ICONS.cap}<div><b>Выложили расписание пересдач</b><span>Остались долги после сессии? Отметь предметы, и я напомню, когда будет пересдача.</span>
    <div class="row"><button type="button" class="btn press" data-act="debts-mark">Отметить</button><button type="button" class="btn secondary press" data-act="debts-none">Всё сдал 🎉</button></div></div>
  </div>`;
}
