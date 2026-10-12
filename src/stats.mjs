/**
 * Multi-Tenant Usage & Telemetry Stats Tracker (按账号完全隔离统计)
 */

import fs from 'fs';
import path from 'path';

export class StatsTracker {
  constructor(storageDir) {
    this.storageDir = storageDir;
    this.dataFile = path.join(storageDir, 'user_stats.json');
    this.userStats = {}; // { [email]: { totalReqs, totalTokens, inTokens, outTokens, cachedTokens, logs: [], lastLatency } }
    this.maxLogsPerUser = 80;
    this.ensureStorage();
    this.load();
  }

  ensureStorage() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
    if (!fs.existsSync(this.dataFile)) {
      fs.writeFileSync(this.dataFile, JSON.stringify({}, null, 2), 'utf-8');
    }
  }

  load() {
    try {
      if (fs.existsSync(this.dataFile)) {
        this.userStats = JSON.parse(fs.readFileSync(this.dataFile, 'utf-8'));
      }
    } catch (e) {
      this.userStats = {};
    }
  }

  save() {
    try {
      fs.writeFileSync(this.dataFile, JSON.stringify(this.userStats, null, 2), 'utf-8');
    } catch (e) {}
  }

  getUserBucket(email) {
    const key = (email || 'anonymous').trim().toLowerCase();
    if (!this.userStats[key]) {
      this.userStats[key] = {
        total_requests: 0,
        total_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        cached_tokens: 0,
        avg_latency_ms: 0,
        logs: [],
      };
    }
    return { key, bucket: this.userStats[key] };
  }

  recordRequest({
    email,
    model,
    latency_ms,
    status = 200,
    input_tokens = 0,
    output_tokens = 0,
    cached_tokens = 0,
    is_stream = false,
    error = null,
  }) {
    const { bucket } = this.getUserBucket(email);
    bucket.total_requests++;
    bucket.input_tokens += input_tokens;
    bucket.output_tokens += output_tokens;
    bucket.cached_tokens += cached_tokens;
    bucket.total_tokens = bucket.input_tokens + bucket.output_tokens;
    bucket.avg_latency_ms = latency_ms;

    const now = new Date();
    const timeStr = now.toLocaleTimeString('zh-CN', { hour12: false });

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

    bucket.logs.unshift(logEntry);
    if (bucket.logs.length > this.maxLogsPerUser) {
      bucket.logs.pop();
    }

    this.save();
  }

  getUserStats(email) {
    const { bucket } = this.getUserBucket(email);
    return {
      total_requests: bucket.total_requests,
      total_tokens: bucket.total_tokens,
      input_tokens: bucket.input_tokens,
      output_tokens: bucket.output_tokens,
      cached_tokens: bucket.cached_tokens,
      avg_latency_ms: bucket.avg_latency_ms,
    };
  }

  getUserLogs(email) {
    const { bucket } = this.getUserBucket(email);
    return bucket.logs;
  }

  clearUserLogs(email) {
    const { bucket } = this.getUserBucket(email);
    bucket.logs = [];
    this.save();
  }
}
