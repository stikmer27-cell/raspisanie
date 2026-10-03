package ru.stikmer.raspisanie

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

object Notifier {
    private const val CH_DAILY = "daily"
    private const val CH_CHANGES = "changes"
    private const val CH_SERVICE = "service"
    private const val CH_UPDATES = "updates"
    private const val CH_NEWS = "news"
    private const val CH_SESSION = "session"
    const val SERVICE_ID = 900
    private const val UPDATED_ID = 5
    private const val UPDATE_ASK_ID = 6
    private const val ACCENT = 0xFF2F6FE0.toInt()

    fun ensureChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(
            NotificationChannel(CH_DAILY, "Расписание на день", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Вечером пары на завтра, утром на сегодня"
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_CHANGES, "Изменения в расписании", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Если на сайте поменяли уже присланное расписание"
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_SERVICE, "Фоновая проверка", NotificationManager.IMPORTANCE_MIN).apply {
                description = "Короткое служебное уведомление во время проверки сайта"
                setShowBadge(false)
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_NEWS, "Новости колледжа", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Новые новости и объявления на сайте ВКИ НГУ"
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_SESSION, "Сессия и пересдачи", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Выложили расписание экзаменов, пересдач или вопросы к зачётам для твоей группы"
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_UPDATES, "Обновления приложения", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Приложение обновилось само или ждёт подтверждения"
                setShowBadge(false)
            },
        )
    }

    private fun openApp(ctx: Context): PendingIntent = PendingIntent.getActivity(
        ctx, 14, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun post(ctx: Context, id: Int, n: Notification) {
        try {
            NotificationManagerCompat.from(ctx).notify(id, n)
        } catch (e: SecurityException) {
            // уведомления запрещены
        }
    }

    /** Приложение само обновилось до новой версии. */
    fun updated(ctx: Context, version: String, notes: String) {
        val text = notes.ifBlank { "Нажми, чтобы открыть" }
        post(ctx, UPDATED_ID, NotificationCompat.Builder(ctx, CH_UPDATES)
            .setSmallIcon(R.drawable.ic_stat)
            .setColor(ACCENT)
            .setContentTitle("Расписание обновлено до $version")
            .setContentText(text.lineSequence().first())
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(openApp(ctx))
            .setAutoCancel(true)
            .build())
    }

    /** Телефон просит подтвердить установку (Android 11 и старше или особые прошивки). */
    fun updateNeedsTap(ctx: Context, confirm: Intent, version: String) {
        val pi = PendingIntent.getActivity(ctx, 13, confirm, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        post(ctx, UPDATE_ASK_ID, NotificationCompat.Builder(ctx, CH_UPDATES)
            .setSmallIcon(R.drawable.ic_stat)
            .setColor(ACCENT)
            .setContentTitle("Обновление ${version.ifEmpty { "приложения" }} готово")
            .setContentText("Нажми, чтобы установить")
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build())
    }

    /** m = {title, body, tag, day, kind: daily|change|test} */
    fun show(ctx: Context, m: JSONObject) {
        val nmc = NotificationManagerCompat.from(ctx)
        if (!nmc.areNotificationsEnabled()) return
        val title = m.optString("title")
        val body = m.optString("body")
        val day = m.optString("day")
        val kind = m.optString("kind", "daily")
        val tag = m.optString("tag", "day-$day")
        val id = when (kind) {
            "change" -> 2
            "test" -> 3
            "news" -> 10
            "session" -> 11
            else -> 1
        }
        val open = Intent(ctx, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        // новости и сессия открываются на своей вкладке, расписание — на нужном дне
        if (kind == "news" || kind == "session") open.putExtra("tab", kind) else open.putExtra("day", day)
        val pi = PendingIntent.getActivity(
            ctx, (tag + id).hashCode(), open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val channel = when (kind) {
            "change" -> CH_CHANGES
            "news" -> CH_NEWS
            "session" -> CH_SESSION
            else -> CH_DAILY
        }
        val n = NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(R.drawable.ic_stat)
            .setColor(ACCENT)
            .setContentTitle(title)
            .setContentText(body.lineSequence().firstOrNull() ?: "")
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(if (kind == "change" || kind == "session") NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            .build()
        try {
            nmc.notify(tag, id, n)
        } catch (e: SecurityException) {
            // разрешение на уведомления отозвали
        }
    }

    fun serviceNotification(ctx: Context): Notification =
        NotificationCompat.Builder(ctx, CH_SERVICE)
            .setSmallIcon(R.drawable.ic_stat)
            .setColor(ACCENT)
            .setContentTitle("Проверяю расписание...")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setSilent(true)
            .build()
}
