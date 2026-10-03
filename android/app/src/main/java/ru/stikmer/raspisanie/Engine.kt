package ru.stikmer.raspisanie

import android.annotation.SuppressLint
import android.content.Context
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONObject

/**
 * Запускает движок (assets/worker.html + engine.js + pdf.js) в невидимом WebView:
 * скачать страницу и PDF, разобрать, решить, какие уведомления показать.
 * Файлы движок сохраняет сам через Bridge.save, в ответ возвращает сводку.
 */
object Engine {
    @SuppressLint("SetJavaScriptEnabled")
    suspend fun run(ctx: Context, mode: String): JSONObject = withContext(Dispatchers.Main) {
        val app = ctx.applicationContext
        val input = JSONObject().put("cfg", Prefs.engineCfg(app)).put("mode", mode).toString()
        val result = CompletableDeferred<String>()
        val loader = Web.loader(app)
        val web = WebView(app)
        try {
            web.settings.javaScriptEnabled = true
            web.settings.domStorageEnabled = true
            web.settings.allowFileAccess = false
            web.settings.allowContentAccess = false
            web.webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    loader.shouldInterceptRequest(request.url)

                // системе не хватило памяти и она убила отрисовщик — завершаем проверку ошибкой, а не всё приложение
                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    result.completeExceptionally(RuntimeException("WebView renderer gone (crash=${detail.didCrash()})"))
                    return true
                }
            }
            web.webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                    Log.i("RaspJS", "${m.messageLevel()} ${m.message()} (${m.sourceId()}:${m.lineNumber()})")
                    return true
                }
            }
            web.addJavascriptInterface(object {
                @JavascriptInterface
                fun input(): String = input

                @JavascriptInterface
                fun save(name: String, text: String) = Prefs.writeData(app, name, text)

                @JavascriptInterface
                fun done(json: String) {
                    result.complete(json)
                }

                @JavascriptInterface
                fun fail(error: String) {
                    result.completeExceptionally(RuntimeException(error))
                }
            }, "Bridge")
            web.resumeTimers()
            web.loadUrl("${Web.ORIGIN}/assets/worker.html")
            JSONObject(withTimeout(180_000) { result.await() })
        } finally {
            web.stopLoading()
            web.destroy()
        }
    }
}
