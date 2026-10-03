package ru.stikmer.raspisanie

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

/** Виджет на рабочий стол: пары на сегодня (или на завтра, когда сегодня всё закончилось). */
class ScheduleWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) = WidgetUpdater.update(ctx, mgr, ids)

    override fun onAppWidgetOptionsChanged(ctx: Context, mgr: AppWidgetManager, id: Int, options: Bundle) =
        WidgetUpdater.update(ctx, mgr, intArrayOf(id))

    override fun onEnabled(ctx: Context) = Scheduler.ensure(ctx)

    override fun onReceive(ctx: Context, intent: Intent) {
        super.onReceive(ctx, intent)
        when (intent.action) {
            WidgetUpdater.ACTION_REFRESH -> {
                Scheduler.runNow(ctx, "manual")
                WidgetUpdater.updateAll(ctx)
            }
            WidgetUpdater.ACTION_TICK -> WidgetUpdater.updateAll(ctx)
        }
    }
}

object WidgetUpdater {
    const val ACTION_REFRESH = "ru.stikmer.raspisanie.WIDGET_REFRESH"
    const val ACTION_TICK = "ru.stikmer.raspisanie.WIDGET_TICK"

    private val WD_SHORT = arrayOf("пн", "вт", "ср", "чт", "пт", "сб", "вс")
    private val MONTHS = arrayOf("января", "февраля", "марта", "апреля", "мая", "июня", "июля",
        "августа", "сентября", "октября", "ноября", "декабря")
    private val ROWS = listOf(
        intArrayOf(R.id.r1, R.id.r1_num, R.id.r1_time, R.id.r1_subj, R.id.r1_room),
        intArrayOf(R.id.r2, R.id.r2_num, R.id.r2_time, R.id.r2_subj, R.id.r2_room),
        intArrayOf(R.id.r3, R.id.r3_num, R.id.r3_time, R.id.r3_subj, R.id.r3_room),
        intArrayOf(R.id.r4, R.id.r4_num, R.id.r4_time, R.id.r4_subj, R.id.r4_room),
        intArrayOf(R.id.r5, R.id.r5_num, R.id.r5_time, R.id.r5_subj, R.id.r5_room),
        intArrayOf(R.id.r6, R.id.r6_num, R.id.r6_time, R.id.r6_subj, R.id.r6_room),
    )

    private class Palette(dark: Boolean) {
        val bg = if (dark) R.drawable.widget_bg_dark else R.drawable.widget_bg_light
        val badge = if (dark) R.drawable.widget_badge_dark else R.drawable.widget_badge_light
        val badgeSkip = if (dark) R.drawable.widget_badge_skip_dark else R.drawable.widget_badge_skip_light
        val badgeGap = if (dark) R.drawable.widget_badge_gap_dark else R.drawable.widget_badge_gap_light
        val rowNow = if (dark) R.drawable.widget_row_now_dark else R.drawable.widget_row_now_light
        val pillNow = if (dark) R.drawable.widget_pill_now_dark else R.drawable.widget_pill_now_light
        val pillNext = if (dark) R.drawable.widget_pill_next_dark else R.drawable.widget_pill_next_light
        val pillLate = if (dark) R.drawable.widget_pill_late_dark else R.drawable.widget_pill_late_light
        val text = if (dark) 0xFFECECF1.toInt() else 0xFF121826.toInt()
        val muted = if (dark) 0xFF9A9AA8.toInt() else 0xFF667085.toInt()
        val accent = if (dark) 0xFF8FB2FF.toInt() else 0xFF2F6FE0.toInt()
        val now = if (dark) 0xFF3CCF82.toInt() else 0xFF12A150.toInt()
        val warn = if (dark) 0xFFFFB35C.toInt() else 0xFFB54708.toInt()
        val danger = if (dark) 0xFFFF6B5E.toInt() else 0xFFD92D20.toInt()
        val emblem = if (dark) 0xFF7AA2FF.toInt() else 0xFF1A33FF.toInt()
    }

    /** slot: 0 — пара, 1 — пустая пара перед первой («пары нет»), 2 — окно между парами. */
    private class Lesson(
        val label: String, val pairs: List<Int>, val start: String?, val end: String?, val subject: String,
        val room: String, val cancelled: Boolean, val real: Boolean, val slot: Int = 0,
    )

    // звонки — как BELLS в engine.js (тесты сверяют их с каждым PDF)
    private val BELLS = mapOf(
        1 to ("09:00" to "10:35"), 2 to ("10:45" to "12:20"), 3 to ("13:00" to "14:35"),
        4 to ("14:45" to "16:20"), 5 to ("16:30" to "18:05"), 6 to ("18:15" to "19:50"),
    )
    private val ORD_DAT = arrayOf("", "первой", "второй", "третьей", "четвёртой", "пятой", "шестой", "седьмой", "восьмой")

    /** «Ко второй паре» (на узком виджете — «Ко 2 паре»). */
    private fun toPair(n: Int, short: Boolean) =
        "${if (n == 2) "Ко" else "К"} ${if (short) n.toString() else ORD_DAT.getOrElse(n) { n.toString() }} паре"

    /** Пустые пары — строками на своём месте, как в приложении: перед первой и окна между парами. */
    private fun withSlots(lessons: List<Lesson>): List<Lesson> {
        val pairs = lessons.filter { it.real }.flatMap { it.pairs }
        if (pairs.isEmpty()) return lessons
        val first = pairs.min()
        val busy = lessons.flatMap { it.pairs }.toSet()
        val groups = mutableListOf<MutableList<Int>>()
        for (p in 1 until pairs.max()) {
            if (p in busy) continue
            val g = groups.lastOrNull()
            if (g != null && g.last() == p - 1 && (g.last() < first) == (p < first)) g.add(p) else groups.add(mutableListOf(p))
        }
        val out = lessons.toMutableList()
        for (g in groups) {
            val before = g.first() < first
            val at = out.indexOfFirst { it.slot == 0 && it.pairs.isNotEmpty() && it.pairs.first() > g.last() }.takeIf { it >= 0 } ?: out.size
            val text = if (!before) "окно" else if (g.size > 1) "пар нет" else "пары нет"
            out.add(at, Lesson(if (g.size > 1) "${g.first()}–${g.last()}" else "${g.first()}", g,
                BELLS[g.first()]?.first, BELLS[g.last()]?.second, "— $text", "", false, false, if (before) 1 else 2))
        }
        return out
    }

    fun updateAll(ctx: Context) {
        val mgr = AppWidgetManager.getInstance(ctx)
        val ids = mgr.getAppWidgetIds(ComponentName(ctx, ScheduleWidget::class.java))
        if (ids.isNotEmpty()) update(ctx, mgr, ids)
    }

    fun update(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        val data = try {
            Prefs.dataFile(ctx, "schedule.json")?.takeIf { it.isFile }?.let { JSONObject(it.readText()) }
        } catch (e: Exception) {
            null
        }
        var nextTick: Long? = null
        for (id in ids) {
            val opts = mgr.getAppWidgetOptions(id)
            // телефон в портретной ориентации: высота виджета — MAX_HEIGHT, ширина — MIN_WIDTH
            val heightDp = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0).takeIf { it > 0 }
                ?: opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0).takeIf { it > 0 } ?: 180
            val widthDp = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 300)
            val (views, tick) = build(ctx, data, heightDp, compact = widthDp in 1..279)
            mgr.updateAppWidget(id, views)
            if (tick != null) nextTick = tick
        }
        scheduleTick(ctx, nextTick)
    }

    private fun minutes(t: String?): Int? = t?.split(":")?.takeIf { it.size == 2 }?.let { it[0].toInt() * 60 + it[1].toInt() }

    private fun lessonsOf(arr: JSONArray): List<Lesson> = (0 until arr.length()).map { i ->
        val l = arr.getJSONObject(i)
        val pairs = l.optJSONArray("pairs") ?: JSONArray()
        val nums = (0 until pairs.length()).map { pairs.optInt(it) }
        val label = when (nums.size) {
            0 -> "·"
            1 -> nums[0].toString()
            else -> "${nums.first()}–${nums.last()}"
        }
        val start = l.optString("start").takeIf { it.isNotEmpty() && it != "null" }
        val end = l.optString("end").takeIf { it.isNotEmpty() && it != "null" }
        val cancelled = l.optBoolean("cancelled")
        Lesson(label, nums, start, end, l.optString("subject").ifEmpty { l.optString("text") }, l.optString("room"),
            cancelled, nums.isNotEmpty() && !cancelled && start != null)
    }

    private val MONTHS_SHORT = arrayOf("янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек")

    private fun dayTitle(day: LocalDate, today: LocalDate, compact: Boolean = false): String {
        val month = if (compact) MONTHS_SHORT[day.monthValue - 1] else MONTHS[day.monthValue - 1]
        val base = "${WD_SHORT[day.dayOfWeek.value - 1]} ${day.dayOfMonth} $month"
        return when (day) {
            today -> "Сегодня, $base"
            today.plusDays(1) -> "Завтра, $base"
            else -> base.replaceFirstChar { it.uppercase() }
        }
    }

    private fun plural(n: Int) = when {
        n % 10 == 1 && n % 100 != 11 -> "пара"
        n % 10 in 2..4 && n % 100 !in 12..14 -> "пары"
        else -> "пар"
    }

    private fun dur(min: Int): String {
        val h = min / 60
        val m = min % 60
        return listOfNotNull(if (h > 0) "$h ч" else null, if (m > 0) "$m мин" else null).joinToString(" ").ifEmpty { "минуту" }
    }

    /** Собирает вид виджета; второе значение — когда его стоит перерисовать (начало/конец пары). */
    private fun build(ctx: Context, data: JSONObject?, heightDp: Int, compact: Boolean): Pair<RemoteViews, Long?> {
        val p = Palette(Prefs.isDark(ctx))
        val v = RemoteViews(ctx.packageName, R.layout.widget_schedule)
        v.setInt(R.id.w_root, "setBackgroundResource", p.bg)
        v.setInt(R.id.w_emblem, "setColorFilter", p.emblem)
        v.setInt(R.id.w_refresh, "setColorFilter", p.muted)
        v.setTextColor(R.id.w_title, p.accent)
        v.setTextColor(R.id.w_day, p.text)
        v.setTextColor(R.id.w_sum, p.muted)
        v.setTextColor(R.id.w_more, p.muted)
        v.setTextColor(R.id.w_empty, p.muted)

        val zone = ZoneId.of(Prefs.TIMEZONE)
        val now = ZonedDateTime.now(zone)
        val today = now.toLocalDate()
        val nowMin = now.hour * 60 + now.minute

        // нажатие на виджет — открыть приложение, на стрелку — обновить
        val open = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val group = Prefs.group(ctx)
        val groupObj = data?.optJSONObject("groups")?.optJSONObject(group)
        v.setTextViewText(R.id.w_title, "ВКИ НГУ" + (groupObj?.optString("name")?.let { " · $it" } ?: ""))
        v.setOnClickPendingIntent(R.id.w_refresh, PendingIntent.getBroadcast(ctx, 7,
            Intent(ctx, ScheduleWidget::class.java).setAction(ACTION_REFRESH),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))

        fun empty(day: String, text: String): Pair<RemoteViews, Long?> {
            v.setTextViewText(R.id.w_day, day)
            v.setTextViewText(R.id.w_sum, "")
            v.setViewVisibility(R.id.w_status, View.GONE)
            v.setViewVisibility(R.id.w_rows, View.GONE)
            v.setViewVisibility(R.id.w_more, View.GONE)
            v.setViewVisibility(R.id.w_empty, View.VISIBLE)
            v.setTextViewText(R.id.w_empty, text)
            v.setOnClickPendingIntent(R.id.w_root, PendingIntent.getActivity(ctx, 8, open,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            return v to null
        }

        if (group.isEmpty()) return empty("Расписание", "Открой приложение и впиши свою группу")
        if (data == null) return empty("Расписание", "Открой приложение — оно скачает расписание")
        val days = groupObj?.optJSONObject("days") ?: return empty("Расписание", "Группа не найдена в расписании")

        // какой день показать: сегодня — до часа после последней пары, потом следующий учебный
        val todayLessons = days.optJSONArray(today.toString())?.let { lessonsOf(it) }
        val todayEnd = todayLessons?.filter { it.real }?.mapNotNull { minutes(it.end) }?.maxOrNull()
        val day: LocalDate = if (todayLessons != null && todayEnd != null && nowMin < todayEnd + 60) {
            today
        } else {
            val keys = days.keys().asSequence().map { LocalDate.parse(it) }.filter { it > today }.sorted().toList()
            keys.firstOrNull { it.dayOfWeek != DayOfWeek.SUNDAY || (days.optJSONArray(it.toString())?.length() ?: 0) > 0 }
                ?: today.plusDays(if (today.dayOfWeek == DayOfWeek.SATURDAY) 2 else 1)
        }
        open.putExtra("day", day.toString())
        v.setOnClickPendingIntent(R.id.w_root, PendingIntent.getActivity(ctx, 8, open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))

        val arr = days.optJSONArray(day.toString()) ?: return empty(dayTitle(day, today, compact), "Расписание ещё не выложили")
        val lessons = withSlots(lessonsOf(arr))
        if (lessons.isEmpty()) return empty(dayTitle(day, today, compact), "Пар нет — можно отдыхать")

        v.setTextViewText(R.id.w_day, dayTitle(day, today, compact))
        v.setViewVisibility(R.id.w_empty, View.GONE)
        v.setViewVisibility(R.id.w_rows, View.VISIBLE)
        val real = lessons.filter { it.real }
        val n = real.flatMap { it.pairs }.toSet().size
        v.setTextViewText(R.id.w_sum, if (real.isEmpty()) "отменены" else "$n ${plural(n)}")
        v.setViewVisibility(R.id.w_sum, if (compact) View.GONE else View.VISIBLE)

        // к какой паре приходить: «Ко второй паре» — главное, что видно на виджете до начала дня
        val firstPair = real.flatMap { it.pairs }.minOrNull()
        val firstStart = real.firstOrNull { firstPair != null && firstPair in it.pairs }?.start
        val late = firstPair != null && firstPair > 1
        val arrive = firstPair?.let { toPair(it, compact) }

        // сейчас / следующая / закончились
        var status: String? = if (day != today && arrive != null && firstStart != null) "$arrive · $firstStart" else null
        var statusNow = false
        var statusLate = status != null && late
        var nowIdx = -1
        var focusIdx = -1
        var tick: Long? = null
        fun at(min: Int) = now.withHour(min / 60 % 24).withMinute(min % 60).withSecond(5).withNano(0)
            .plusDays((min / (24 * 60)).toLong()).toInstant().toEpochMilli()
        if (day == today) {
            for ((i, l) in lessons.withIndex()) {
                val s = minutes(l.start) ?: continue
                val e = minutes(l.end) ?: continue
                if (!l.real) continue
                if (nowMin in s until e) {
                    nowIdx = i
                    focusIdx = i
                    statusNow = true
                    status = "Сейчас ${l.label} пара · ещё ${dur(e - nowMin)}"
                    tick = at(e)
                    break
                }
                if (s > nowMin) {
                    focusIdx = i
                    // день ещё не начался — «Ко второй паре · через 40 мин»
                    val dayNotStarted = firstPair != null && firstPair in l.pairs && arrive != null
                    status = if (dayNotStarted) "$arrive · через ${dur(s - nowMin)}" else "Следующая через ${dur(s - nowMin)}"
                    statusLate = dayNotStarted && late
                    tick = at(s)
                    break
                }
            }
            if (status == null && todayEnd != null) {
                status = "Пары на сегодня закончились"
                tick = at(todayEnd + 60) // через час виджет сам покажет следующий день
            }
        }
        if (status != null) {
            v.setViewVisibility(R.id.w_status, View.VISIBLE)
            v.setTextViewText(R.id.w_status, status)
            v.setInt(R.id.w_status, "setBackgroundResource", when {
                statusNow -> p.pillNow
                statusLate -> p.pillLate
                else -> p.pillNext
            })
            v.setTextColor(R.id.w_status, when {
                statusNow -> p.now
                statusLate -> p.warn
                else -> p.accent
            })
        } else {
            v.setViewVisibility(R.id.w_status, View.GONE)
        }

        // показываем все пары (прошедшие — приглушённо); если не влезают — окно вокруг текущей/следующей
        fun isPast(l: Lesson) = day == today && l.start != null && (minutes(l.end) ?: minutes(l.start) ?: 0) <= nowMin
        // сколько строк реально влезает (по разметке): отступы 22 + шапка 36 + отступ списка 5,
        // статус 29, строка «и ещё…» 17, строка пары 36dp
        val free = heightDp - 63 - (if (status != null) 29 else 0)
        val rows = (if (36 * lessons.size <= free) lessons.size else (free - 17) / 36).coerceIn(1, ROWS.size)
        val first = when {
            lessons.size <= rows -> 0
            // текущая/следующая пара всегда видна; если места хватает — и одна перед ней
            focusIdx >= 0 -> (if (rows >= 2) focusIdx - 1 else focusIdx).coerceIn(0, lessons.size - rows)
            day == today && status != null -> lessons.size - rows // всё закончилось — последние
            else -> 0
        }
        val visible = lessons.drop(first)
        for ((i, ids) in ROWS.withIndex()) {
            val l = visible.getOrNull(i)
            if (l == null || i >= rows.coerceAtLeast(1)) {
                v.setViewVisibility(ids[0], View.GONE)
                continue
            }
            val isNow = first + i == nowIdx
            val past = isPast(l)
            v.setViewVisibility(ids[0], View.VISIBLE)
            v.setInt(ids[0], "setBackgroundResource", if (isNow) p.rowNow else android.R.color.transparent)
            v.setTextViewText(ids[1], l.label)
            v.setInt(ids[1], "setBackgroundResource", when {
                isNow -> R.drawable.widget_badge_now
                l.slot == 1 && !past -> p.badgeSkip
                l.slot != 0 -> p.badgeGap
                l.cancelled || past -> R.drawable.widget_badge_off
                else -> p.badge
            })
            v.setTextColor(ids[1], when {
                isNow -> 0xFFFFFFFF.toInt()
                l.slot == 1 && !past -> p.warn
                l.slot != 0 -> p.muted
                else -> p.accent
            })
            v.setTextViewText(ids[2], l.start ?: "")
            v.setViewVisibility(ids[2], if (compact) View.GONE else View.VISIBLE)
            v.setTextColor(ids[2], p.muted)
            v.setTextViewText(ids[3], if (l.cancelled) "✕ ${l.subject}" else l.subject)
            v.setTextColor(ids[3], when {
                l.cancelled -> p.danger
                past -> p.muted
                l.slot == 1 -> p.warn
                l.slot == 2 -> p.muted
                else -> p.text
            })
            // на узком виджете место отдаём названию пары
            v.setTextViewText(ids[4], if (compact) l.room.replace(Regex("Читальный зал\\s*-?\\s*"), "ЧЗ-").trimEnd('-') else l.room.replace("Читальный зал", "Чит. зал"))
            v.setTextColor(ids[4], p.muted)
        }
        // «и ещё N» — только настоящие пары (пустые строки-прочерки не считаем)
        val shown = first until first + minOf(rows, visible.size)
        val hidden = lessons.indices.count { it !in shown && lessons[it].slot == 0 }
        if (hidden > 0) {
            v.setViewVisibility(R.id.w_more, View.VISIBLE)
            v.setTextViewText(R.id.w_more, "и ещё $hidden — открыть")
        } else {
            v.setViewVisibility(R.id.w_more, View.GONE)
        }
        return v to tick
    }

    /** Перерисовать виджет к началу/концу ближайшей пары — чтобы «сейчас» было точным. */
    private fun scheduleTick(ctx: Context, at: Long?) {
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return
        val pi = PendingIntent.getBroadcast(ctx, 9, Intent(ctx, ScheduleWidget::class.java).setAction(ACTION_TICK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        am.cancel(pi)
        if (at != null && at > System.currentTimeMillis()) am.set(AlarmManager.RTC, at, pi)
    }
}
