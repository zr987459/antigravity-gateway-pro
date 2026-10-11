# Antigravity Gateway (轻量本地 AI 反向代理)

专为本地与移动端（Android / Termux / PRoot）打造的 Google Antigravity (Cloud Code) 兼容反向代理网关。
零外部授权码、零第三方服务器依赖，100% 本地开源运行。

---

## 🌟 核心特性

1. **完全开源、自主可控**：无需任何第三方卡密或付费验证，直连 Google 官方 OAuth 接口。
2. **Anthropic 协议完全兼容**：完美支持 Claude Code、Pi 编码代理等客户端，暴露标准 `/v1/messages` 接口。
3. **思考签名（Thought Signature）持久化**：内置签名 LRU 缓存，彻底解决多轮工具调用（Tool Use）和深度思考报 400 错误的痛点。
4. **移动端保活管理**：配套 Android 原生 APK 容器，支持桌面磁吸悬浮球、常驻前台服务，防止后台休眠。
5. **灵活的端口与密钥**：支持自定义监听端口与本地 API 密钥一键生成。

---

## 📦 项目架构与文件说明

```tree
antigravity-gateway/
├── src/
│   ├── server.mjs          # 主 HTTP 服务端（端口 8790 / 自定义端口）
│   ├── cloudcode.mjs       # Google Antigravity / Cloud Code 请求封装与模型映射
│   ├── content-converter.mjs # Anthropic ↔ Google 协议内容转换与多轮对话处理
│   ├── sse-streamer.mjs    # SSE 实时流式输出转换（支持 Thinking 思考块与签名增量）
│   ├── signature-cache.mjs # 思考签名缓存管理
│   ├── account-pool.mjs    # 多账号池管理与配额轮询
│   └── dashboard.html      # 响应式可视化控制台页面
├── android/                # Android 原生客户端源码 (Kotlin / WebView / KeepAlive)
└── Dockerfile              # 容器化部署配置
```

---

## 🚀 快速上手指南

### 1. 部署与启动网关 (Node.js / Termux)

确保环境中已安装 Node.js (>= 18)：

```bash
# 克隆或进入项目目录
cd antigravity-gateway

# 安装依赖
npm install

# 启动网关服务 (默认端口 8790)
node src/server.mjs
```

### 2. 添加 Google 账号与授权

1. 打开浏览器访问 `http://127.0.0.1:8790` 进入可视化控制台。
2. 点击 **“添加账号”** 或完成 Google OAuth 授权，获取并存入 `refresh_token`。
3. 或者直接通过 API 添加账号：
   ```bash
   curl -X POST http://127.0.0.1:8790/api/auth/token \
     -H "Content-Type: application/json" \
     -d '{"refresh_token": "你的Google_Refresh_Token", "email": "your_email@gmail.com"}'
   ```

### 3. 在 AI 客户端中使用

* **Base URL**: `http://127.0.0.1:8790`
* **API Key**: 可以在控制台或 Android App 设置中自定义或随机生成
* **可用模型**: 
  * `gemini-3.8-flash-high` (高智能思考模式)
  * `gemini-3.8-flash-fast` (极速秒出字模式)
  * `claude-sonnet-4-6`

---

## 📱 Android 客户端安装与使用

如果你想在 Android 手机（Termux / PRoot / 后台常驻）上搭配管理：
1. 在 GitHub 仓库的 **Releases** 或 **Actions** 中下载 `AntigravityGateway-Debug.apk` 并安装。
2. 打开 App 后，可点击右下角 **设置** 按钮：
   * 自定义修改本地网关端口。
   * 一键随机生成安全的 API 密钥。
3. 悬浮窗功能：
   * 首次启动会引导开启**桌面悬浮窗权限**与**电池优化白名单**。
   * 屏幕上会出现一个极简蓝光小圆圈 `⚡`，支持**拖动与边缘磁吸**。
   * 点击小圆圈可展开快捷菜单：**🏠 主页**、**🔄 刷新**、**✕ 关闭**。

---

## 🛠 编译 Android APK

如果你希望在本地或 GitHub Actions 中自行打包 APK：

```bash
cd android
./gradlew assembleDebug
# 生成的 APK 位于 android/app/build/outputs/apk/debug/app-debug.apk
```
