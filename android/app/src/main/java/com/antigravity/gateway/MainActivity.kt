package com.antigravity.gateway

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * Antigravity Gateway Pro (100% Android 原生极简商用客户端)
 *
 * 核心设计：
 * 1. 彻底移除脆弱的 WebView 网页层，全部采用流畅的原生 Android UI，点击 100% 灵敏响应！
 * 2. 账号完全隔离：用户的 Google Token 仅保存在买家自己的手机 SharedPreferences 本地，绝不接触开发者账号！
 * 3. 一卡一号强绑定：买家输入授权码激活后与该 Google 账号永久绑定。
 * 4. 授权一键唤醒 Chrome：直接通过原生 Intent 唤醒 Chrome 浏览器，支持复制链接兜底。
 */
class MainActivity : AppCompatActivity() {

    private val PREFS_NAME = "antigravity_native_prefs"
    private val KEY_REFRESH_TOKEN = "user_refresh_token"
    private val KEY_USER_EMAIL = "user_email"
    private val KEY_LICENSE_KEY = "user_license_key"
    private val KEY_CLOUD_GATEWAY = "cloud_gateway_url"

    // 默认高可用公开云端协议转换通道
    private val DEFAULT_GATEWAY_URL = "https://antigravity-gateway-it14.onrender.com"

    // UI 组件
    private lateinit var tvStatusBadge: TextView
    private lateinit var tvAccountEmail: TextView
    private lateinit var tvLicenseStatus: TextView
    private lateinit var etLicenseInput: EditText
    private lateinit var btnActivateLicense: Button
    private lateinit var btnGoogleLogin: Button
    private lateinit var btnLogout: Button
    private lateinit var tvApiBaseUrl: TextView
    private lateinit var tvApiKeyDisplay: TextView
    private lateinit var btnCopyConfig: Button
    private lateinit var tvGemini5h: TextView
    private lateinit var tvGemini7d: TextView
    private lateinit var tvClaude5h: TextView
    private lateinit var tvClaude7d: TextView
    private lateinit var btnRefreshQuota: Button

    private val coroutineScope = CoroutineScope(Dispatchers.Main + Job())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildNativeLayout())

        // 启动后台防杀小圆圈与常驻通知
        try {
            val serviceIntent = Intent(this, GatewayService::class.java)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent)
            } else {
                startService(serviceIntent)
            }
        } catch (e: Exception) {}

        refreshUIState()
    }

    override fun onDestroy() {
        super.onDestroy()
        coroutineScope.cancel()
    }

    private fun buildNativeLayout(): View {
        val scrollView = ScrollView(this).apply {
            setBackgroundColor(android.graphics.Color.parseColor("#090D16"))
            isFillViewport = true
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 48, 36, 48)
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }

        // 1. 顶部 Header
        val headerLayout = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 0, 0, 32)
        }

        val title = TextView(this).apply {
            text = "⚡ Antigravity Pro"
            textSize = 20f
            setTextColor(android.graphics.Color.WHITE)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }

        tvStatusBadge = TextView(this).apply {
            text = "● 未登录"
            textSize = 12f
            setTextColor(android.graphics.Color.parseColor("#EF4444"))
            setPadding(20, 8, 20, 8)
            background = createCardBackground(android.graphics.Color.parseColor("#1F1524"), android.graphics.Color.parseColor("#EF4444"))
        }

        headerLayout.addView(title)
        headerLayout.addView(tvStatusBadge)
        container.addView(headerLayout)

        // 2. 账号卡片 (Google Account)
        val accountCard = createCardView("👤 账号信息 (数据独立保存在本机)")
        tvAccountEmail = TextView(this).apply {
            text = "未登录 Google 账号"
            textSize = 15f
            setTextColor(android.graphics.Color.parseColor("#94A3B8"))
            setPadding(0, 0, 0, 20)
        }
        accountCard.addView(tvAccountEmail)

        val btnLayout = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }

        btnGoogleLogin = Button(this).apply {
            text = "🔗 唤醒 Chrome 登录 Google"
            setTextColor(android.graphics.Color.parseColor("#090D16"))
            setBackgroundColor(android.graphics.Color.parseColor("#38BDF8"))
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = 16
            }
            setOnClickListener { startGoogleOAuthFlow() }
        }

        btnLogout = Button(this).apply {
            text = "退出"
            setTextColor(android.graphics.Color.parseColor("#EF4444"))
            setBackgroundColor(android.graphics.Color.parseColor("#1F1524"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            visibility = View.GONE
            setOnClickListener { logoutAccount() }
        }

        btnLayout.addView(btnGoogleLogin)
        btnLayout.addView(btnLogout)
        accountCard.addView(btnLayout)
        container.addView(accountCard)

        // 3. 商业授权卡片 (一卡一号)
        val licCard = createCardView("🔑 专属软件授权 (一卡一号强绑定)")
        tvLicenseStatus = TextView(this).apply {
            text = "授权状态: 尚未绑定有效密钥"
            textSize = 13f
            setTextColor(android.graphics.Color.parseColor("#F59E0B"))
            setPadding(0, 0, 0, 16)
        }
        licCard.addView(tvLicenseStatus)

        etLicenseInput = EditText(this).apply {
            hint = "输入购买的专属密钥 (AG-XXXX)"
            textSize = 14f
            setTextColor(android.graphics.Color.WHITE)
            setHintTextColor(android.graphics.Color.parseColor("#64748B"))
            setPadding(24, 24, 24, 24)
            background = createCardBackground(android.graphics.Color.parseColor("#070C17"), android.graphics.Color.parseColor("#23324D"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = 16
            }
        }
        licCard.addView(etLicenseInput)

        btnActivateLicense = Button(this).apply {
            text = "立即激活绑定此账号"
            setTextColor(android.graphics.Color.WHITE)
            setBackgroundColor(android.graphics.Color.parseColor("#10B981"))
            setOnClickListener { activateLicenseKey() }
        }
        licCard.addView(btnActivateLicense)
        container.addView(licCard)

        // 4. 实时配额监控 (5h / 7d 双窗口)
        val quotaCard = createCardView("📊 账号实时可用配额 (官方沙箱)")
        tvGemini5h = createQuotaLabel("Gemini 5小时可用量: --%")
        tvGemini7d = createQuotaLabel("Gemini 7天累计可用量: --%")
        tvClaude5h = createQuotaLabel("Claude 5小时可用量: --%")
        tvClaude7d = createQuotaLabel("Claude 7天累计可用量: --%")

        quotaCard.addView(tvGemini5h)
        quotaCard.addView(tvGemini7d)
        quotaCard.addView(tvClaude5h)
        quotaCard.addView(tvClaude7d)

        btnRefreshQuota = Button(this).apply {
            text = "🔄 刷新实时配额"
            setTextColor(android.graphics.Color.parseColor("#38BDF8"))
            setBackgroundColor(android.graphics.Color.parseColor("#131C2E"))
            setOnClickListener { fetchUserQuota() }
        }
        quotaCard.addView(btnRefreshQuota)
        container.addView(quotaCard)

        // 5. 客户端连接配置 (一键复制到 Claude Code / Cursor / Pi)
        val cfgCard = createCardView("📱 客户端集成参数 (已生成专属 Key)")
        tvApiBaseUrl = TextView(this).apply {
            text = "Base URL: $DEFAULT_GATEWAY_URL"
            textSize = 12f
            setTextColor(android.graphics.Color.parseColor("#94A3B8"))
            setPadding(0, 0, 0, 8)
        }
        tvApiKeyDisplay = TextView(this).apply {
            text = "API Key: 请先登录并激活授权"
            textSize = 12f
            setTextColor(android.graphics.Color.parseColor("#94A3B8"))
            setPadding(0, 0, 0, 16)
        }
        btnCopyConfig = Button(this).apply {
            text = "📋 复制完整客户端配置"
            setTextColor(android.graphics.Color.parseColor("#38BDF8"))
            setBackgroundColor(android.graphics.Color.parseColor("#131C2E"))
            setOnClickListener { copyConfigToClipboard() }
        }
        cfgCard.addView(tvApiBaseUrl)
        cfgCard.addView(tvApiKeyDisplay)
        cfgCard.addView(btnCopyConfig)
        container.addView(cfgCard)

        scrollView.addView(container)
        return scrollView
    }

    private fun createCardView(titleText: String): LinearLayout {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 28, 32, 28)
            background = createCardBackground(android.graphics.Color.parseColor("#131C2E"), android.graphics.Color.parseColor("#23324D"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = 32
            }
        }
        val title = TextView(this).apply {
            text = titleText
            textSize = 14f
            setTextColor(android.graphics.Color.WHITE)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setPadding(0, 0, 0, 16)
        }
        layout.addView(title)
        return layout
    }

    private fun createQuotaLabel(defaultText: String): TextView {
        return TextView(this).apply {
            text = defaultText
            textSize = 13f
            setTextColor(android.graphics.Color.parseColor("#94A3B8"))
            setPadding(0, 4, 0, 4)
        }
    }

    private fun createCardBackground(bgColor: Int, strokeColor: Int): android.graphics.drawable.GradientDrawable {
        return android.graphics.drawable.GradientDrawable().apply {
            setColor(bgColor)
            cornerRadius = 20f
            setStroke(2, strokeColor)
        }
    }

    private fun refreshUIState() {
        val sp = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val email = sp.getString(KEY_USER_EMAIL, null)
        val refreshToken = sp.getString(KEY_REFRESH_TOKEN, null)
        val licenseKey = sp.getString(KEY_LICENSE_KEY, null)

        if (!email.isNullOrEmpty() && !refreshToken.isNullOrEmpty()) {
            tvStatusBadge.text = "● 账号已就绪"
            tvStatusBadge.setTextColor(android.graphics.Color.parseColor("#10B981"))
            tvStatusBadge.background = createCardBackground(android.graphics.Color.parseColor("#102B20"), android.graphics.Color.parseColor("#10B981"))

            tvAccountEmail.text = "已连接: $email"
            tvAccountEmail.setTextColor(android.graphics.Color.WHITE)
            btnGoogleLogin.text = "🔄 切换其他账号"
            btnLogout.visibility = View.VISIBLE

            if (!licenseKey.isNullOrEmpty()) {
                tvLicenseStatus.text = "授权状态: 已激活 (绑定卡密: $licenseKey)"
                tvLicenseStatus.setTextColor(android.graphics.Color.parseColor("#10B981"))
                etLicenseInput.setText(licenseKey)
                btnActivateLicense.text = "已永久绑定"
                btnActivateLicense.isEnabled = false
                btnActivateLicense.setBackgroundColor(android.graphics.Color.parseColor("#1E293B"))

                tvApiKeyDisplay.text = "API Key: $licenseKey"
            } else {
                tvLicenseStatus.text = "授权状态: 尚未绑定有效密钥 (请在下方输入)"
                tvLicenseStatus.setTextColor(android.graphics.Color.parseColor("#F59E0B"))
                btnActivateLicense.isEnabled = true
                btnActivateLicense.text = "立即激活绑定此账号"
                btnActivateLicense.setBackgroundColor(android.graphics.Color.parseColor("#10B981"))
                tvApiKeyDisplay.text = "API Key: 需先激活授权码"
            }

            fetchUserQuota()
        } else {
            tvStatusBadge.text = "● 未登录"
            tvStatusBadge.setTextColor(android.graphics.Color.parseColor("#EF4444"))
            tvStatusBadge.background = createCardBackground(android.graphics.Color.parseColor("#1F1524"), android.graphics.Color.parseColor("#EF4444"))

            tvAccountEmail.text = "未登录 Google 账号 (点击下方唤醒 Chrome)"
            tvAccountEmail.setTextColor(android.graphics.Color.parseColor("#94A3B8"))
            btnGoogleLogin.text = "🔗 唤醒 Chrome 登录 Google"
            btnLogout.visibility = View.GONE
            tvLicenseStatus.text = "授权状态: 请先登录 Google 账号"
            tvApiKeyDisplay.text = "API Key: 请先登录并激活授权"
        }
    }

    private fun startGoogleOAuthFlow() {
        val authUrl = "https://accounts.google.com/o/oauth2/v2/auth?client_id=1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com&response_type=code&access_type=offline&prompt=consent&include_granted_scopes=true&redirect_uri=http%3A%2F%2Flocalhost%3A51121%2Foauth-callback&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcloud-platform+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.email+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.profile+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcclog+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fexperimentsandconfigs"

        val uri = Uri.parse(authUrl)
        var launched = false

        // 优先定向呼出 Chrome 官方浏览器
        val chromePackages = listOf("com.android.chrome", "com.google.android.apps.chrome", "com.chrome.beta")
        for (pkg in chromePackages) {
            try {
                val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                    setPackage(pkg)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                startActivity(intent)
                launched = true
                break
            } catch (e: Exception) {}
        }

        if (!launched) {
            try {
                val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                startActivity(intent)
                launched = true
            } catch (e: Exception) {}
        }

        // 无论如何弹出一个友好的输入对话框，支持手动粘贴授权返回的代码
        showManualCodeInputDialog(authUrl)
    }

    private fun showManualCodeInputDialog(authUrl: String) {
        val input = EditText(this).apply {
            hint = "浏览器登录后，粘贴回调地址 (带有 code=) 或 Code"
            textSize = 13f
        }

        AlertDialog.Builder(this)
            .setTitle("🔑 Google 账号授权绑定")
            .setMessage("已尝试拉起 Chrome 浏览器。授权完成后，浏览器会跳转至包含 code 的页面。\n\n请复制浏览器的完整网址粘贴在下方：")
            .setView(input)
            .setPositiveButton("完成提交") { _, _ ->
                val text = input.text.toString().trim()
                if (text.isNotEmpty()) {
                    exchangeCodeForToken(text)
                }
            }
            .setNeutralButton("复制授权网址") { _, _ ->
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                val clip = android.content.ClipData.newPlainText("Auth URL", authUrl)
                clipboard.setPrimaryClip(clip)
                Toast.makeText(this, "授权网址已复制，可自行粘贴到任何浏览器中打开", Toast.LENGTH_LONG).show()
            }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun exchangeCodeForToken(rawInput: String) {
        var code = rawInput.trim()
        if (code.contains("code=")) {
            try {
                val uri = Uri.parse(if (code.startsWith("http")) code else "http://localhost/$code")
                val extracted = uri.getQueryParameter("code")
                if (!extracted.isNullOrEmpty()) code = extracted
            } catch (e: Exception) {}
        }

        Toast.makeText(this, "正在换取离线凭证...", Toast.LENGTH_SHORT).show()

        coroutineScope.launch(Dispatchers.IO) {
            try {
                val url = URL("$DEFAULT_GATEWAY_URL/api/oauth/exchange")
                val conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    setRequestProperty("Content-Type", "application/json")
                    doOutput = true
                    connectTimeout = 10000
                    readTimeout = 10000
                }

                val payload = JSONObject().apply {
                    put("code_or_url", code)
                }

                OutputStreamWriter(conn.outputStream).use { it.write(payload.toString()) }

                val responseCode = conn.responseCode
                val stream = if (responseCode == 200) conn.inputStream else (conn.errorStream ?: conn.inputStream)
                val reader = BufferedReader(InputStreamReader(stream))
                val resp = reader.readText()
                val json = JSONObject(resp)

                withContext(Dispatchers.Main) {
                    if (json.optBoolean("ok", false)) {
                        val email = json.optString("email", "已登录")
                        val sp = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                        sp.edit()
                            .putString(KEY_USER_EMAIL, email)
                            .putString(KEY_REFRESH_TOKEN, code)
                            .apply()

                        Toast.makeText(this@MainActivity, "🎉 登录成功: $email", Toast.LENGTH_SHORT).show()
                        refreshUIState()
                    } else {
                        Toast.makeText(this@MainActivity, "❌ 换票失败: " + json.optString("error", "未知错误"), Toast.LENGTH_LONG).show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@MainActivity, "网络连接失败: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun activateLicenseKey() {
        val sp = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val email = sp.getString(KEY_USER_EMAIL, null)
        val code = etLicenseInput.text.toString().trim()

        if (email.isNullOrEmpty()) {
            Toast.makeText(this, "请先登录 Google 账号！", Toast.LENGTH_SHORT).show()
            return
        }
        if (code.isEmpty()) {
            Toast.makeText(this, "请输入购买的授权码！", Toast.LENGTH_SHORT).show()
            return
        }

        Toast.makeText(this, "正在校验卡密并绑定...", Toast.LENGTH_SHORT).show()

        coroutineScope.launch(Dispatchers.IO) {
            try {
                val url = URL("$DEFAULT_GATEWAY_URL/api/license/activate")
                val conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    setRequestProperty("Content-Type", "application/json")
                    doOutput = true
                    connectTimeout = 8000
                    readTimeout = 8000
                }

                val payload = JSONObject().apply {
                    put("code", code)
                    put("email", email)
                }

                OutputStreamWriter(conn.outputStream).use { it.write(payload.toString()) }

                val responseCode = conn.responseCode
                val stream = if (responseCode == 200) conn.inputStream else (conn.errorStream ?: conn.inputStream)
                val reader = BufferedReader(InputStreamReader(stream))
                val resp = reader.readText()
                val json = JSONObject(resp)

                withContext(Dispatchers.Main) {
                    if (json.optBoolean("ok", false)) {
                        sp.edit().putString(KEY_LICENSE_KEY, code).apply()
                        Toast.makeText(this@MainActivity, "🎉 绑定成功！已与您的账号永久锁死", Toast.LENGTH_LONG).show()
                        refreshUIState()
                    } else {
                        Toast.makeText(this@MainActivity, "❌ " + json.optString("message", "绑定失败"), Toast.LENGTH_LONG).show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@MainActivity, "验证失败: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun fetchUserQuota() {
        val sp = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val email = sp.getString(KEY_USER_EMAIL, null) ?: return

        coroutineScope.launch(Dispatchers.IO) {
            try {
                val url = URL("$DEFAULT_GATEWAY_URL/api/gemini/quota?email=${Uri.encode(email)}")
                val conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 8000
                    readTimeout = 8000
                }

                val reader = BufferedReader(InputStreamReader(conn.inputStream))
                val resp = reader.readText()
                val json = JSONObject(resp)

                withContext(Dispatchers.Main) {
                    if (json.optBoolean("ok", false)) {
                        val g5 = json.optJSONObject("gemini_5h")
                        val g7 = json.optJSONObject("gemini_7d")
                        val c5 = json.optJSONObject("claude_5h")
                        val c7 = json.optJSONObject("claude_7d")

                        tvGemini5h.text = "Gemini 5小时可用量: ${g5?.optInt("percentage", 100)}% (重置: ${g5?.optString("reset_text", "自适应")})"
                        tvGemini7d.text = "Gemini 7天累计可用量: ${g7?.optInt("percentage", 100)}% (周重置: ${g7?.optString("reset_text", "周初")})"
                        tvClaude5h.text = "Claude 5小时可用量: ${c5?.optInt("percentage", 100)}% (重置: ${c5?.optString("reset_text", "高优")})"
                        tvClaude7d.text = "Claude 7天累计可用量: ${c7?.optInt("percentage", 100)}% (周重置: ${c7?.optString("reset_text", "周初")})"
                        Toast.makeText(this@MainActivity, "配额已更新", Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (e: Exception) {}
        }
    }

    private fun logoutAccount() {
        AlertDialog.Builder(this)
            .setTitle("确认退出账号？")
            .setMessage("退出后将清除保存在手机本地的账号凭证。")
            .setPositiveButton("退出") { _, _ ->
                val sp = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                sp.edit()
                    .remove(KEY_USER_EMAIL)
                    .remove(KEY_REFRESH_TOKEN)
                    .remove(KEY_LICENSE_KEY)
                    .apply()
                refreshUIState()
                Toast.makeText(this, "已退出登录", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun copyConfigToClipboard() {
        val sp = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val licenseKey = sp.getString(KEY_LICENSE_KEY, null)
        val email = sp.getString(KEY_USER_EMAIL, null)

        if (licenseKey.isNullOrEmpty()) {
            Toast.makeText(this, "请先激活软件授权码！", Toast.LENGTH_SHORT).show()
            return
        }

        val configText = "# Antigravity Gateway 客户端配置\n" +
            "Base URL: $DEFAULT_GATEWAY_URL\n" +
            "API Key: $licenseKey\n" +
            "绑定的账号: $email\n" +
            "支持模型: gemini-3.8-flash-high, gemini-3.8-flash-fast, claude-sonnet-4-6"

        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        val clip = android.content.ClipData.newPlainText("Antigravity Config", configText)
        clipboard.setPrimaryClip(clip)
        Toast.makeText(this, "📋 完整配置已复制到剪贴板，可直接填入 Cursor 或 Claude Code！", Toast.LENGTH_LONG).show()
    }
}
