#!/usr/bin/env node
/**
 * Commercial License CLI Tool (一键批量生成与管理卡密)
 *
 * 用法:
 * 1. 批量生成月卡: node src/license-cli.mjs generate --count=20 --days=30
 * 2. 批量生成年卡: node src/license-cli.mjs generate --count=10 --days=365 --type=YEAR
 * 3. 查看卡密列表: node src/license-cli.mjs list
 * 4. 导出未使用的卡密: node src/license-cli.mjs export-unused
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { LicenseManager } from './license-manager.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storageDir = path.join(__dirname, '..', 'data');
const licenseManager = new LicenseManager(storageDir);

const args = process.argv.slice(2);
const command = args[0] || 'help';

function parseArg(key, defaultVal) {
  const arg = args.find(a => a.startsWith(`--${key}=`));
  return arg ? arg.split('=')[1] : defaultVal;
}

if (command === 'generate') {
  const count = parseInt(parseArg('count', '10'), 10);
  const days = parseInt(parseArg('days', '30'), 10);
  const type = parseArg('type', 'VIP');

  const keys = licenseManager.generateKeys(count, days, type);
  console.log(`\n🎉 成功批量生成 ${count} 张 ${days} 天 (${type}) 授权码：`);
  console.log('='.repeat(50));
  keys.forEach((k, idx) => {
    console.log(`${k}`);
  });
  console.log('='.repeat(50));
  console.log(`💡 提示：可直接全选上方卡密，批量粘贴导入第三方发卡平台上架销售！\n`);
} else if (command === 'list') {
  const all = licenseManager.getAllLicenses();
  console.log(`\n📋 当前系统卡密总数: ${all.length} 张`);
  console.table(all.map(l => ({
    '授权码': l.code,
    '有效天数': l.days,
    '状态': l.status,
    '绑定邮箱': l.boundEmail || '未绑定',
    '到期时间': l.expiresAt ? l.expiresAt.substring(0, 10) : '未激活'
  })));
} else if (command === 'export-unused') {
  const unused = licenseManager.getAllLicenses().filter(l => l.status === 'unused');
  console.log(`\n📦 未使用的有效卡密 (${unused.length} 张)：`);
  unused.forEach(l => console.log(l.code));
} else {
  console.log(`
Antigravity License Manager CLI
================================
使用示例:
  node src/license-cli.mjs generate --count=50 --days=30
  node src/license-cli.mjs generate --count=10 --days=365 --type=YEAR
  node src/license-cli.mjs list
  node src/license-cli.mjs export-unused
`);
}
