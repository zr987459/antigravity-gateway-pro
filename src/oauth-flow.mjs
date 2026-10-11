/**
 * Permanent Google OAuth Callback Listener (RFC 8252)
 *
 * 核心修复：
 * 端口 51121 必须常驻保持监听（0.0.0.0:51121），绝不能在点击前是关闭状态！
 * 无论用户何时从浏览器跳回 localhost:51121/oauth-callback，服务端 100% 能够瞬间接住请求，
 * 绝不再报 ERR_CONNECTION_REFUSED！
 */

import http from 'http';
import {
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_CLIENT_SECRET,
  SCOPES,
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
} from './constants.mjs';

export class OAuthFlowManager {
  constructor(accountPool) {
    this.accountPool = accountPool;
    this.fixedPort = 51121;
    this.server = null;
    this.lastExchangedAccount = null;
    this.initPermanentListener();
  }

  getAuthUrl() {
    const redirectUri = `http://localhost:${this.fixedPort}/oauth-callback`;
    const authUrl = new URL(GOOGLE_AUTH_ENDPOINT);
    authUrl.searchParams.set('client_id', ANTIGRAVITY_CLIENT_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('include_granted_scopes', 'true');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', 'antigravity_' + Date.now());
    authUrl.searchParams.set('scope', SCOPES.join(' '));
    return authUrl.toString();
  }

  initPermanentListener() {
    if (this.server) return;

    this.server = http.createServer(async (req, res) => {
      // 支持 localhost:51121/oauth-callback
      const reqUrl = new URL(req.url, `http://localhost:${this.fixedPort}`);
      if (reqUrl.pathname === '/oauth-callback') {
        const code = reqUrl.searchParams.get('code');
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h3 style="color:#ef4444;text-align:center;margin-top:40px;">⚠ 授权失败：未收到 Google Code</h3>');
          return;
        }

        try {
          console.log('[OAuth Listener] 收到浏览器回调 Code，正在向 Google 换取离线 Token...');
          const redirectUri = `http://localhost:${this.fixedPort}/oauth-callback`;
          const tokenResult = await this.exchangeCode(code, redirectUri);

          if (this.accountPool && tokenResult.refreshToken && tokenResult.email) {
            this.accountPool.addAccount(tokenResult.refreshToken, tokenResult.email);
            this.lastExchangedAccount = tokenResult.email;
            console.log(`[OAuth Listener] 账号 ${tokenResult.email} 已成功激活并加入账号池！`);
          }

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html lang="zh-CN">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>授权成功</title>
              <style>
                body { background: #0b1120; color: #fff; font-family: -apple-system, sans-serif; text-align: center; padding: 40px 16px; }
                .box { max-width: 420px; margin: 0 auto; background: #1e293b; padding: 24px; border-radius: 12px; border: 1px solid #334155; }
                h2 { color: #22c55e; margin-bottom: 12px; }
                p { color: #94a3b8; font-size: 0.9rem; line-height: 1.6; }
                .email { color: #38bdf8; font-weight: bold; }
                .btn { display: inline-block; background: #38bdf8; color: #0b1120; padding: 12px 24px; border-radius: 8px; font-weight: bold; text-decoration: none; margin-top: 20px; }
              </style>
            </head>
            <body>
              <div class="box">
                <h2>🎉 Google 授权成功！</h2>
                <p>已成功获取离线令牌，账号 <span class="email">${tokenResult.email || 'Google'}</span> 已激活。</p>
                <p style="margin-top: 8px;">现在可以关闭本页面，返回控制台开始使用。</p>
                <a class="btn" href="http://127.0.0.1:8790">返回控制台</a>
              </div>
              <script>
                // 3秒后尝试自动跳回控制台
                setTimeout(() => { window.location.href = 'http://127.0.0.1:8790'; }, 2500);
              </script>
            </body>
            </html>
          `);
        } catch (err) {
          console.error('[OAuth Listener] 换票失败:', err.message);
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <body style="background:#0b1120;color:#fff;font-family:sans-serif;text-align:center;padding:40px 16px;">
              <h2 style="color:#ef4444;">⚠ 换取令牌失败</h2>
              <p style="color:#94a3b8;">${err.message}</p>
              <a href="http://127.0.0.1:8790" style="color:#38bdf8;margin-top:20px;display:inline-block;">返回控制台重试</a>
            </body>
          `);
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    this.server.on('error', (err) => {
      console.error('[OAuth Listener Error on 51121]:', err.message);
    });

    this.server.listen(this.fixedPort, '0.0.0.0', () => {
      console.log(`📡 Google OAuth 回调监听服务已常驻运行在 http://0.0.0.0:${this.fixedPort}`);
    });
  }

  async exchangeRawInput(rawInput) {
    let code = rawInput.trim();
    let redirectUri = `http://localhost:${this.fixedPort}/oauth-callback`;

    if (code.includes('code=')) {
      try {
        const u = new URL(code.startsWith('http') ? code : 'http://localhost/' + code);
        const extractedCode = u.searchParams.get('code');
        if (extractedCode) code = extractedCode;
      } catch (e) {
        const m = code.match(/code=([^&]+)/);
        if (m) code = decodeURIComponent(m[1]);
      }
    }

    return await this.exchangeCode(code, redirectUri);
  }

  async exchangeCode(code, redirectUri) {
    const params = new URLSearchParams({
      client_id: ANTIGRAVITY_CLIENT_ID,
      client_secret: ANTIGRAVITY_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });

    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google API 换票失败 (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const accessToken = data.access_token;
    const refreshToken = data.refresh_token;

    let email = '';
    try {
      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      if (userRes.ok) {
        const u = await userRes.json();
        email = u.email || '';
      }
    } catch (e) {}

    return {
      accessToken,
      refreshToken,
      email,
      expiresIn: data.expires_in || 3600,
    };
  }
}
