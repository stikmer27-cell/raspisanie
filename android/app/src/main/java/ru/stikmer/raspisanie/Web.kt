package ru.stikmer.raspisanie

import android.content.Context
import android.util.Base64
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.FileInputStream
import java.net.HttpURLConnection
import java.net.URL

// Всё содержимое WebView живёт на https://appassets.androidplatform.net:
//   /assets/...  — файлы интерфейса и движка из APK;
//   /data/...    — сохранённое расписание и состояние;
//   /net/<b64>   — скачивание с сайта колледжа (у страницы нет доступа к чужим сайтам из-за CORS).
object Web {
    const val ORIGIN = "https://appassets.androidplatform.net"
    private const val ALLOWED_HOST = "ci.nsu.ru"

    fun loader(ctx: Context): WebViewAssetLoader = WebViewAssetLoader.Builder()
        .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(ctx))
        .addPathHandler("/data/", DataHandler(ctx.applicationContext))
        .addPathHandler("/net/", NetHandler())
        .build()

    private fun response(code: Int, reason: String, type: String, body: ByteArray, extra: Map<String, String> = emptyMap()) =
        WebResourceResponse(type, "utf-8", code, reason, mapOf("Cache-Control" to "no-store") + extra, ByteArrayInputStream(body))

    private class DataHandler(private val ctx: Context) : WebViewAssetLoader.PathHandler {
        override fun handle(path: String): WebResourceResponse {
            val f = Prefs.dataFile(ctx, path)
            if (f == null || !f.isFile) return response(404, "Not Found", "application/json", ByteArray(0))
            return WebResourceResponse("application/json", "utf-8", 200, "OK", mapOf("Cache-Control" to "no-store"), FileInputStream(f))
        }
    }

    private class NetHandler : WebViewAssetLoader.PathHandler {
        override fun handle(path: String): WebResourceResponse {
            return try {
                val url = URL(String(Base64.decode(path, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP), Charsets.UTF_8))
                if (url.protocol != "https" || url.host != ALLOWED_HOST) {
                    return response(403, "Forbidden", "text/plain", ByteArray(0), mapOf("x-error" to "host"))
                }
                val conn = (url.openConnection() as HttpURLConnection).apply {
                    connectTimeout = 20_000
                    readTimeout = 45_000
                    instanceFollowRedirects = true
                    setRequestProperty("User-Agent", "Mozilla/5.0 (Android) Raspisanie-VKI")
                }
                try {
                    val code = conn.responseCode
                    if (code !in 200..299) {
                        return response(502, "Bad Gateway", "text/plain", ByteArray(0), mapOf("x-error" to "http-$code"))
                    }
                    val bytes = conn.inputStream.use { it.readBytes() }
                    val type = (conn.contentType ?: "application/octet-stream").substringBefore(';')
                    response(200, "OK", type, bytes)
                } finally {
                    conn.disconnect()
                }
            } catch (e: Exception) {
                response(502, "Bad Gateway", "text/plain", ByteArray(0), mapOf("x-error" to e.javaClass.simpleName))
            }
        }
    }
}
