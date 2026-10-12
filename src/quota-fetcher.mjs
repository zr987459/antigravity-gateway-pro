/**
 * Real-time Google Antigravity Quota Telemetry Fetcher (v2 - strict)
 *
 * 核心原则：宁可显示 '--'，也绝不伪造 100%。
 * 1. 遍历全部模型条目，收集所有能识别到的真实配额数据（兼容多种字段形态）；
 * 2. 从 {limit, usage} / {remaining, total} / remainingFraction 精确计算百分比；
 * 3. Google 某桶无数据时返回 null，前端渲染为 '--'。
 */

function parseResetTime(resetTimeStr) {
  if (!resetTimeStr) return null;
  try {
    const target = new Date(resetTimeStr).getTime();
    if (Number.isNaN(target)) return null;
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
    return null;
  }
}

/** 从一个 quota 条目里抽取数值。支持三种形态，找不到返回 null */
function extractFromEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  // 形态 A: remainingFraction
  if (typeof entry.remainingFraction === 'number' && entry.remainingFraction >= 0) {
    return { fraction: entry.remainingFraction, reset: entry.resetTime || entry.reset_time || null, source: 'remainingFraction' };
  }
  // 形态 B: limit/usage
  const limit = entry.limit ?? entry.quotaLimit ?? entry.max;
  const usage = entry.usage ?? entry.consumed ?? entry.used;
  if (typeof limit === 'number' && limit > 0) {
    const u = typeof usage === 'number' ? usage : 0;
    return { fraction: Math.max(0, Math.min(1, 1 - u / limit)), reset: entry.resetTime || entry.reset_time || null, source: 'limit-usage' };
  }
  // 形态 C: remaining/total
  const total = entry.total ?? entry.quotaTotal;
  const remaining = entry.remaining ?? entry.remainingQuota;
  if (typeof total === 'number' && total > 0 && typeof remaining === 'number') {
    return { fraction: Math.max(0, Math.min(1, remaining / total)), reset: entry.resetTime || entry.reset_time || null, source: 'remaining-total' };
  }
  return null;
}

/** 判断一个 limit 条目属于周窗口还是短窗口 */
function isWeeklyEntry(entry) {
  const text = JSON.stringify({
    name: entry?.name, type: entry?.type, window: entry?.window,
    period: entry?.period, interval: entry?.interval, id: entry?.id,
  }).toLowerCase();
  return /weekly|week|7d|seven/.test(text);
}

/** 收集一个模型条目下所有真实配额 */
function collectModelQuotas(model, family) {
  const out = {
    [family === 'gemini' ? 'gemini_5h' : 'claude_5h']: null,
    [family === 'gemini' ? 'gemini_7d' : 'claude_7d']: null,
  };
  const consider = (entry, forcedWeekly) => {
    if (!entry) return;
    const r = extractFromEntry(entry);
    if (!r) return;
    const weekly = forcedWeekly ?? (entry && typeof entry === 'object' ? isWeeklyEntry(entry) : false);
    const key = weekly ? (family === 'gemini' ? 'gemini_7d' : 'claude_7d') : (family === 'gemini' ? 'gemini_5h' : 'claude_5h');
    // 同桶多窗口取"最紧"的 (remaining 最小的)，防止高估
    if (!out[key] || r.fraction < out[key].fraction) out[key] = r;
  };

  consider(model.quotaInfo, false);
  consider(model.weeklyQuotaInfo, true);
  // limits / rateLimits / quota 数组形态
  for (const arrName of ['limits', 'rateLimits', 'quota']) {
    if (Array.isArray(model[arrName])) model[arrName].forEach(e => consider(e, null));
  }
  return out;
}

function toPublic(r) {
  if (!r) return null;
  return {
    remaining_fraction: r.fraction,
    percentage: Math.round(r.fraction * 100),
    reset_time: r.reset,
    reset_text: parseResetTime(r.reset) || '动态自适应',
    source: r.source,
  };
}

export async function fetchRealQuota(tokenManager) {
  if (!tokenManager || !tokenManager.tokenData?.refreshToken) {
    return { ok: false, message: '尚未配置 Google 账号', email: '未登录',
      gemini_5h: null, gemini_7d: null, claude_5h: null, claude_7d: null,
      updated_time: new Date().toLocaleTimeString() };
  }

  const accessToken = await tokenManager.getValidAccessToken();
  if (!accessToken) {
    return { ok: false, message: 'Google 凭据失效', email: tokenManager.tokenData.email,
      gemini_5h: null, gemini_7d: null, claude_5h: null, claude_7d: null,
      updated_time: new Date().toLocaleTimeString() };
  }

  try {
    const { CLOUDCODE_API_ENDPOINT, ANTIGRAVITY_ENDPOINT_DAILY } = await import('./constants.mjs');
    // 先试 DAILY(配额字段更全)，失败回退 PROD
    const endpoints = [ANTIGRAVITY_ENDPOINT_DAILY, CLOUDCODE_API_ENDPOINT];
    let data = null;
    let lastErr = null;
    for (const base of endpoints) {
      try {
        const res = await fetch(`${base}/v1internal:fetchAvailableModels`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'antigravity/1.10.2 linux/arm64',
          },
          body: JSON.stringify({}),
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) { data = await res.json(); break; }
        lastErr = new Error(`Google HTTP ${res.status}`);
      } catch (e) { lastErr = e; }
    }
    if (!data) throw lastErr || new Error('all quota endpoints unreachable');

    const models = data?.models || data || {};
    const merged = { gemini_5h: null, gemini_7d: null, claude_5h: null, claude_7d: null };

    // 遍历全部模型条目，同家族多模型取"最紧"窗口
    for (const [modelKey, model] of Object.entries(models)) {
      const name = String(model?.name || modelKey || '').toLowerCase();
      let family = null;
      if (name.includes('gemini')) family = 'gemini';
      else if (name.includes('claude')) family = 'claude';
      if (!family) continue;
      const found = collectModelQuotas(model, family);
      for (const key of Object.keys(merged)) {
        if (found[key]) {
          if (!merged[key] || found[key].fraction < merged[key].fraction) merged[key] = found[key];
        }
      }
    }

    const result = {
      ok: true,
      email: tokenManager.tokenData.email,
      gemini_5h: toPublic(merged.gemini_5h),
      gemini_7d: toPublic(merged.gemini_7d),
      claude_5h: toPublic(merged.claude_5h),
      claude_7d: toPublic(merged.claude_7d),
      updated_unix: Math.floor(Date.now() / 1000),
      updated_time: new Date().toLocaleTimeString(),
    };
    // 老界面字段兼容 —— 无数据时传 null 而非 100
    result.five_hour = { percentage: result.gemini_5h?.percentage ?? null, reset_time: result.gemini_5h?.reset_time || null };
    result.claude_five_hour = { percentage: result.claude_5h?.percentage ?? null, reset_time: result.claude_5h?.reset_time || null };
    result.weekly = { percentage: result.gemini_7d?.percentage ?? null };
    return result;
  } catch (err) {
    console.error('[Quota Fetch Error]:', err.message);
    return {
      ok: false,
      message: err.message,
      email: tokenManager.tokenData.email,
      gemini_5h: null, gemini_7d: null, claude_5h: null, claude_7d: null,
      five_hour: { percentage: null, reset_time: null },
      claude_five_hour: { percentage: null, reset_time: null },
      weekly: { percentage: null },
      updated_time: new Date().toLocaleTimeString(),
    };
  }
}
