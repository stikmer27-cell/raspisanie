package ru.stikmer.raspisanie

import android.app.AlarmManager
import android.app.Application
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.concurrent.TimeUnit

/**
 * Когда проверять сайт:
 *  - примерно раз в 30 минут (WorkManager, только при наличии сети);
 *  - точно в вечернее и утреннее время (будильник) — чтобы уведомление не опоздало,
 *    даже если телефон спит. Без сети движок отправит расписание из последних данных.
 */
object Scheduler {
    fun ensure(ctx: Context) {
        val periodic = PeriodicWorkRequestBuilder<CheckWorker>(30, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInputData(workDataOf("mode" to "check"))
            .build()
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("periodic", ExistingPeriodicWorkPolicy.KEEP, periodic)
        if (Updater.enabled) {
            val update = PeriodicWorkRequestBuilder<UpdateWorker>(6, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setInputData(workDataOf("mode" to "check"))
                .setInitialDelay(20, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("update", ExistingPeriodicWorkPolicy.KEEP, update)
        }
        scheduleAlarms(ctx)
    }

    /** Обновление приложения: check — проверить/скачать, now — поставить сразу, install — поставить скачанное. */
    fun update(ctx: Context, mode: String, delaySec: Long = 0) {
        if (!Updater.enabled) return
        val req = OneTimeWorkRequestBuilder<UpdateWorker>()
            .setInputData(workDataOf("mode" to mode))
            .setInitialDelay(delaySec, TimeUnit.SECONDS)
        if (mode != "install") req.setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        WorkManager.getInstance(ctx).enqueueUniqueWork("update-$mode", ExistingWorkPolicy.REPLACE, req.build())
    }

    fun runNow(ctx: Context, mode: String) {
        val req = OneTimeWorkRequestBuilder<CheckWorker>()
            .setInputData(workDataOf("mode" to mode))
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
        WorkManager.getInstance(ctx).enqueueUniqueWork("now-$mode", ExistingWorkPolicy.REPLACE, req)
    }

    fun scheduleAlarms(ctx: Context) {
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return
        val zone = ZoneId.of(Prefs.TIMEZONE)
        for ((code, time) in listOf(1 to Prefs.evening(ctx), 2 to Prefs.morning(ctx))) {
            val at = nextOccurrence(time, zone)
            val pi = PendingIntent.getBroadcast(
                ctx, code,
                Intent(ctx, AlarmReceiver::class.java).setAction("ru.stikmer.raspisanie.ALARM_$code"),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
            try {
                if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
                else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            } catch (e: SecurityException) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            }
        }
    }

    private fun nextOccurrence(hhmm: String, zone: ZoneId): Long {
        val t = try {
            LocalTime.parse(hhmm)
        } catch (e: Exception) {
            LocalTime.of(20, 0)
        }
        val now = ZonedDateTime.now(zone)
        // +20 секунд: чтобы движок уже точно считал, что время наступило
        var at = now.with(t).withSecond(20).withNano(0)
        if (!at.isAfter(now)) at = at.plusDays(1)
        return at.toInstant().toEpochMilli()
    }
}

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        Scheduler.runNow(ctx, "check")
        Scheduler.scheduleAlarms(ctx)
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        Scheduler.ensure(ctx)
        if (intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            // новая версия встала: сообщить, перерисовать виджет новым кодом
            Updater.onUpdated(ctx)
            WidgetUpdater.updateAll(ctx)
        }
    }
}

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifier.ensureChannels(this)
        Scheduler.ensure(this)
    }
}
