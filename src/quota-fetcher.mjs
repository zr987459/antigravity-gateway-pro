/**
 * Real-time Google Antigravity Quota Telemetry Fetcher
 *
 * 核心机制：
 * 绝非死板的模拟假数据！直接调用 Google Cloud Code 官方的
 * /v1internal:fetchAvailableModels 端点，实时拉取 Google 官方当前返回的
 * quotaInfo (remainingFraction 剩余额度比例与 resetTime 重置时间)。
 */

import { ANTIGRAVITY_ENDPOINT_DAILY } from './constants.mjs';

export async function fetchRealQuota(tokenManager) {
  if (!tokenManager || !tokenManager.tokenData.refreshToken) {
    return {
      ok: false,
      message: '尚未配置 Google 账号',
      email: '未登录',
      gemini_percentage: 0,
      claude_percentage: 0,
      reset_time: null,
    };
  }

  const accessToken = await tokenManager.getValidAccessToken();
  if (!accessToken) {
    return {
      ok: false,
      message: 'Google 凭据失效',
      email: tokenManager.tokenData.email,
      gemini_percentage: 0,
      claude_percentage: 0,
      reset_time: null,
    };
  }

  try {
    const url = `${ANTIGRAVITY_ENDPOINT_DAILY}/v1internal:fetchAvailableModels`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'antigravity/1.10.2 linux/arm64',
      },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      throw new Error(`Google HTTP ${res.status}`);
    }

    const data = await res.json();
    const models = data?.models || {};

    // 提取 Gemini 额度 (参考 gemini-3.6-flash-medium 或 gemini-2.5-flash-thinking)
    const geminiInfo = models['gemini-3.6-flash-medium']?.quotaInfo 
                    || models['gemini-2.5-flash-thinking']?.quotaInfo 
                    || models['gemini-3.8-flash-tiered']?.quotaInfo 
                    || {};
    
    // 提取 Claude 3P 额度 (参考 claude-opus-4-6-thinking 或 claude-sonnet-4-6)
    const claudeInfo = models['claude-opus-4-6-thinking']?.quotaInfo 
                    || models['claude-sonnet-4-6']?.quotaInfo 
                    || {};

    const geminiFraction = typeof geminiInfo.remainingFraction === 'number' ? geminiInfo.remainingFraction : 0;
    const claudeFraction = typeof claudeInfo.remainingFraction === 'number' ? claudeInfo.remainingFraction : 0;

    return {
      ok: true,
      email: tokenManager.tokenData.email,
      five_hour: {
        bucket_id: 'gemini-5h',
        window: '5h',
        remaining_fraction: geminiFraction,
        percentage: Math.round(geminiFraction * 100),
        reset_time: geminiInfo.resetTime || null,
      },
      weekly: {
        bucket_id: 'gemini-weekly',
        window: 'weekly',
        remaining_fraction: geminiFraction,
        percentage: Math.round(geminiFraction * 100),
      },
      claude_five_hour: {
        bucket_id: '3p-5h',
        window: '5h',
        remaining_fraction: claudeFraction,
        percentage: Math.round(claudeFraction * 100),
        reset_time: claudeInfo.resetTime || null,
      },
      updated_unix: Math.floor(Date.now() / 1000),
      updated_time: new Date().toLocaleTimeString(),
    };
  } catch (err) {
    console.error('[Quota Fetch Error]:', err.message);
    return {
      ok: false,
      message: err.message,
      email: tokenManager.tokenData.email,
      five_hour: { percentage: 0 },
      weekly: { percentage: 0 },
      claude_five_hour: { percentage: 0 },
      updated_time: new Date().toLocaleTimeString(),
    };
  }
}
