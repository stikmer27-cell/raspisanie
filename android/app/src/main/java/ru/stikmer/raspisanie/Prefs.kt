package ru.stikmer.raspisanie

import android.content.Context
import android.os.PowerManager
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import java.io.File

/** Настройки и состояние приложения (SharedPreferences) + папка с данными. */
object Prefs {
    const val TIMEZONE = "Asia/Novosibirsk"
    private const val MORNING_UNTIL = "12:00"

    private fun sp(ctx: Context) = ctx.getSharedPreferences("cfg", Context.MODE_PRIVATE)

    /** Пусто, пока пользователь не вписал группу на первом экране. */
    fun group(ctx: Context): String = sp(ctx).getString("group", "") ?: ""
    fun evening(ctx: Context): String = sp(ctx).getString("evening", "20:00") ?: "20:00"
    fun morning(ctx: Context): String = sp(ctx).getString("morning", "07:00") ?: "07:00"

    fun setGroup(ctx: Context, g: String) = sp(ctx).edit().putString("group", g).apply()

    /** system | light | dark */
    fun theme(ctx: Context): String = sp(ctx).getString("theme", "system") ?: "system"
    fun setTheme(ctx: Context, t: String) {
        if (t in setOf("system", "light", "dark")) sp(ctx).edit().putString("theme", t).apply()
    }

    fun systemDark(ctx: Context): Boolean =
        (ctx.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
            android.content.res.Configuration.UI_MODE_NIGHT_YES

    fun isDark(ctx: Context): Boolean = when (theme(ctx)) {
        "dark" -> true
        "light" -> false
        else -> systemDark(ctx)
    }
    fun setTimes(ctx: Context, evening: String, morning: String) =
        sp(ctx).edit().putString("evening", evening).putString("morning", morning).apply()

    var running = false

    fun markOk(ctx: Context) =
        sp(ctx).edit().putLong("lastOk", System.currentTimeMillis()).remove("lastError").apply()

    fun markError(ctx: Context, msg: String?) =
        sp(ctx).edit().putString("lastError", (msg ?: "ошибка").take(300)).apply()

    fun askedNotifications(ctx: Context): Boolean = sp(ctx).getBoolean("askedNotif", false)
    fun setAskedNotifications(ctx: Context) = sp(ctx).edit().putBoolean("askedNotif", true).apply()

    // ---- автообновление
    fun updateCheckedAt(ctx: Context): Long = sp(ctx).getLong("updChecked", 0)
    fun setUpdateChecked(ctx: Context, latest: String?) = sp(ctx).edit()
        .putLong("updChecked", System.currentTimeMillis()).putString("updLatest", latest).remove("updError").apply()
    fun setUpdateError(ctx: Context, msg: String) = sp(ctx).edit().putString("updError", msg.take(200)).apply()
    fun setPendingUpdate(ctx: Context, name: String, code: Int, path: String, notes: String) = sp(ctx).edit()
        .putString("updName", name).putInt("updCode", code).putString("updPath", path).putString("updNotes", notes.take(1500)).apply()
    fun clearPendingUpdate(ctx: Context) =
        sp(ctx).edit().remove("updName").remove("updCode").remove("updPath").remove("updNotes").apply()
    fun pendingUpdateName(ctx: Context): String? = sp(ctx).getString("updName", null)
    fun pendingUpdateCode(ctx: Context): Int = sp(ctx).getInt("updCode", 0)
    fun pendingUpdatePath(ctx: Context): String? = sp(ctx).getString("updPath", null)
    fun pendingUpdateNotes(ctx: Context): String = sp(ctx).getString("updNotes", "") ?: ""

    private fun updateJson(ctx: Context): JSONObject {
        val p = sp(ctx)
        return JSONObject()
            .put("enabled", Updater.enabled)
            .put("busy", Updater.busy)
            .put("checked", if (p.contains("updChecked")) p.getLong("updChecked", 0) else JSONObject.NULL)
            .put("latest", p.getString("updLatest", null) ?: JSONObject.NULL)
            .put("error", p.getString("updError", null) ?: JSONObject.NULL)
            .put("pending", pendingUpdateName(ctx)?.takeIf { pendingUpdateCode(ctx) > Updater.currentCode() } ?: JSONObject.NULL)
            .put("notes", pendingUpdateNotes(ctx))
    }

    private var openDay: String? = null
    fun setOpenDay(day: String?) { openDay = day }
    fun takeOpenDay(): String? = openDay.also { openDay = null }

    /** Настройки для движка (engine.js / decide). */
    fun engineCfg(ctx: Context): JSONObject = JSONObject()
        .put("group", group(ctx))
        .put("evening_time", evening(ctx))
        .put("morning_time", morning(ctx))
        .put("morning_until", MORNING_UNTIL)
        .put("timezone", TIMEZONE)

    /** Всё, что нужно интерфейсу. */
    fun configJson(ctx: Context): String {
        val p = sp(ctx)
        val power = ctx.getSystemService(PowerManager::class.java)
        val version = try {
            ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: ""
        } catch (e: Exception) {
            ""
        }
        return engineCfg(ctx)
            .put("notifications", NotificationManagerCompat.from(ctx).areNotificationsEnabled())
            .put("battery", power?.isIgnoringBatteryOptimizations(ctx.packageName) ?: true)
            .put("lastOk", if (p.contains("lastOk")) p.getLong("lastOk", 0) else JSONObject.NULL)
            .put("lastError", p.getString("lastError", null) ?: JSONObject.NULL)
            .put("running", running)
            .put("version", version)
            .put("theme", theme(ctx))
            .put("systemDark", systemDark(ctx))
            .put("update", updateJson(ctx))
            .toString()
    }

    fun dataDir(ctx: Context): File = File(ctx.filesDir, "data").apply { mkdirs() }

    private val FILES = setOf("schedule.json", "cache.json", "state.json")

    fun dataFile(ctx: Context, name: String): File? =
        if (name in FILES) File(dataDir(ctx), name) else null

    /** Запись через временный файл, чтобы при сбое не остался обрезанный JSON. */
    fun writeData(ctx: Context, name: String, text: String) {
        val f = dataFile(ctx, name) ?: return
        val tmp = File(f.parentFile, "$name.tmp")
        tmp.writeText(text, Charsets.UTF_8)
        if (!tmp.renameTo(f)) {
            f.delete()
            tmp.renameTo(f)
        }
    }
}
