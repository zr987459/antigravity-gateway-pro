/**
 * Real-time Google Antigravity Quota Telemetry Fetcher
 *
 * 核心升级：
 * 完整解析 Google Cloud Code 官方模型配额组结构：
 * 1. 5小时滚动滑动窗口 (5-hour Rolling Window)
 * 2. 7天每周重置配额 (7-day Weekly Reset Window)
 * 3. 区分 Gemini (Flash/Pro) 与 Claude 3P (Sonnet/Opus) 两个独立配额桶
 */

import { ANTIGRAVITY_ENDPOINT_DAILY } from './constants.mjs';

function parseResetTime(resetTimeStr) {
  if (!resetTimeStr) return '动态自适应';
  try {
    const target = new Date(resetTimeStr).getTime();
    const diff = target - Date.now();
    if (diff <= 0) return '已重置';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}天${hours % 24}小时后`;
    }
    return `${hours}小时${mins}分后`;
  } catch (e) {
    return resetTimeStr;
  }
}

export async function fetchRealQuota(tokenManager) {
  if (!tokenManager || !tokenManager.tokenData.refreshToken) {
    return {
      ok: false,
      message: '尚未配置 Google 账号',
      email: '未登录',
      gemini_5h: { percentage: 0, reset_text: '--' },
      gemini_7d: { percentage: 0, reset_text: '--' },
      claude_5h: { percentage: 0, reset_text: '--' },
      claude_7d: { percentage: 0, reset_text: '--' },
    };
  }

  const accessToken = await tokenManager.getValidAccessToken();
  if (!accessToken) {
    return {
      ok: false,
      message: 'Google 凭据失效',
      email: tokenManager.tokenData.email,
      gemini_5h: { percentage: 0, reset_text: '--' },
      gemini_7d: { percentage: 0, reset_text: '--' },
      claude_5h: { percentage: 0, reset_text: '--' },
      claude_7d: { percentage: 0, reset_text: '--' },
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

    // 1. 提取 Gemini 系列额度
    let gemini5hFraction = 1.0;
    let gemini5hReset = null;
    let gemini7dFraction = 1.0;
    let gemini7dReset = null;

    const geminiModel = models['gemini-3.6-flash-medium'] 
                     || models['gemini-2.5-flash-thinking'] 
                     || models['gemini-3.8-flash-tiered']
                     || Object.values(models).find(m => m.name?.includes('gemini'))
                     || {};

    if (geminiModel.quotaInfo) {
      gemini5hFraction = typeof geminiModel.quotaInfo.remainingFraction === 'number'
        ? geminiModel.quotaInfo.remainingFraction
        : 1.0;
      gemini5hReset = geminiModel.quotaInfo.resetTime || null;
    }

    // 周维度额度提取 (查找带有 weekly 或 7d 的 quota 限制)
    if (geminiModel.weeklyQuotaInfo) {
      gemini7dFraction = typeof geminiModel.weeklyQuotaInfo.remainingFraction === 'number'
        ? geminiModel.weeklyQuotaInfo.remainingFraction
        : gemini5hFraction;
      gemini7dReset = geminiModel.weeklyQuotaInfo.resetTime || null;
    } else {
      gemini7dFraction = gemini5hFraction;
    }

    // 2. 提取 Claude 3P 系列额度
    let claude5hFraction = 1.0;
    let claude5hReset = null;
    let claude7dFraction = 1.0;
    let claude7dReset = null;

    const claudeModel = models['claude-opus-4-6-thinking'] 
                     || models['claude-sonnet-4-6']
                     || Object.values(models).find(m => m.name?.includes('claude'))
                     || {};

    if (claudeModel.quotaInfo) {
      claude5hFraction = typeof claudeModel.quotaInfo.remainingFraction === 'number'
        ? claudeModel.quotaInfo.remainingFraction
        : 1.0;
      claude5hReset = claudeModel.quotaInfo.resetTime || null;
    }

    if (claudeModel.weeklyQuotaInfo) {
      claude7dFraction = typeof claudeModel.weeklyQuotaInfo.remainingFraction === 'number'
        ? claudeModel.weeklyQuotaInfo.remainingFraction
        : claude5hFraction;
      claude7dReset = claudeModel.weeklyQuotaInfo.resetTime || null;
    } else {
      claude7dFraction = claude5hFraction;
    }

    return {
      ok: true,
      email: tokenManager.tokenData.email,
      gemini_5h: {
        remaining_fraction: gemini5hFraction,
        percentage: Math.round(gemini5hFraction * 100),
        reset_time: gemini5hReset,
        reset_text: parseResetTime(gemini5hReset),
      },
      gemini_7d: {
        remaining_fraction: gemini7dFraction,
        percentage: Math.round(gemini7dFraction * 100),
        reset_time: gemini7dReset,
        reset_text: parseResetTime(gemini7dReset),
      },
      claude_5h: {
        remaining_fraction: claude5hFraction,
        percentage: Math.round(claude5hFraction * 100),
        reset_time: claude5hReset,
        reset_text: parseResetTime(claude5hReset),
      },
      claude_7d: {
        remaining_fraction: claude7dFraction,
        percentage: Math.round(claude7dFraction * 100),
        reset_time: claude7dReset,
        reset_text: parseResetTime(claude7dReset),
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
      gemini_5h: { percentage: 0, reset_text: '异常' },
      gemini_7d: { percentage: 0, reset_text: '异常' },
      claude_5h: { percentage: 0, reset_text: '异常' },
      claude_7d: { percentage: 0, reset_text: '异常' },
      updated_time: new Date().toLocaleTimeString(),
    };
  }
}
