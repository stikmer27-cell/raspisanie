package ru.stikmer.raspisanie

import android.Manifest
import android.annotation.SuppressLint
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.HapticFeedbackConstants
import android.view.View
import android.webkit.ConsoleMessage
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.WindowCompat
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    companion object {
        /** Приложение на экране — обновление не ставим, чтобы не закрыть его посреди дела. */
        @Volatile
        var visible = false
    }

    private lateinit var web: WebView
    private var webDestroyed = false

    private val notifPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        js("settings")
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Prefs.setOpenDay(intent?.getStringExtra("day"))

        web = WebView(this)
        setContentView(web)
        applyBars()

        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.settings.textZoom = 100
        // без системных полос прокрутки и «растягивания» края — страница своя, как у обычного приложения
        web.isVerticalScrollBarEnabled = false
        web.isHorizontalScrollBarEnabled = false
        web.overScrollMode = View.OVER_SCROLL_NEVER
        // страница небольшая — отрисовываем её заранее целиком, чтобы прокрутка и анимации не дёргались
        web.settings.offscreenPreRaster = true
        val loader = Web.loader(this)
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == Uri.parse(Web.ORIGIN).host) return false
                openExternal(request.url)
                return true
            }

            // отрисовщик WebView убит системой (нехватка памяти) — пересоздаём экран вместо падения
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                Log.w("Rasp", "UI renderer gone, crash=${detail.didCrash()}")
                if (!webDestroyed) {
                    webDestroyed = true
                    (web.parent as? ViewGroup)?.removeView(web)
                    web.destroy()
                }
                recreate()
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                Log.i("RaspUI", "${m.messageLevel()} ${m.message()} (${m.sourceId()}:${m.lineNumber()})")
                return true
            }
        }
        web.addJavascriptInterface(Api(), "Android")
        web.loadUrl("${Web.ORIGIN}/assets/index.html")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("window.handleBack ? handleBack() : false") { handled ->
                    if (handled != "true") {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            }
        })

        askNotificationsOnce()
        Scheduler.ensure(this)
        // при открытии — заодно посмотреть, нет ли новой версии (не чаще раза в 10 минут)
        if (System.currentTimeMillis() - Prefs.updateCheckedAt(this) > 10 * 60 * 1000) Scheduler.update(this, "check")
    }

    override fun onStart() {
        super.onStart()
        visible = true
    }

    override fun onStop() {
        visible = false
        // скачанное обновление ставим, когда из приложения вышли (с запасом: вдруг сейчас вернутся)
        if (Prefs.pendingUpdatePath(this) != null) Scheduler.update(this, "install", delaySec = 20)
        super.onStop()
    }

    /** Цвет фона, строки состояния и навигации — под выбранную тему. */
    private fun applyBars() {
        val dark = Prefs.isDark(this)
        val bg = if (dark) 0xFF050507.toInt() else 0xFFF3F5FB.toInt()
        web.setBackgroundColor(bg)
        window.statusBarColor = bg
        window.navigationBarColor = bg
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        applyBars()
        js("settings") // тема «Авто» следует за системой
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra("day")?.let { js("open", it) }
    }

    override fun onResume() {
        super.onResume()
        Events.listener = { type, arg -> js(type, arg) }
        js("resume")
    }

    override fun onPause() {
        Events.listener = null
        // виджет читает весь файл расписания (~0,5 МБ) — не на главном потоке, чтобы выход из приложения не подтормаживал
        val app = applicationContext
        Thread { WidgetUpdater.updateAll(app) }.start()
        super.onPause()
    }

    override fun onDestroy() {
        if (::web.isInitialized && !webDestroyed) {
            webDestroyed = true
            web.destroy()
        }
        super.onDestroy()
    }

    private fun js(type: String, arg: String? = null) {
        if (!::web.isInitialized || webDestroyed) return
        val a = if (arg == null) "null" else JSONObject.quote(arg)
        web.evaluateJavascript("window.onNative && window.onNative(${JSONObject.quote(type)}, $a)", null)
    }

    private fun askNotificationsOnce() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        if (Prefs.askedNotifications(this)) return
        Prefs.setAskedNotifications(this)
        notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    private fun openExternal(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
            // нет браузера — ничего не делаем
        }
    }

    private fun openAppNotificationSettings() {
        val i = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
        try {
            startActivity(i)
        } catch (e: Exception) {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        }
    }

    /** То, что может вызвать страница: window.Android.* */
    inner class Api {
        @JavascriptInterface
        fun getConfig(): String = Prefs.configJson(this@MainActivity)

        /** Лёгкая вибрация при нажатии кнопки. */
        @JavascriptInterface
        fun haptic() = runOnUiThread { web.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY) }

        @JavascriptInterface
        fun takeOpenDay(): String? = Prefs.takeOpenDay()

        @JavascriptInterface
        fun setGroup(group: String) {
            Prefs.setGroup(this@MainActivity, group)
            WidgetUpdater.updateAll(this@MainActivity)
        }

        @JavascriptInterface
        fun setTheme(theme: String) {
            Prefs.setTheme(this@MainActivity, theme)
            runOnUiThread { applyBars() }
            WidgetUpdater.updateAll(this@MainActivity)
        }

        /** Поставить виджет на главный экран (лаунчер сам спросит подтверждение). */
        @JavascriptInterface
        fun pinWidget(): Boolean {
            val mgr = AppWidgetManager.getInstance(this@MainActivity)
            if (!mgr.isRequestPinAppWidgetSupported) return false
            return mgr.requestPinAppWidget(ComponentName(this@MainActivity, ScheduleWidget::class.java), null, null)
        }

        @JavascriptInterface
        fun setTimes(evening: String, morning: String) {
            Prefs.setTimes(this@MainActivity, evening, morning)
            runOnUiThread { Scheduler.scheduleAlarms(this@MainActivity) }
        }

        @JavascriptInterface
        fun refresh() = Scheduler.runNow(this@MainActivity, "manual")

        @JavascriptInterface
        fun testNotification() = Scheduler.runNow(this@MainActivity, "test")

        @JavascriptInterface
        fun checkUpdate() = Scheduler.update(this@MainActivity, "check")

        /** «Обновить сейчас»: поставить новую версию, не дожидаясь выхода из приложения. */
        @JavascriptInterface
        fun installUpdate() = Scheduler.update(this@MainActivity, "now")

        /** Один раз разрешить «Расписанию» ставить свои обновления — дальше они ставятся без вопросов. */
        @JavascriptInterface
        fun openInstallSettings() = runOnUiThread {
            try {
                startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
            } catch (e: Exception) {
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
            }
        }

        @JavascriptInterface
        fun requestNotifications() = runOnUiThread {
            // спросить системным окном можно, пока пользователь не отказал дважды; дальше — только через настройки
            val canAsk = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
                (!Prefs.askedNotifications(this@MainActivity) || shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS))
            if (canAsk) {
                Prefs.setAskedNotifications(this@MainActivity)
                notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else {
                openAppNotificationSettings()
            }
        }

        @SuppressLint("BatteryLife")
        @JavascriptInterface
        fun openBatterySettings() = runOnUiThread {
            try {
                startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
            } catch (e: Exception) {
                try {
                    startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                } catch (e2: Exception) {
                    openAppNotificationSettings()
                }
            }
        }

        @JavascriptInterface
        fun openUrl(url: String) = runOnUiThread { openExternal(Uri.parse(url)) }
    }
}
