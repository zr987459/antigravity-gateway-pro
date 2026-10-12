package com.antigravity.gateway

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.KeyEvent
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import java.util.UUID

/**
 * Antigravity Gateway Pro
 *
 * 1. 默认开箱即用直连云端免部署通道，也可随时一键切回本地 127.0.0.1:8790
 * 2. 磁吸边缘极简蓝光小圆圈悬浮球 (⚡)，点击呼出快捷菜单（主页、刷新、关闭）
 * 3. Google OAuth 自动唤醒系统外部浏览器，彻底解决 403 disallowed_user_agent
 * 4. 支持 API 密钥与网关地址自由配置
 */
class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private val PREFS_NAME = "antigravity_pro_prefs"
    private val KEY_GATEWAY_URL = "gateway_url"
    private val KEY_API_KEY = "gateway_api_key"
    private val DEFAULT_CLOUD_URL = "https://antigravity-gateway-it14.onrender.com"
    private val LOCAL_GATEWAY_URL = "http://127.0.0.1:8790"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        startKeepAliveService()
        checkOverlayAndBatteryPermissions()
        ensureApiKeyExists()

        val rootLayout = FrameLayout(this)

        webView = WebView(this)
        val webParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        )
        rootLayout.addView(webView, webParams)

        val settings: WebSettings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.loadWithOverviewMode = true
        settings.useWideViewPort = true
        settings.allowFileAccess = false
        settings.databaseEnabled = true
        settings.cacheMode = WebSettings.LOAD_NO_CACHE
        settings.userAgentString = settings.userAgentString + " AntigravityGatewayApp/2.4"

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                // Google 授权登录或外部 OAuth 链接强制交由系统外部浏览器打开
                if (url.contains("accounts.google.com") || url.contains("oauth2") || url.startsWith("http://localhost:51121")) {
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                        startActivity(intent)
                        return true
                    } catch (e: Exception) {}
                }
                return false
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                super.onReceivedError(view, request, error)
            }
        }

        // 右下角悬浮设置按钮
        val fab = ImageView(this).apply {
            setImageResource(android.R.drawable.ic_menu_preferences)
            alpha = 0.5f
            setPadding(20, 20, 20, 20)
            setOnClickListener { showSettingsDialog() }
        }
        val fabParams = FrameLayout.LayoutParams(120, 120).apply {
            gravity = android.view.Gravity.BOTTOM or android.view.Gravity.END
            bottomMargin = 40
            rightMargin = 30
        }
        rootLayout.addView(fab, fabParams)

        setContentView(rootLayout)
        loadGatewayUrl()
        handleIntentAction(intent)
    }

    private fun ensureApiKeyExists() {
        val sp = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (sp.getString(KEY_API_KEY, null).isNullOrEmpty()) {
            val generatedKey = "ag_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12)
            sp.edit().putString(KEY_API_KEY, generatedKey).apply()
        }
    }

    private fun getGatewayUrl(): String {
        val sp = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return sp.getString(KEY_GATEWAY_URL, DEFAULT_CLOUD_URL) ?: DEFAULT_CLOUD_URL
    }

    private fun getApiKey(): String {
        val sp = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return sp.getString(KEY_API_KEY, "antigravity-client") ?: "antigravity-client"
    }

    private fun loadGatewayUrl() {
        val url = getGatewayUrl()
        webView.loadUrl(url)
    }

    private fun saveAndLoadUrl(newUrl: String) {
        val sp = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        sp.edit().putString(KEY_GATEWAY_URL, newUrl).apply()
        webView.loadUrl(newUrl)
        Toast.makeText(this, "已连接网关: $newUrl", Toast.LENGTH_SHORT).show()
    }

    private fun handleIntentAction(intent: Intent?) {
        if (intent?.getStringExtra("action") == "refresh") {
            webView.reload()
            Toast.makeText(this, "已刷新控制台", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntentAction(intent)
    }

    private fun startKeepAliveService() {
        val intent = Intent(this, GatewayService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun checkOverlayAndBatteryPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            val sp = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            if (!sp.getBoolean("asked_overlay", false)) {
                sp.edit().putBoolean("asked_overlay", true).apply()
                try {
                    val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))
                    startActivity(intent)
                } catch (e: Exception) {}
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                try {
                    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:$packageName")
                    }
                    startActivity(intent)
                } catch (e: Exception) {}
            }
        }
    }

    private fun showSettingsDialog() {
        val currentUrl = getGatewayUrl()
        val currentKey = getApiKey()

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 30, 40, 10)
        }

        val urlInput = EditText(this).apply {
            setText(currentUrl)
            hint = "网关服务地址 (http:// 或 https://)"
        }
        val keyInput = EditText(this).apply {
            setText(currentKey)
            hint = "API 密钥"
        }

        val btnGenerateKey = Button(this).apply {
            text = "🎲 随机生成新密钥"
            setOnClickListener {
                val newKey = "ag_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12)
                keyInput.setText(newKey)
            }
        }

        layout.addView(TextView(this).apply { text = "网关服务地址 (默认免部署云端通道)：" })
        layout.addView(urlInput)
        layout.addView(TextView(this).apply { text = "API 密钥：" })
        layout.addView(keyInput)
        layout.addView(btnGenerateKey)

        AlertDialog.Builder(this)
            .setTitle("⚙ 网关连接配置")
            .setView(layout)
            .setPositiveButton("保存并连接") { _, _ ->
                val uStr = urlInput.text.toString().trim()
                val kStr = keyInput.text.toString().trim()
                val targetUrl = if (uStr.isNotEmpty()) uStr else DEFAULT_CLOUD_URL

                val sp = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                sp.edit()
                    .putString(KEY_GATEWAY_URL, targetUrl)
                    .putString(KEY_API_KEY, kStr)
                    .apply()

                saveAndLoadUrl(targetUrl)
            }
            .setNeutralButton("切回本地 8790") { _, _ ->
                saveAndLoadUrl(LOCAL_GATEWAY_URL)
            }
            .setNegativeButton("切回免配置云端") { _, _ ->
                saveAndLoadUrl(DEFAULT_CLOUD_URL)
            }
            .show()
    }

    override fun onResume() {
        super.onResume()
        startKeepAliveService()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }
}
