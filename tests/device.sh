#!/usr/bin/env bash
# Сквозная проверка APK на эмуляторе: установка → ввод группы → расписание → тестовое уведомление.
# Скриншоты, разметка экрана, уведомления и логи складываются в out/.
set -u
mkdir -p out
PKG=ru.stikmer.raspisanie
FAIL=0
shot() { adb exec-out screencap -p > "out/$1.png"; }
# uiautomator иногда не успевает (на экране идут анимации) — повторяем
dump() {
  for _ in 1 2 3 4 5; do
    adb shell rm -f /sdcard/ui.xml >/dev/null 2>&1
    adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
    adb exec-out cat /sdcard/ui.xml > "out/$1.xml" 2>/dev/null
    grep -q "<node" "out/$1.xml" && return 0
    sleep 1
  done
}
# координаты центра элемента по regex (text / content-desc / resource-id / hint)
center() {
  dump tmp
  python3 - "$1" <<'EOF'
import re, sys
xml = open('out/tmp.xml', encoding='utf-8').read()
pat = re.compile(sys.argv[1])
for node in re.findall(r'<node [^>]+>', xml):
    a = dict(re.findall(r'([\w-]+)="([^"]*)"', node))
    if any(pat.search(a.get(k, '')) for k in ('text', 'content-desc', 'resource-id', 'hint')):
        x1, y1, x2, y2 = map(int, re.findall(r'\d+', a['bounds']))
        print((x1 + x2) // 2, (y1 + y2) // 2)
        break
EOF
}
texts() { python3 -c "import re,sys,html; x=open('out/$1.xml',encoding='utf-8').read(); print('\n'.join(html.unescape(t) for t in re.findall(r' text=\"([^\"]+)\"', x)))"; }
check() { if grep -q -- "$2" "$1"; then echo "OK   $3"; else echo "FAIL $3"; FAIL=1; fi; }

adb logcat -c
# есть тестовая «старая» версия (номер 1) — ставим её: в конце она должна сама обновиться до релиза
OLD=$(ls old/*.apk 2>/dev/null | head -n 1)
RELEASE=$(ls raspisanie-*.apk | head -n 1)
if [ -n "$OLD" ]; then echo "ставлю старую тестовую версию: $OLD"; adb install -r "$OLD" || { echo "FAIL установка"; exit 1; }
else adb install -r "$RELEASE" || { echo "FAIL установка"; exit 1; }; fi
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS || true
adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 12
shot 01-start

# ждём, пока скачается список групп (до 3 минут)
for i in $(seq 1 36); do
  dump onb
  texts onb > out/onb.txt
  grep -q "В расписании" out/onb.txt && break
  sleep 5
done
shot 02-onboarding
check out/onb.txt "В расписании" "список групп скачан и разобран на телефоне"

# вписываем группу латиницей (adb не умеет печатать кириллицу) — приложение само поймёт 2507sb1 = 2507сб1
XY=$(center 'onbInput')
echo "input at $XY"
adb shell input tap $XY
sleep 1
adb shell input text 2507sb1
sleep 2
shot 03-typed
adb shell input keyevent 66
sleep 5
shot 04-schedule
dump schedule
texts schedule > out/schedule.txt
check out/schedule.txt "2507сб1" "группа выбрана"
check out/schedule.txt "пары\|паре\|ещё не выложили\|Пар нет" "показано расписание дня"

# свайпы по расписанию не должны сдвигать всю страницу вбок
adb shell input swipe 280 470 40 480 180
sleep 1.5
adb shell input swipe 40 470 280 480 180
sleep 1.5
dump swipe
TITLE_X=$(python3 - <<'EOF'
import re
xml = open('out/swipe.xml', encoding='utf-8').read()
for n in re.findall(r'<node [^>]+>', xml):
    a = dict(re.findall(r'([\w-]+)="([^"]*)"', n))
    if a.get('text') == 'ВКИ НГУ':
        print(re.findall(r'\d+', a['bounds'])[0]); break
else:
    print(-1)
EOF
)
shot 04b-after-swipe
if [ "$TITLE_X" -ge 30 ]; then echo "OK   после свайпов страница на месте (заголовок x=$TITLE_X)"; else echo "FAIL страница уехала вбок (заголовок x=$TITLE_X)"; FAIL=1; fi

# кнопка «обновить» сразу отзывается
XY=$(center '^Обновить$')
adb shell input tap $XY
sleep 0.6
dump rf
texts rf > out/rf.txt
check out/rf.txt "Проверяю\|Уже проверяю\|Изменений нет\|Расписание обновлено\|Не получилось" "кнопка обновления сразу отзывается"
sleep 3

# все дни из полоски — по скриншоту и тексту. Кнопки подписаны «среда 30 сентября, ко второй паре, 3 пары».
dump days
python3 - > out/days.txt <<'EOF'
import re, html
xml = open('out/days.xml', encoding='utf-8').read()
for n in re.findall(r'<node [^>]+>', xml):
    a = dict(re.findall(r'([\w-]+)="([^"]*)"', n))
    d = html.unescape(a.get('content-desc', '') or a.get('text', ''))
    if re.match(r'^(понедельник|вторник|среда|четверг|пятница|суббота) \d+ ', d):
        print(d)
EOF
cat out/days.txt
LATE=0
# список читаем через дескриптор 3: adb внутри цикла иначе «съест» stdin
while IFS= read -r d <&3; do
  key=$(echo "$d" | cut -d' ' -f1-2)
  n=$(echo "$key" | tr -d ' ')
  XY=$(center "^$key ")
  [ -z "$XY" ] && continue
  adb shell input tap $XY
  sleep 2
  dump "day-$n"
  texts "day-$n" > "out/day-$n.txt"
  shot "05-day-$n"
  # день не с первой пары: на месте пустых пар — прочерк «Пары нет» (или карточка отмены)
  if echo "$d" | grep -q ", ко второй паре\|, к третьей паре\|, к четвёртой паре\|, к пятой паре"; then
    LATE=$((LATE + 1))
    check "out/day-$n.txt" "Пары нет\|Пар нет\|Отменено" "$key: не с первой пары — пустые пары видны прочерком"
  fi
done 3< out/days.txt
[ "$LATE" -gt 0 ] || echo "SKIP на этой неделе нет дней не с первой пары"
# неделя 28.09–03.10 (известная): проверяем конкретные пары, если она ещё на сайте
if grep -q "^среда 30 сентября" out/days.txt; then
  check "out/day-вторник29.txt" "Занятия отменены" "вторник: занятия отменены"
  check "out/day-среда30.txt" "Учебная практика" "среда: учебная практика"
  check "out/day-среда30.txt" "Пар нет" "среда: первых двух пар нет — прочерк"
  check "out/days.txt" "среда 30 сентября, к третьей паре" "среда: в кнопке дня «к третьей паре»"
  check "out/days.txt" "понедельник 28 сентября, ко второй паре" "понедельник: в кнопке дня «ко второй паре»"
  check "out/day-пятница2.txt" "Правовое обеспечение" "пятница: правовое обеспечение"
else
  echo "SKIP на сайте уже другая неделя — пары 28.09–03.10 не сверяем"
fi

# настройки и тестовое уведомление (идёт через фоновую задачу и невидимый WebView)
XY=$(center 'Уведомления и настройки')
adb shell input tap $XY
sleep 2
shot 06-settings
XY=$(center 'Тестовое уведомление')
echo "test button at '$XY'"
[ -n "$XY" ] && adb shell input tap $XY
for i in $(seq 1 24); do
  adb shell dumpsys notification --noredact > out/notifications.txt
  grep -q "Тест:" out/notifications.txt && break
  sleep 5
done
check out/notifications.txt "Тест:" "тестовое уведомление пришло"
adb shell cmd statusbar expand-notifications
sleep 3
shot 07-notification
adb shell cmd statusbar collapse
sleep 3

# «Назад» закрывает шторку, а не приложение
adb shell input keyevent 4
sleep 2
dump afterback
texts afterback > out/afterback.txt
if grep -q "Когда присылать" out/afterback.txt; then echo "FAIL «Назад» не закрыл шторку"; FAIL=1; else echo "OK   «Назад» закрывает шторку"; fi
check out/afterback.txt "Расписание занятий" "после «Назад» приложение осталось открытым"

# нижние вкладки: «Новости» и «Сессия» (данные с сайта колледжа подтягивает фоновая проверка)
XY=$(center '^Новости$')
adb shell input tap $XY
sleep 2
dump news
texts news > out/news.txt
shot 06b-news
check out/news.txt "Новости колледжа" "вкладка «Новости» открывается"
check out/news.txt "Читать на сайте" "новости колледжа загружены с сайта"
XY=$(center '^Сессия$')
adb shell input tap $XY
sleep 2
dump sess
texts sess > out/sess.txt
shot 06c-session
check out/sess.txt "Остались несданные предметы\|Слежу за пересдачами" "вкладка «Сессия»: вопрос про долги"
check out/sess.txt "Пособия к твоим предметам" "вкладка «Сессия»: пособия к своим предметам"
check out/sess.txt "Показать все пособия" "вкладка «Сессия»: кнопка «Показать все пособия»"
adb shell input keyevent 4
sleep 2
dump back2
texts back2 > out/back2.txt
check out/back2.txt "сентября\|октября\|ноября\|декабря" "«Назад» с вкладки — снова расписание"

# «Поиск»: расписание другой группы и преподавателя, своя группа при этом не меняется
XY=$(center '^Поиск$')
adb shell input tap $XY
sleep 2
XY=$(center 'searchInput')
adb shell input tap $XY
sleep 1
adb shell input text 2507sa1
sleep 2
dump find
texts find > out/find.txt
shot 06d-find
check out/find.txt "2507са1" "поиск: группа находится (номер латиницей)"
adb shell input keyevent 66
sleep 3
dump fgroup
texts fgroup > out/fgroup.txt
shot 06e-other-group
check out/fgroup.txt "Расписание группы В2507са1" "поиск: открыто расписание другой группы"
check out/fgroup.txt "Твоя группа В2507сб1" "поиск: своя группа и уведомления не поменялись"
# открываем день, где у этой группы есть пары (кнопка дня подписана «…, к первой паре, 4 пары»)
XY=$(center 'паре, [0-9]')
[ -n "$XY" ] && adb shell input tap $XY && sleep 2
XY=$(center 'все пары преподавателя')
if [ -n "$XY" ]; then
  adb shell input tap $XY
  sleep 3
  dump teacher
  texts teacher > out/teacher.txt
  shot 06f-teacher
  check out/teacher.txt "на этой неделе" "преподаватель: пары за неделю по нажатию на фамилию"
  check out/teacher.txt "Собрано из расписания всех курсов" "преподаватель: пояснение, откуда данные"
  adb shell input keyevent 4
  sleep 2
  dump tback
  texts tback > out/tback.txt
  check out/tback.txt "Расписание группы В2507са1" "«Назад» от преподавателя: снова другая группа"
else
  echo "SKIP у группы 2507са1 в этот день нет пар с преподавателем"
fi
adb shell input keyevent 4
sleep 1.5
adb shell input keyevent 4
sleep 2
dump back3
texts back3 > out/back3.txt
check out/back3.txt "Расписание занятий" "«Назад» из поиска: приложение открыто"
if grep -q "Расписание группы" out/back3.txt; then echo "FAIL после поиска осталось чужое расписание"; FAIL=1; else echo "OK   после поиска снова своё расписание, не чужой группы"; fi
check out/back3.txt "сентября\|октября\|ноября\|декабря" "«Назад» из поиска: снова своё расписание"

# переключатель чёрной темы в шапке
switch_state() {
  dump sw
  python3 - <<'EOF'
import re
xml = open('out/sw.xml', encoding='utf-8').read()
for node in re.findall(r'<node [^>]+>', xml):
    if 'resource-id="themeBtn"' in node:
        print(dict(re.findall(r'([\w-]+)="([^"]*)"', node)).get('checked'))
        break
EOF
}
# читаемость: в тёмной теме текст должен быть светлым, в светлой — тёмным (по пикселям скриншота)
readable() {  # $1 = скриншот, $2 = dark|light, $3.. = regex элементов
  local png=$1 mode=$2; shift 2
  python3 - "$png" "$mode" "$@" <<'EOF'
import re, sys
from PIL import Image
png, mode, pats = sys.argv[1], sys.argv[2], sys.argv[3:]
xml = open('out/sw.xml', encoding='utf-8').read()
img = Image.open(png).convert('L')
ok = True
for p in pats:
    # dim:… — текст может быть нарочно приглушён (прошедшая пара): контраст пониже, но «застрявший»
    # цвет старой темы (тёмное на тёмном, светлое на светлом) всё равно не пройдёт
    soft = p.startswith('dim:')
    if soft:
        p = p[4:]
    # desc:… — искать по подписи кнопки (кнопки дней), проверять среднюю полосу, где число
    by_desc = p.startswith('desc:')
    rx = re.compile(p[5:] if by_desc else p)
    for node in re.findall(r'<node [^>]+>', xml):
        a = dict(re.findall(r'([\w-]+)="([^"]*)"', node))
        label = (a.get('content-desc', '') or a.get('text', '')) if by_desc else a.get('text', '')
        if rx.search(label) or (by_desc and rx.search(a.get('text', ''))):
            x1, y1, x2, y2 = map(int, re.findall(r'\d+', a['bounds']))
            if by_desc:
                a['text'] = label
                h = y2 - y1
                y1, y2 = y1 + int(h * 0.3), y1 + int(h * 0.68)
            px = sorted(img.crop((x1, y1, x2, y2)).getdata())
            lo, hi, bg = px[0], px[-1], px[len(px) // 2]  # медиана ~ фон под текстом
            # тёмная тема: фон тёмный, текст светлый; светлая — наоборот
            good = (bg < 90 and hi > (105 if soft else 170)) if mode == 'dark' else (bg > 170 and lo < (150 if soft else 90))
            print(f"{'OK  ' if good else 'FAIL'} {mode}: «{a['text'][:30]}» фон {bg}, текст {hi if mode == 'dark' else lo}")
            ok &= good
            break
    else:
        print(f"FAIL {mode}: элемент {p} не найден"); ok = False
sys.exit(0 if ok else 1)
EOF
}
# заголовок дня («Сегодня, суббота, 3 октября») — есть всегда, какая бы неделя ни была на сайте
SUBJ='^(Сегодня|Завтра|Вчера|Понедельник|Вторник|Среда|Четверг|Пятница|Суббота), .*(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)$'
BEFORE=$(switch_state)
XY=$(center 'themeBtn')
adb shell input tap $XY
sleep 0.35
shot 08-theme-anim
sleep 2
shot 09-theme-toggled
AFTER=$(switch_state)
MODE=$([ "$AFTER" = "true" ] && echo dark || echo light)
if readable out/09-theme-toggled.png $MODE '^ВКИ НГУ$' "$SUBJ" 'desc:^(понедельник|вторник|среда) ' 'desc:^(четверг|пятница|суббота) '; then echo "OK   текст читается после переключения темы ($MODE)"; else echo "FAIL текст не читается после переключения темы ($MODE)"; FAIL=1; fi
echo "switch: $BEFORE -> $AFTER"
if [ -n "$BEFORE" ] && [ "$BEFORE" != "$AFTER" ]; then echo "OK   переключатель темы переключается"; else echo "FAIL переключатель темы"; FAIL=1; fi
adb shell input tap $XY
sleep 2
shot 10-theme-back
BACK=$(switch_state)
if [ "$BACK" = "$BEFORE" ]; then echo "OK   переключатель возвращается обратно"; else echo "FAIL переключатель не вернулся"; FAIL=1; fi
MODE=$([ "$BACK" = "true" ] && echo dark || echo light)
if readable out/10-theme-back.png $MODE '^ВКИ НГУ$' "$SUBJ" 'desc:^(понедельник|вторник|среда) ' 'desc:^(четверг|пятница|суббота) '; then echo "OK   текст читается после обратного переключения ($MODE)"; else echo "FAIL текст не читается после обратного переключения ($MODE)"; FAIL=1; fi

# автообновление: стоит «старая» тестовая версия — пока приложение открыто, новая только скачивается,
# а когда из него вышли — ставится сама, без вопросов (Android 12+). До этого места приложение
# с экрана не уходило, поэтому обновление ещё не стояло.
if [ -n "$OLD" ]; then
  NEW=$(echo "$RELEASE" | sed 's/.*-1\.0\.\([0-9]*\)\.apk/\1/')
  ver() { adb shell dumpsys package $PKG | grep -m1 -o 'versionCode=[0-9]*' | cut -d= -f2; }
  for i in $(seq 1 12); do
    dump upd
    texts upd > out/upd.txt
    grep -q "Вышло обновление" out/upd.txt && break
    sleep 5
  done
  check out/upd.txt "Вышло обновление 1.0.$NEW" "пока приложение открыто — плашка «Вышло обновление 1.0.$NEW»"
  shot 14-update-ready
  # без разрешения «Установка неизвестных приложений» Android спрашивает подтверждение на каждое
  # обновление — приложение само предлагает разрешить (один раз) в настройках
  XY=$(center 'Уведомления и настройки')
  adb shell input tap $XY
  sleep 2
  dump updset
  texts updset > out/updset.txt
  check out/updset.txt "Установка обновлений" "в настройках есть «Установка обновлений»"
  check out/updset.txt "разреши один раз" "приложение просит один раз разрешить установку обновлений"
  adb shell input keyevent 4
  sleep 2
  # как будто пользователь нажал «Разрешить» и включил переключатель
  adb shell appops set $PKG REQUEST_INSTALL_PACKAGES allow
  echo "версия до: $(ver), в релизе: $NEW"
  adb shell input keyevent 3
  for i in $(seq 1 36); do sleep 5; [ "$(ver)" = "$NEW" ] && break; done
  V=$(ver)
  if [ "$V" = "$NEW" ]; then echo "OK   приложение само обновилось до 1.0.$NEW"; else echo "FAIL автообновление: версия $V, ожидалась $NEW"; FAIL=1; fi
  sleep 5
  adb shell dumpsys notification --noredact > out/notifications-update.txt
  check out/notifications-update.txt "обновлено до 1.0.$NEW" "уведомление «Расписание обновлено до 1.0.$NEW»"
  adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null
  sleep 6
  # после холодного старта WebView отдаёт текст экрана не сразу — ждём.
  # Группа и данные на месте, если в кнопках дней есть «к … паре» (без группы был бы экран «Привет!»)
  for i in $(seq 1 8); do
    dump after
    texts after > out/after.txt
    grep -q "паре" out/after.txt && break
    sleep 3
  done
  shot 15-after-update
  check out/after.txt ", к первой паре\|, ко второй паре\|, к третьей паре" "после обновления группа и данные на месте"
  if grep -q "Привет!" out/after.txt; then echo "FAIL после обновления пропала группа"; FAIL=1; fi
fi

# виджет: кнопка в настройках → подтверждение лаунчера → главный экран
XY=$(center 'Уведомления и настройки')
adb shell input tap $XY
sleep 2
adb shell input swipe 160 560 160 140 400
sleep 1
XY=$(center 'Добавить виджет на главный экран')
echo "widget button at '$XY'"
[ -n "$XY" ] && adb shell input tap $XY
sleep 3
shot 12-widget-dialog
XY=$(center '(?i)^(add|добавить|add to home screen|add automatically|добавить на главный экран)$')
echo "add button at '$XY'"
[ -n "$XY" ] && adb shell input tap $XY
sleep 2
adb shell input keyevent 3
sleep 5
shot 13-home-widget
dump home
texts home > out/home.txt
check out/home.txt "ВКИ НГУ" "виджет стоит на главном экране"
check out/home.txt "Сегодня\|Завтра\|пары\|Пар нет\|не выложили" "виджет показывает расписание"
adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 3

# тема «Авто» следует за системой
adb shell cmd uimode night yes
sleep 4
shot 11-system-dark
adb shell cmd uimode night no

adb logcat -d > out/logcat.txt
grep -E "RaspJS|RaspUI|Rasp |Rasp:|AndroidRuntime|WM-" out/logcat.txt | tail -n 300 > out/logcat-app.txt
grep -E "RaspJS|RaspUI|Rasp" out/logcat.txt > out/js.txt || true
echo "--- тема по логам приложения:"; grep "RaspUI.*theme" out/logcat.txt | tail -n 6 | sed 's/.*RaspUI/RaspUI/'
if grep -A1 "FATAL EXCEPTION" out/logcat.txt | grep -q "Process: $PKG"; then echo "FAIL приложение падало"; FAIL=1; else echo "OK   приложение не падало"; fi
if grep -q "RaspJS.*ERROR" out/logcat.txt; then echo "FAIL ошибки JavaScript в фоновой проверке"; FAIL=1; else echo "OK   фоновая проверка без ошибок JS"; fi
exit $FAIL
