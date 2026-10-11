/**
 * Antigravity Advanced Local Gateway Server (v2.2)
 *
 * 针对长上下文多轮工具调用、思考签名 (Thought Signature) 与错误追踪全面加固
 */

import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { AccountPool } from './account-pool.mjs';
import { signatureCache } from './signature-cache.mjs';
import { OAuthFlowManager } from './oauth-flow.mjs';
import { runConnectivityTest } from './test-runner.mjs';
import { fetchRealQuota } from './quota-fetcher.mjs';
import { getModelsResponse } from './models-catalog.mjs';
import { statsTracker } from './stats.mjs';
import { ANTIGRAVITY_ENDPOINTS } from './constants.mjs';
import {
  buildAntigravityHeaders,
  buildCloudCodePayload,
  MODEL_FALLBACK_CHAINS,
} from './cloudcode.mjs';
import { convertGoogleToAnthropic } from './content-converter.mjs';
import { handleStreamConversion } from './sse-streamer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8790;
const accountPool = new AccountPool(path.join(__dirname, '..', 'data', 'accounts'));
const oauthFlowManager = new OAuthFlowManager(accountPool);
const dashboardHtmlPath = path.join(__dirname, 'dashboard.html');

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // 1. 移动端可视化控制台 (Web Dashboard)
  if (url.pathname === '/' || url.pathname === '/index.html') {
    if (fs.existsSync(dashboardHtmlPath)) {
      const html = fs.readFileSync(dashboardHtmlPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
  }

  // 1.5 下载最新 APK 安装包
  if (url.pathname === '/download' || url.pathname === '/apk') {
    const apkPath = '/root/AntigravityGateway.apk';
    if (fs.existsSync(apkPath)) {
      const stats = fs.statSync(apkPath);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Disposition': 'attachment; filename="AntigravityGateway.apk"',
        'Content-Length': stats.size,
      });
      const fsStream = fs.createReadStream(apkPath);
      fsStream.pipe(res);
      return;
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('APK not found locally.');
      return;
    }
  }

  // 2. 统计数据与运行日志接口
  if (url.pathname === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(statsTracker.getStats(), null, 2));
    return;
  }

  if (url.pathname === '/api/stats/trend') {
    const mode = url.searchParams.get('mode') || '24h';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(statsTracker.getTrendData(mode), null, 2));
    return;
  }

  if (url.pathname === '/api/logs') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(statsTracker.getLogs(), null, 2));
    return;
  }

  if (url.pathname === '/api/logs/clear' && req.method === 'POST') {
    statsTracker.clearLogs();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // 3. 模型列表接口 (供 Agent 自动拉取)
  if (url.pathname === '/v1/models' || url.pathname === '/models' || url.pathname === '/api/models') {
    const catalog = getModelsResponse();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(catalog, null, 2));
    return;
  }

  // 4. 服务状态与全局指标
  if (url.pathname === '/api/status' || url.pathname === '/health') {
    const activeMgr = accountPool.getActiveManager();
    const status = {
      app: 'antigravity-gateway',
      version: '2.2.0',
      port: PORT,
      auth_url: oauthFlowManager.getAuthUrl(),
      active_account: activeMgr ? activeMgr.getStatus() : null,
      accounts: accountPool.getAllStatus(),
      stats: statsTracker.getStats(),
      signature_cache_size: signatureCache.size(),
      license_required: false,
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status, null, 2));
    return;
  }

  // 5. 一键出字与连通性测试
  if (url.pathname === '/api/gemini/test' && req.method === 'POST') {
    const activeMgr = accountPool.getActiveManager();
    const testResult = await runConnectivityTest(activeMgr, accountPool);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(testResult));
    return;
  }

  // 6. 获取授权链接接口
  if (url.pathname === '/api/gemini/auth' && req.method === 'POST') {
    const authUrl = oauthFlowManager.getAuthUrl();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      auth_url: authUrl,
      message: '授权链接已就绪',
    }));
    return;
  }

  // 7. 手动粘贴回调网址或 Code 换票入池
  if (url.pathname === '/api/oauth/exchange' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      try {
        const { code_or_url } = JSON.parse(body);
        if (!code_or_url) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: '请粘贴回调 URL 或 Code' }));
          return;
        }
        const tokenResult = await oauthFlowManager.exchangeRawInput(code_or_url);
        if (tokenResult.refreshToken && tokenResult.email) {
          accountPool.addAccount(tokenResult.refreshToken, tokenResult.email);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          message: `账号 ${tokenResult.email} 授权成功并加入账号池！`,
          email: tokenResult.email,
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // 8. 账号池管理接口 (切换/移除/清空)
  if (url.pathname === '/api/accounts/switch' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const { email } = JSON.parse(body);
        accountPool.switchAccount(email);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: `已切换至账号 ${email}` }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/accounts/clear' && req.method === 'POST') {
    accountPool.clearAccounts();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: '已清空账号池' }));
    return;
  }

  if (url.pathname === '/api/accounts/remove' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const { email } = JSON.parse(body);
        accountPool.removeAccount(email);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: `已移除账号 ${email}` }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // 9. 真实配额接口 (/api/gemini/quota)
  if (url.pathname === '/api/gemini/quota') {
    const activeMgr = accountPool.getActiveManager();
    const quotaData = await fetchRealQuota(activeMgr);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(quotaData));
    return;
  }

  // 10. 核心模型接口：/v1/messages
  if (url.pathname === '/v1/messages' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      const startTime = Date.now();
      try {
        const anthropicReq = JSON.parse(body);
        let activeMgr = accountPool.getActiveManager();

        if (!activeMgr) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: {
              type: 'authentication_error',
              message: '账号池为空，请先在控制台授权 Google 账号',
            },
          }));
          return;
        }

        let accessToken = await activeMgr.getValidAccessToken();
        const isStreaming = Boolean(anthropicReq.stream);
        let lastFailedDetails = null;

        const executeAttempt = async (modelToUse) => {
          const reqCopy = { ...anthropicReq, model: modelToUse };
          const payload = buildCloudCodePayload(reqCopy);
          const headers = buildAntigravityHeaders(accessToken);

          for (const host of ANTIGRAVITY_ENDPOINTS) {
            const upstreamEndpoint = isStreaming
              ? `${host}/v1internal:streamGenerateContent?alt=sse`
              : `${host}/v1internal:generateContent`;

            try {
              const res = await fetch(upstreamEndpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
              });
              if (res.ok) return res;

              const errText = await res.text().catch(() => '');
              lastFailedDetails = { status: res.status, body: errText };
              console.warn(`[Upstream ${host} Reject]`, res.status, errText.slice(0, 200));
            } catch (e) {
              lastFailedDetails = { status: 500, body: e.message };
            }
          }
          return null;
        };

        let response = await executeAttempt(anthropicReq.model);

        // 自动故障转移与降级
        if (!response || !response.ok) {
          const fallbacks = MODEL_FALLBACK_CHAINS[anthropicReq.model] || [];
          for (const fallbackModel of fallbacks) {
            console.log(`[Failover] 主模型重试备选模型: ${fallbackModel}`);
            response = await executeAttempt(fallbackModel);
            if (response && response.ok) break;
          }

          if (!response || !response.ok) {
            const nextMgr = accountPool.rotateToNext();
            if (nextMgr) {
              console.log(`[Failover] 切换账号: ${nextMgr.tokenData.email}`);
              activeMgr = nextMgr;
              accessToken = await activeMgr.getValidAccessToken();
              response = await executeAttempt(anthropicReq.model);
            }
          }
        }

        if (!response || !response.ok) {
          const errDetail = lastFailedDetails ? lastFailedDetails.body : 'Google 集群无响应';
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: {
              type: 'upstream_error',
              message: errDetail,
            },
          }));
          statsTracker.recordRequest({
            model: anthropicReq.model,
            latency_ms: Date.now() - startTime,
            status: 502,
            error: errDetail.slice(0, 100),
          });
          return;
        }

        const totalLatency = Date.now() - startTime;

        if (isStreaming) {
          await handleStreamConversion(response, res, anthropicReq.model, (usage) => {
            statsTracker.recordRequest({
              model: anthropicReq.model,
              latency_ms: Date.now() - startTime,
              status: 200,
              is_stream: true,
              input_tokens: usage.input_tokens,
              output_tokens: usage.output_tokens,
              cached_tokens: usage.cached_tokens,
            });
          });
        } else {
          const googleData = await response.json();
          const anthropicResp = convertGoogleToAnthropic(googleData, anthropicReq.model);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(anthropicResp));

          statsTracker.recordRequest({
            model: anthropicReq.model,
            latency_ms: totalLatency,
            status: 200,
            is_stream: false,
            input_tokens: anthropicResp.usage?.input_tokens || 0,
            output_tokens: anthropicResp.usage?.output_tokens || 0,
            cached_tokens: anthropicResp.usage?.cache_read_input_tokens || 0,
          });
        }
      } catch (err) {
        console.error('[Gateway Processing Error]', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'server_error', message: err.message } }));
        statsTracker.recordRequest({
          model: 'unknown',
          latency_ms: Date.now() - startTime,
          status: 500,
          error: err.message,
        });
      }
    });
    return;
  }

  // 11. Token 预估
  if (url.pathname === '/messages/count_tokens') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ input_tokens: 100 }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Antigravity Gateway (v2.2) 运行在 http://0.0.0.0:${PORT}`);
});
