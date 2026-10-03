package ru.stikmer.raspisanie

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import kotlinx.coroutines.sync.Mutex
import org.json.JSONObject

/** События для открытого экрана (running / done / settings). */
object Events {
    @Volatile
    var listener: ((String, String?) -> Unit)? = null
    private val main = Handler(Looper.getMainLooper())

    fun emit(type: String, arg: String? = null) {
        main.post { listener?.invoke(type, arg) }
    }
}

/** Одна проверка сайта: скачать, разобрать, показать нужные уведомления. */
class CheckWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    companion object {
        /** Занят, пока идёт проверка; обновление приложения ждёт её окончания. */
        val lock = Mutex()
    }

    override suspend fun doWork(): Result {
        val ctx = applicationContext
        val mode = inputData.getString("mode") ?: "check"
        // две проверки одновременно не нужны: вторая просто дождётся событий первой
        if (!lock.tryLock()) return Result.success()
        Prefs.running = true
        Events.emit("running")
        try {
            val out = Engine.run(ctx, mode)
            val offline = out.optBoolean("offline")
            val errors = out.optJSONArray("errors")
            if (errors != null) for (i in 0 until errors.length()) Log.w("Rasp", "check: ${errors.optString(i)}")
            if (offline) Prefs.markError(ctx, errors?.optString(0)) else Prefs.markOk(ctx)
            val messages = out.optJSONArray("messages")
            if (messages != null) {
                for (i in 0 until messages.length()) Notifier.show(ctx, messages.getJSONObject(i))
            }
            Events.emit(
                "done",
                JSONObject()
                    .put("changed", out.optBoolean("changed"))
                    .put("error", if (offline) errors?.optString(0) else JSONObject.NULL)
                    .toString(),
            )
            return Result.success()
        } catch (e: Throwable) {
            Log.e("Rasp", "check failed", e)
            Prefs.markError(ctx, e.message)
            Events.emit("done", JSONObject().put("error", e.message ?: "ошибка").toString())
            return if (mode == "check" && runAttemptCount < 2) Result.retry() else Result.success()
        } finally {
            Prefs.running = false
            lock.unlock()
            try {
                WidgetUpdater.updateAll(ctx)
            } catch (e: Exception) {
                Log.w("Rasp", "widget update failed", e)
            }
        }
    }

    // нужно только на Android 11 и ниже: там «срочная» задача запускается как foreground-сервис
    override suspend fun getForegroundInfo(): ForegroundInfo =
        ForegroundInfo(Notifier.SERVICE_ID, Notifier.serviceNotification(applicationContext))
}
