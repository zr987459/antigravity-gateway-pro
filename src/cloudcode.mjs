/**
 * Google Cloud Code / Antigravity Dispatcher
 */

import { convertAnthropicToGoogle } from './content-converter.mjs';

// 模型别名与降级链映射表 (当 Claude 3P 配额耗尽时，无缝降级到 Gemini 旗舰以防中断)
export const MODEL_FALLBACK_CHAINS = {
  'gemini-3.8-flash-fast': ['gemini-2.5-flash', 'gemini-3.8-flash-tiered'],
  'gemini-3.8-flash-high': ['gemini-3.8-flash-tiered', 'gemini-3.6-flash-high', 'gemini-2.5-flash-thinking'],
  'gemini-3.8-flash': ['gemini-3.8-flash-tiered', 'gemini-2.5-flash'],
  'gemini-3.1-pro-high': ['gemini-3.1-pro-low', 'gemini-2.5-pro'],
  'claude-opus-4-6': ['claude-opus-4-6-thinking', 'claude-sonnet-4-6', 'gemini-3.8-flash-tiered'],
  'claude-sonnet-4-6': ['claude-opus-4-6-thinking', 'gemini-3.8-flash-tiered'],
};

// 官方底层模型标识映射
export function mapToUpstreamModel(clientModel = '') {
  const m = clientModel.toLowerCase();
  if (m.includes('flash-fast')) return 'gemini-2.5-flash';
  if (m.includes('3.8-flash')) return 'gemini-3.8-flash-tiered';
  if (m.includes('3.6-flash')) return 'gemini-3.6-flash-high';
  if (m.includes('3.1-pro')) return 'gemini-3.1-pro-high';
  if (m.includes('2.5-flash')) return 'gemini-2.5-flash-thinking';
  if (m.includes('claude-opus')) return 'claude-opus-4-6-thinking';
  if (m.includes('claude-sonnet')) return 'claude-sonnet-4-6';
  return clientModel;
}

export function buildAntigravityHeaders(accessToken) {
  return {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'antigravity/1.10.2 linux/arm64',
    'X-Client-Name': 'antigravity',
    'Connection': 'keep-alive',
  };
}

export function buildCloudCodePayload(anthropicRequest) {
  const { contents, systemInstruction, tools } = convertAnthropicToGoogle(anthropicRequest);
  const upstreamModel = mapToUpstreamModel(anthropicRequest.model);

  const generationConfig = {
    maxOutputTokens: anthropicRequest.max_tokens || 8192,
    temperature: anthropicRequest.temperature ?? 0.7,
  };

  // 思考模式配置 (支持 Anthropic Extended Thinking 规范及模型自带思考)
  const isHighReasoning = anthropicRequest.model && (
    anthropicRequest.model.includes('high') ||
    anthropicRequest.model.includes('thinking') ||
    anthropicRequest.model.includes('opus')
  );

  if ((anthropicRequest.thinking && anthropicRequest.thinking.type === 'enabled') || isHighReasoning) {
    const budget = anthropicRequest.thinking?.budget_tokens || 4096;
    generationConfig.thinkingConfig = {
      includeThoughts: true,
      thinkingBudget: budget,
    };
  }

  // 极速模式：当指定 fast 时压缩思考预算为 0，达成毫秒级秒出字
  if (anthropicRequest.model && anthropicRequest.model.includes('fast')) {
    generationConfig.thinkingConfig = {
      thinkingBudget: 0,
    };
  }

  const request = {
    contents,
    generationConfig,
  };

  if (systemInstruction) {
    request.systemInstruction = systemInstruction;
  }
  if (tools && tools.length > 0) {
    request.tools = tools;
  }

  return {
    model: upstreamModel,
    request,
  };
}
