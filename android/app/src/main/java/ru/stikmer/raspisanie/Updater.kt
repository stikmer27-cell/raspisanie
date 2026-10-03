package ru.stikmer.raspisanie

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.IntentCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Автообновление из релизов репозитория на GitHub (открытого — без ключей и входа).
 *
 * Раз в несколько часов (и при открытии приложения) смотрим последний релиз; если он новее —
 * скачиваем APK, проверяем (тот же пакет, та же подпись, контрольная сумма) и ставим через
 * PackageInstaller. На Android 12+ приложение обновляет само себя без вопросов; на старых —
 * система один раз спросит «Обновить?». Пока приложение открыто, не перебиваем: ставим, когда
 * из него выйдут (или по кнопке «Обновить»).
 *
 * Чужой APK не встанет: Android принимает обновление только с той же подписью, что у установленного.
 */
object Updater {
    private const val TAG = "RaspUpd"
    const val ACTION_STATUS = "ru.stikmer.raspisanie.UPDATE_STATUS"

    val enabled: Boolean get() = BuildConfig.UPDATE_REPO.isNotEmpty()

    @Volatile
    var busy = false

    class Release(val code: Int, val name: String, val url: String, val size: Long, val sha256: String?, val notes: String)

    private fun open(url: String): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 20_000
            readTimeout = 60_000
            instanceFollowRedirects = false
            setRequestProperty("User-Agent", "raspisanie-android")
            setRequestProperty("Accept", "application/vnd.github+json")
        }

    /** Последний релиз с APK. */
    fun latest(): Release? {
        val c = open("https://api.github.com/repos/${BuildConfig.UPDATE_REPO}/releases/latest")
        try {
            when (val code = c.responseCode) {
                200 -> {}
                404 -> return null // релизов пока нет
                403, 429 -> throw IOException("GitHub просит подождать (слишком много проверок)")
                else -> throw IOException("GitHub ответил кодом $code")
            }
            val j = JSONObject(c.inputStream.bufferedReader().use { it.readText() })
            val tag = j.optString("tag_name")
            val num = Regex("(\\d+)$").find(tag)?.value?.toIntOrNull() ?: return null
            val assets = j.optJSONArray("assets") ?: return null
            val apk = (0 until assets.length()).map { assets.getJSONObject(it) }
                .firstOrNull { it.optString("name").let { n -> n.startsWith("raspisanie-") && n.endsWith(".apk") } } ?: return null
            val digest = apk.optString("digest").removePrefix("sha256:").takeIf { it.length == 64 }
            val url = apk.optString("browser_download_url").takeIf { it.startsWith("https://github.com/") } ?: return null
            return Release(num, tag.removePrefix("v"), url, apk.optLong("size"), digest, j.optString("body").trim())
        } finally {
            c.disconnect()
        }
    }

    private fun download(r: Release, dest: File) {
        // github.com отправляет на хранилище файлов (обычно одна-две переадресации), только https
        var c = open(r.url)
        var code = c.responseCode
        var hops = 0
        while (code in 300..399 && hops++ < 5) {
            val location = c.getHeaderField("Location") ?: throw IOException("нет ссылки на APK")
            c.disconnect()
            if (!location.startsWith("https://")) throw IOException("небезопасная ссылка на APK")
            c = open(location)
            code = c.responseCode
        }
        try {
            if (code != 200) throw IOException("APK не скачался (код $code)")
            val tmp = File(dest.path + ".part")
            val md = MessageDigest.getInstance("SHA-256")
            c.inputStream.use { input ->
                tmp.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        md.update(buf, 0, n)
                        out.write(buf, 0, n)
                    }
                }
            }
            if (r.size > 0 && tmp.length() != r.size) throw IOException("APK скачался не полностью")
            val hex = md.digest().joinToString("") { "%02x".format(it) }
            if (r.sha256 != null && !hex.equals(r.sha256, ignoreCase = true)) throw IOException("контрольная сумма APK не совпала")
            if (!tmp.renameTo(dest)) throw IOException("не удалось сохранить APK")
        } finally {
            c.disconnect()
        }
    }

    @Suppress("DEPRECATION")
    private fun signatures(p: PackageInfo?): Set<String> {
        val sigs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) p?.signingInfo?.apkContentsSigners else p?.signatures
        val md = MessageDigest.getInstance("SHA-256")
        return sigs.orEmpty().map { s -> md.digest(s.toByteArray()).joinToString("") { "%02x".format(it) } }.toSet()
    }

    @Suppress("DEPRECATION")
    private fun versionCode(p: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) p.longVersionCode else p.versionCode.toLong()

    /** Скачанный файл — точно наше приложение, новее текущего и подписано тем же ключом. */
    @Suppress("DEPRECATION")
    private fun verify(ctx: Context, file: File) {
        val pm = ctx.packageManager
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val apk = pm.getPackageArchiveInfo(file.path, flags) ?: throw IOException("скачанный файл — не APK")
        val mine = pm.getPackageInfo(ctx.packageName, flags)
        if (apk.packageName != ctx.packageName) throw IOException("в APK другое приложение")
        if (versionCode(apk) <= versionCode(mine)) throw IOException("APK не новее установленного")
        val theirs = signatures(apk)
        // если система не отдала подписи архива (бывает на Android 9) — подпись всё равно проверит установщик
        if (theirs.isNotEmpty() && theirs != signatures(mine)) throw IOException("APK подписан чужим ключом")
    }

    fun currentCode(): Int = BuildConfig.VERSION_CODE

    private fun dir(ctx: Context) = File(ctx.cacheDir, "update").apply { mkdirs() }

    /**
     * Проверить и, если есть новая версия, скачать. Ставит сразу, если приложение не на экране.
     * Возвращает: off | latest | ready | installing.
     */
    suspend fun run(ctx: Context, installNow: Boolean): String = withContext(Dispatchers.IO) {
        if (!enabled) return@withContext "off"
        busy = true
        Events.emit("settings")
        try {
            val r = latest()
            Prefs.setUpdateChecked(ctx, r?.name)
            if (r == null || r.code <= currentCode()) {
                Prefs.clearPendingUpdate(ctx)
                dir(ctx).listFiles()?.forEach { it.delete() }
                return@withContext "latest"
            }
            val apk = File(dir(ctx), "raspisanie-${r.name}.apk")
            if (!apk.isFile || (r.size > 0 && apk.length() != r.size)) {
                dir(ctx).listFiles()?.forEach { it.delete() }
                Log.i(TAG, "downloading ${r.name}")
                download(r, apk)
            }
            verify(ctx, apk)
            Prefs.setPendingUpdate(ctx, r.name, r.code, apk.path, r.notes)
            if (MainActivity.visible && !installNow) {
                Events.emit("settings")
                return@withContext "ready"
            }
            install(ctx)
            "installing"
        } catch (e: Exception) {
            Log.w(TAG, "update failed", e)
            Prefs.setUpdateError(ctx, e.message ?: e.javaClass.simpleName)
            throw e
        } finally {
            busy = false
            Events.emit("settings")
        }
    }

    /** Поставить уже скачанную версию. Пока идёт проверка расписания — дождаться её. */
    suspend fun install(ctx: Context) {
        val path = Prefs.pendingUpdatePath(ctx) ?: return
        val file = File(path)
        if (!file.isFile) {
            Prefs.clearPendingUpdate(ctx)
            return
        }
        // установка уже запущена (например, система сейчас спрашивает «Обновить?») — второй раз не начинаем
        if (System.currentTimeMillis() - lastCommit < 120_000) return
        CheckWorker.lock.withLock {
            withContext(Dispatchers.IO) { commit(ctx, file) }
            lastCommit = System.currentTimeMillis()
        }
    }

    @Volatile
    private var lastCommit = 0L

    private fun commit(ctx: Context, file: File) {
        Log.i(TAG, "installing ${file.name}")
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(ctx.packageName)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { s ->
            file.inputStream().use { input ->
                s.openWrite("base.apk", 0, file.length()).use { out ->
                    input.copyTo(out)
                    s.fsync(out)
                }
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
            val status = PendingIntent.getBroadcast(ctx, 11,
                Intent(ctx, UpdateReceiver::class.java).setAction(ACTION_STATUS), flags)
            s.commit(status.intentSender)
        }
    }

    /** Новая версия запустилась после обновления: сообщить и убрать скачанный файл. */
    fun onUpdated(ctx: Context) {
        val name = Prefs.pendingUpdateName(ctx)
        val code = Prefs.pendingUpdateCode(ctx)
        val notes = Prefs.pendingUpdateNotes(ctx)
        if (name != null && code == currentCode()) Notifier.updated(ctx, name, notes)
        Prefs.clearPendingUpdate(ctx)
        dir(ctx).listFiles()?.forEach { it.delete() }
    }
}

/** Ответ установщика: готово / нужно подтверждение / ошибка. */
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        Log.i("RaspUpd", "install status $status ${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)}")
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                // старый Android или прошивка с ограничениями: система спросит «Обновить?»
                val confirm = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent::class.java) ?: return
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                if (MainActivity.visible) {
                    try {
                        ctx.startActivity(confirm)
                        return
                    } catch (e: Exception) {
                        Log.w("RaspUpd", "confirm activity", e)
                    }
                }
                Notifier.updateNeedsTap(ctx, confirm, Prefs.pendingUpdateName(ctx) ?: "")
            }
            PackageInstaller.STATUS_SUCCESS -> {} // дальше — MY_PACKAGE_REPLACED в новой версии
            else -> {
                val msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "код $status"
                Prefs.setUpdateError(ctx, if (status == PackageInstaller.STATUS_FAILURE_ABORTED) "установку отменили" else "не установилось: $msg")
                Events.emit("settings")
            }
        }
    }
}

/** Фоновая проверка обновлений (mode = check) или установка скачанного (mode = install). */
class UpdateWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val ctx = applicationContext
        return try {
            when (inputData.getString("mode")) {
                "install" -> if (!MainActivity.visible) Updater.install(ctx)
                "now" -> Updater.run(ctx, installNow = true)
                else -> Updater.run(ctx, installNow = false)
            }
            Result.success()
        } catch (e: Exception) {
            if (runAttemptCount < 2) Result.retry() else Result.success()
        }
    }
}
