package com.antigravity.gateway

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat

/**
 * 手机系统级前台保活与悬浮球服务 (GatewayService)
 *
 * 1. 极简小圆圈悬浮球：支持边缘磁吸吸附、拖动、点击展开快捷菜单（刷新、主页、关闭）
 * 2. 前台常驻通知与 WakeLock，锁屏与后台不断流
 */
class GatewayService : Service() {

    private val CHANNEL_ID = "antigravity_keepalive_channel"
    private val NOTIFICATION_ID = 8790
    private var windowManager: WindowManager? = null
    private var floatingView: View? = null
    private var menuView: View? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var isMenuShowing = false

    override fun onBind(intent: Intent?): IBinder? = null

    @SuppressLint("WakelockTimeout")
    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildForegroundNotification())

        try {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Antigravity::KeepAliveLock")
            wakeLock?.acquire()
        } catch (e: Exception) {}

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && Settings.canDrawOverlays(this)) {
            showFloatingBubble()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && Settings.canDrawOverlays(this)) {
            if (floatingView == null) {
                showFloatingBubble()
            }
        }
        return START_STICKY
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Antigravity 网关常驻守护",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "保持反向代理网关持续运行，防止断流"
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildForegroundNotification(): Notification {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pi = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("⚡ Antigravity 网关运行中")
            .setContentText("点击返回控制台 · 悬浮窗可磁吸边缘")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pi)
            .setOngoing(true)
            .build()
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun showFloatingBubble() {
        if (floatingView != null) return

        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager

        val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 20
            y = 300
        }

        // 小圆圈外观 (48dp 蓝光微芒小球)
        val bg = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(Color.parseColor("#E60B1220"))
            setStroke(3, Color.parseColor("#38BDF8"))
        }

        val bubble = TextView(this).apply {
            text = "⚡"
            setTextColor(Color.parseColor("#38BDF8"))
            textSize = 16f
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, 0)
            background = bg
            elevation = 12f
            layoutParams = WindowManager.LayoutParams(110, 110)
        }

        floatingView = bubble

        var initialX = 0
        var initialY = 0
        var touchX = 0f
        var touchY = 0f
        var isClick = true

        bubble.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = params.x
                    initialY = params.y
                    touchX = event.rawX
                    touchY = event.rawY
                    isClick = true
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - touchX
                    val dy = event.rawY - touchY
                    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
                        isClick = false
                    }
                    params.x = initialX + dx.toInt()
                    params.y = initialY + dy.toInt()
                    windowManager?.updateViewLayout(floatingView, params)
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (isClick) {
                        toggleQuickMenu(params)
                    } else {
                        // 磁吸边缘 (吸附到左右两侧)
                        val displayMetrics = resources.displayMetrics
                        val screenWidth = displayMetrics.widthPixels
                        if (params.x < screenWidth / 2) {
                            params.x = 10
                        } else {
                            params.x = screenWidth - bubble.width - 10
                        }
                        windowManager?.updateViewLayout(floatingView, params)
                    }
                    true
                }
                else -> false
            }
        }

        try {
            windowManager?.addView(floatingView, params)
        } catch (e: Exception) {}
    }

    private fun toggleQuickMenu(bubbleParams: WindowManager.LayoutParams) {
        if (isMenuShowing) {
            removeQuickMenu()
            return
        }

        isMenuShowing = true
        val menuLayout = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            background = GradientDrawable().apply {
                cornerRadius = 999f
                setColor(Color.parseColor("#F2131C2E"))
                setStroke(2, Color.parseColor("#38BDF8"))
            }
            elevation = 16f
            setPadding(16, 10, 16, 10)
        }

        val btnOpen = TextView(this).createMenuButton("🏠 主页") {
            removeQuickMenu()
            val intent = Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            startActivity(intent)
        }

        val btnRefresh = TextView(this).createMenuButton("🔄 刷新") {
            removeQuickMenu()
            val intent = Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra("action", "refresh")
            }
            startActivity(intent)
        }

        val btnClose = TextView(this).createMenuButton("✕ 关闭") {
            removeQuickMenu()
            stopSelf()
        }

        menuLayout.addView(btnOpen)
        menuLayout.addView(btnRefresh)
        menuLayout.addView(btnClose)

        val menuParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = bubbleParams.x + 120
            y = bubbleParams.y
        }

        menuView = menuLayout
        try {
            windowManager?.addView(menuView, menuParams)
        } catch (e: Exception) {}
    }

    private fun TextView.createMenuButton(label: String, onClick: () -> Unit): TextView {
        text = label
        setTextColor(Color.WHITE)
        textSize = 13f
        setPadding(20, 10, 20, 10)
        setOnClickListener { onClick() }
        return this
    }

    private fun removeQuickMenu() {
        if (menuView != null) {
            try {
                windowManager?.removeView(menuView)
            } catch (e: Exception) {}
            menuView = null
        }
        isMenuShowing = false
    }

    override fun onDestroy() {
        super.onDestroy()
        removeQuickMenu()
        if (floatingView != null) {
            try {
                windowManager?.removeView(floatingView)
            } catch (e: Exception) {}
            floatingView = null
        }
        try {
            wakeLock?.release()
        } catch (e: Exception) {}
    }
}
