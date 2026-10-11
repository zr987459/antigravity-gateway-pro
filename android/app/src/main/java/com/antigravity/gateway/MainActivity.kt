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
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.Button
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import java.util.UUID

/**
 * Antigravity Gateway Pro (本地独立版)
 *
 * 1. 严格专注于本地网关连接（默认 127.0.0.1:8790）
 * 2. 悬浮窗磁吸、极简小圆圈、快捷菜单（主页、刷新、关闭）
 * 3. 登录授权自动唤醒系统外部浏览器，杜绝 Google 403 拦截
 * 4. 支持在设置中自由更改端口与自定义/随机生成 API Key
 */
class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private val PREFS_NAME = "antigravity_local_prefs"
    private val KEY_PORT = "gateway_port"
    private val KEY_API_KEY = "gateway_api_key"
    private val DEFAULT_PORT = 8790

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
        settings.userAgentString = settings.userAgentString + " AntigravityGatewayApp/2.3"

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                if (url.contains("accounts.google.com") || url.contains("oauth2") || url.startsWith("http://localhost:51121")) {
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                        startActivity(intent)
                        return true
                    } catch (e: Exception) {}
                }
                return false
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
        loadLocalGatewayUrl()
        handleIntentAction(intent)
    }

    private fun ensureApiKeyExists() {
        val sp = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (sp.getString(KEY_API_KEY, null).isNullOrEmpty()) {
            val generatedKey = "antigravity_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12)
            sp.edit().putString(KEY_API_KEY, generatedKey).apply()
        }
    }

    private fun getGatewayPort(): Int {
        val sp = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return sp.getInt(KEY_PORT, DEFAULT_PORT)
    }

    private fun getApiKey(): String {
        val sp = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return sp.getString(KEY_API_KEY, "antigravity-local") ?: "antigravity-local"
    }

    private fun loadLocalGatewayUrl() {
        val port = getGatewayPort()
        val url = "http://127.0.0.1:$port"
        webView.loadUrl(url)
    }

    private fun handleIntentAction(intent: Intent?) {
        if (intent?.getStringExtra("action") == "refresh") {
            webView.reload()
            Toast.makeText(this, "已刷新本地网关", Toast.LENGTH_SHORT).show()
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
        val currentPort = getGatewayPort()
        val currentKey = getApiKey()

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 30, 40, 10)
        }

        val portInput = EditText(this).apply {
            setText(currentPort.toString())
            hint = "监听端口 (默认 8790)"
        }
        val keyInput = EditText(this).apply {
            setText(currentKey)
            hint = "API 密钥 (可点击下方随机生成)"
        }

        val btnGenerateKey = Button(this).apply {
            text = "🎲 随机生成新密钥"
            setOnClickListener {
                val newKey = "ag_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12)
                keyInput.setText(newKey)
            }
        }

        layout.addView(android.widget.TextView(this).apply { text = "本地网关端口：" })
        layout.addView(portInput)
        layout.addView(android.widget.TextView(this).apply { text = "API 密钥：" })
        layout.addView(keyInput)
        layout.addView(btnGenerateKey)

        AlertDialog.Builder(this)
            .setTitle("⚙ 本地网关参数配置")
            .setView(layout)
            .setPositiveButton("保存并重启连接") { _, _ =>
                val pStr = portInput.text.toString().trim()
                val kStr = keyInput.text.toString().trim()
                val port = pStr.toIntOrNull() ?: DEFAULT_PORT

                val sp = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                sp.edit()
                    .putInt(KEY_PORT, port)
                    .putString(KEY_API_KEY, kStr)
                    .apply()

                loadLocalGatewayUrl()
                Toast.makeText(this, "配置已更新：端口 $port", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("取消", null)
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
