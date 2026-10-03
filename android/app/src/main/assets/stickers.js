// Нарисованные стикеры (SVG) для пустых состояний и мелкие иконки.
// Цвета берутся из CSS-переменных, поэтому работают и в тёмной теме.

const wrap = (inner) => `<svg class="sticker" viewBox="0 0 170 130" aria-hidden="true">${inner}</svg>`;
const shadow = (rx = 48) => `<ellipse cx="85" cy="121" rx="${rx}" ry="6" class="s-line"/>`;

export const STICKERS = {
  // пар нет — довольная чашка кофе и конфетти
  free: wrap(`${shadow(46)}
    <circle class="s-sun pop" cx="28" cy="34" r="6"/>
    <rect class="s-peach pop d2" x="134" y="22" width="10" height="10" rx="2.5" transform="rotate(20 139 27)"/>
    <circle class="s-accent2 pop d3" cx="146" cy="72" r="4.5"/>
    <path class="s-now pop d2" d="M24 70l3.5 7 7.5 1-5.5 5 1.5 7.5-7-3.8-6.8 3.8 1.4-7.5-5.4-5 7.4-1z"/>
    <rect class="s-sun pop d3" x="118" y="96" width="7" height="7" rx="2" transform="rotate(35 121 99)"/>
    <path class="steam st-stroke" d="M68 46q-7-8 0-16"/>
    <path class="steam d2 st-stroke" d="M82 46q-7-8 0-16"/>
    <path class="steam d3 st-stroke" d="M96 46q-7-8 0-16"/>
    <g class="float">
      <path class="st-handle" d="M114 68h6a12 12 0 0 1 0 24h-9"/>
      <path class="s-accent" d="M50 60h66v26a28 28 0 0 1-28 28h-10a28 28 0 0 1-28-28z"/>
      <rect class="s-accent2" x="48" y="56" width="70" height="10" rx="5"/>
      <circle class="s-surface" cx="72" cy="82" r="3.6"/>
      <circle class="s-surface" cx="94" cy="82" r="3.6"/>
      <ellipse class="s-peach" cx="64" cy="91" rx="5" ry="3" opacity=".75"/>
      <ellipse class="s-peach" cx="102" cy="91" rx="5" ry="3" opacity=".75"/>
      <path class="st-face" d="M76 92q7 7 14 0"/>
    </g>`),

  // расписание ещё не выложили — часы с бегущей стрелкой
  wait: wrap(`${shadow(40)}
    <text x="122" y="40" class="s-accent2 float" font-size="20" font-weight="800">z</text>
    <text x="136" y="24" class="s-accent2 float d2" font-size="14" font-weight="800">z</text>
    <g class="float d3">
      <circle cx="80" cy="64" r="46" class="s-soft"/>
      <circle cx="80" cy="64" r="35" class="s-surface"/>
      <rect class="s-muted" x="78" y="33" width="4" height="8" rx="2"/>
      <rect class="s-muted" x="78" y="87" width="4" height="8" rx="2"/>
      <rect class="s-muted" x="49" y="62" width="8" height="4" rx="2"/>
      <rect class="s-muted" x="103" y="62" width="8" height="4" rx="2"/>
      <rect class="s-text" x="78" y="48" width="4.5" height="18" rx="2.2" transform="rotate(-50 80 64)"/>
      <g class="spin-hand"><rect class="s-accent" x="78.6" y="38" width="3" height="27" rx="1.5"/></g>
      <circle class="s-accent" cx="80" cy="64" r="5"/>
    </g>`),

  // загрузка — лупа бегает по PDF
  load: wrap(`${shadow(42)}
    <g class="float">
      <path class="s-card" d="M52 12h48l22 22v76a6 6 0 0 1-6 6H52a6 6 0 0 1-6-6V18a6 6 0 0 1 6-6z"/>
      <path class="s-soft" d="M100 12v16a6 6 0 0 0 6 6h16z"/>
      <rect class="s-danger" x="54" y="22" width="30" height="14" rx="4"/>
      <text x="58.5" y="33" class="s-surface" font-size="10.5" font-weight="800">PDF</text>
      <rect class="s-soft" x="56" y="46" width="56" height="7" rx="3.5"/>
      <rect class="s-soft" x="56" y="60" width="44" height="7" rx="3.5"/>
      <rect class="s-soft" x="56" y="74" width="52" height="7" rx="3.5"/>
      <rect class="s-soft" x="56" y="88" width="36" height="7" rx="3.5"/>
    </g>
    <g class="scan">
      <circle cx="94" cy="72" r="17" class="s-glass"/>
      <circle cx="94" cy="72" r="17" class="st-ring"/>
      <path class="st-ring" d="M106.5 84.5l14 14"/>
    </g>`),

  // нет связи — грустное облачко
  offline: wrap(`${shadow(46)}
    <g class="float">
      <path class="s-soft" d="M46 96a24 24 0 0 1 2-48 32 32 0 0 1 60-8 26 26 0 0 1 16 56z"/>
      <circle class="s-text" cx="72" cy="70" r="4"/>
      <circle class="s-text" cx="98" cy="70" r="4"/>
      <path class="st-sad" d="M75 86q10-8 20 0"/>
      <path class="s-accent2 steam" d="M60 104q3 6 0 9-3-3 0-9z"/>
      <path class="s-accent2 steam d2" d="M86 104q3 6 0 9-3-3 0-9z"/>
      <path class="s-accent2 steam d3" d="M112 104q3 6 0 9-3-3 0-9z"/>
    </g>
    <g class="wiggle">
      <circle cx="136" cy="30" r="14" class="s-danger"/>
      <rect class="s-surface" x="134" y="20" width="4" height="12" rx="2"/>
      <circle class="s-surface" cx="136" cy="37" r="2.4"/>
    </g>`),

  // все пары отменены — календарик с крестиком
  cancel: wrap(`${shadow(40)}
    <g class="float">
      <rect class="s-card" x="44" y="22" width="82" height="88" rx="12"/>
      <path class="s-danger" d="M44 34a12 12 0 0 1 12-12h58a12 12 0 0 1 12 12v12H44z"/>
      <rect class="s-text" x="62" y="12" width="7" height="20" rx="3.5"/>
      <rect class="s-text" x="101" y="12" width="7" height="20" rx="3.5"/>
      <g class="wiggle"><path class="st-cross" d="M70 64l30 30M100 64l-30 30"/></g>
    </g>
    <circle class="s-sun pop" cx="30" cy="44" r="5"/>
    <circle class="s-accent2 pop d2" cx="144" cy="86" r="5"/>`),

  // выбери группу — три кружочка-человечка
  group: wrap(`${shadow(52)}
    <g class="float d2"><circle class="s-accent2" cx="44" cy="58" r="13"/><path class="s-accent2" d="M22 104a22 22 0 0 1 44 0z"/></g>
    <g class="float d3"><circle class="s-peach" cx="126" cy="58" r="13"/><path class="s-peach" d="M104 104a22 22 0 0 1 44 0z"/></g>
    <g class="float"><circle class="s-accent" cx="85" cy="48" r="17"/><path class="s-accent" d="M56 110a29 29 0 0 1 58 0z"/></g>
    <circle class="s-sun pop" cx="85" cy="14" r="5"/>`),
};

const icon = (d, size = 14, extra = '') =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" ${extra}><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="${d}"/></svg>`;

export const ICONS = {
  pin: icon('M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'),
  user: icon('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0'),
  clock: icon('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2', 18),
  bell: icon('M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0', 18),
  warn: icon('M12 3l10 18H2zM12 10v4M12 17.5v.01', 22),
  bolt: icon('M13 2L4 14h7l-1 8 9-12h-7z', 18),
  file: icon('M14 3H6v18h12V7zM14 3v4h4', 16),
  // нижние вкладки
  calendar: icon('M4 6h16v15H4zM4 10h16M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2', 22),
  news: icon('M4 5h13v14a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2zM17 9h3v10a2 2 0 0 1-4 0M7 9h7M7 13h7M7 16h4', 22),
  cap: icon('M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5M22 9v6', 22),
  book: icon('M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21a2 2 0 0 1 2-2h13', 15),
  arrow: icon('M7 17L17 7M9 7h8v8', 15),
};
