/**
 * In-Memory & Persisted Metrics with Real Token Tracking and Trends
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATS_FILE = path.join(__dirname, '..', 'data', 'stats.json');

export class StatsTracker {
  constructor(maxLogs = 200) {
    this.maxLogs = maxLogs;
    this.totalRequests = 0;
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.totalCachedTokens = 0;
    this.logs = [];

    this.hourly = new Map();
    this.daily = new Map();

    this.load();
  }

  load() {
    try {
      if (fs.existsSync(STATS_FILE)) {
        const d = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
        this.totalRequests = d.totalRequests || 0;
        this.totalInputTokens = d.totalInputTokens || 0;
        this.totalOutputTokens = d.totalOutputTokens || 0;
        this.totalCachedTokens = d.totalCachedTokens || 0;
        this.logs = Array.isArray(d.logs) ? d.logs.slice(0, this.maxLogs) : [];
        if (d.hourly) this.hourly = new Map(Object.entries(d.hourly));
        if (d.daily) this.daily = new Map(Object.entries(d.daily));
      }
    } catch (e) {}
  }

  save() {
    try {
      const dir = path.dirname(STATS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const data = {
        totalRequests: this.totalRequests,
        totalInputTokens: this.totalInputTokens,
        totalOutputTokens: this.totalOutputTokens,
        totalCachedTokens: this.totalCachedTokens,
        logs: this.logs.slice(0, this.maxLogs),
        hourly: Object.fromEntries(this.hourly),
        daily: Object.fromEntries(this.daily),
      };
      fs.writeFileSync(STATS_FILE, JSON.stringify(data), 'utf-8');
    } catch (e) {}
  }

  recordRequest({
    model,
    latency_ms,
    status = 200,
    input_tokens = 0,
    output_tokens = 0,
    cached_tokens = 0,
    is_stream = false,
    error = null,
  }) {
    this.totalRequests++;
    this.totalInputTokens += input_tokens;
    this.totalOutputTokens += output_tokens;
    this.totalCachedTokens += cached_tokens;

    const now = new Date();
    const timeStr = now.toLocaleTimeString('zh-CN', { hour12: false });
    const hourKey = `${now.getHours()}:00`;
    const dayKey = `${now.getMonth() + 1}-${now.getDate()}`;

    // 小时统计
    const hData = this.hourly.get(hourKey) || { requests: 0, tokens: 0, cached: 0 };
    hData.requests++;
    hData.tokens += (input_tokens + output_tokens);
    hData.cached += cached_tokens;
    this.hourly.set(hourKey, hData);

    // 日期统计
    const dData = this.daily.get(dayKey) || { requests: 0, tokens: 0, cached: 0 };
    dData.requests++;
    dData.tokens += (input_tokens + output_tokens);
    dData.cached += cached_tokens;
    this.daily.set(dayKey, dData);

    const logEntry = {
      id: Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      time: timeStr,
      timestamp: Date.now(),
      model,
      latency_ms,
      status,
      tokens: {
        input: input_tokens,
        output: output_tokens,
        cached: cached_tokens,
      },
      is_stream,
      error,
    };

    this.logs.unshift(logEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }

    this.save();
  }

  getStats() {
    const totalTokens = this.totalInputTokens + this.totalOutputTokens;
    return {
      total_requests: this.totalRequests,
      total_tokens: totalTokens,
      input_tokens: this.totalInputTokens,
      output_tokens: this.totalOutputTokens,
      cached_tokens: this.totalCachedTokens,
      avg_latency_ms: this.logs.length > 0
        ? Math.round(this.logs.reduce((acc, l) => acc + (l.latency_ms || 0), 0) / this.logs.length)
        : 0,
    };
  }

  getTrendData(mode = '24h') {
    if (mode === '7d') {
      const labels = [];
      const tokens = [];
      const reqs = [];
      const now = new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000);
        const k = `${d.getMonth() + 1}-${d.getDate()}`;
        labels.push(k);
        const item = this.daily.get(k) || { requests: 0, tokens: 0 };
        tokens.push(item.tokens);
        reqs.push(item.requests);
      }
      return { labels, tokens, requests: reqs };
    }

    const labels = [];
    const tokens = [];
    const reqs = [];
    const nowHour = new Date().getHours();
    for (let i = 23; i >= 0; i--) {
      const h = (nowHour - i + 24) % 24;
      const k = `${h}:00`;
      labels.push(k);
      const item = this.hourly.get(k) || { requests: 0, tokens: 0 };
      tokens.push(item.tokens);
      reqs.push(item.requests);
    }
    return { labels, tokens, requests: reqs };
  }

  getLogs() {
    return this.logs;
  }

  clearLogs() {
    this.logs = [];
    this.save();
  }
}

export const statsTracker = new StatsTracker();
