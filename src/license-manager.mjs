/**
 * Commercial License & Subscription Manager (一机一号一卡强绑定鉴权引擎)
 *
 * 核心机制：
 * 1. 卡密生成算法：HMAC-SHA256 签名防伪造校验
 * 2. 强绑定机制：一个卡密首次激活强绑定一个 Google 邮箱，防倒卖/防共享
 * 3. 本地与云端持久化：支持 data/licenses.json 存储与热重载
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const LICENSE_SALT = 'antigravity_pro_lic_salt_2026';

export class LicenseManager {
  constructor(storageDir) {
    this.storageDir = storageDir;
    this.dataFile = path.join(storageDir, 'licenses.json');
    this.licenses = {}; // { [code]: { days, status, boundEmail, activatedAt, expiresAt } }
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
        const raw = fs.readFileSync(this.dataFile, 'utf-8');
        this.licenses = JSON.parse(raw);
      }
    } catch (e) {
      console.error('[LicenseManager] Load error:', e.message);
      this.licenses = {};
    }
  }

  save() {
    try {
      fs.writeFileSync(this.dataFile, JSON.stringify(this.licenses, null, 2), 'utf-8');
    } catch (e) {
      console.error('[LicenseManager] Save error:', e.message);
    }
  }

  /**
   * 批量生成高强度防伪卡密
   * 格式: AG-{TYPE}-{RANDOM8}-{CHECKSUM4}
   * 例如: AG-VIP-8A2F9C3D-B4E1
   */
  generateKeys(count = 10, days = 30, type = 'VIP') {
    const created = [];
    for (let i = 0; i < count; i++) {
      const entropy = crypto.randomBytes(4).toString('hex').toUpperCase();
      const rawPayload = `${type}:${entropy}:${days}`;
      const checksum = crypto.createHmac('sha256', LICENSE_SALT)
        .update(rawPayload)
        .digest('hex')
        .substring(0, 4)
        .toUpperCase();

      const code = `AG-${type}-${entropy}-${checksum}`;
      this.licenses[code] = {
        code,
        type,
        days,
        status: 'unused', // unused | active | expired | revoked
        boundEmail: null,
        activatedAt: null,
        expiresAt: null,
        createdAt: new Date().toISOString(),
      };
      created.push(code);
    }
    this.save();
    return created;
  }

  /**
   * 激活卡密并强绑定指定 Google 邮箱
   */
  activateKey(code, email) {
    if (!code || !email) {
      return { ok: false, message: '卡密或账号邮箱不能为空' };
    }

    const cleanCode = code.trim().toUpperCase();
    const cleanEmail = email.trim().toLowerCase();
    const lic = this.licenses[cleanCode];

    if (!lic) {
      return { ok: false, message: '无效的授权码，请核对后重试' };
    }

    if (lic.status === 'revoked') {
      return { ok: false, message: '该授权码已被管理员作废' };
    }

    // 若已激活，检查是否绑定的是同一邮箱
    if (lic.status === 'active') {
      if (lic.boundEmail === cleanEmail) {
        // 重复激活/查询，返回成功及剩余天数
        const remainingDays = this.getRemainingDays(lic.expiresAt);
        if (remainingDays <= 0) {
          lic.status = 'expired';
          this.save();
          return { ok: false, message: '该授权码已过期，请购买新卡密' };
        }
        return {
          ok: true,
          message: '账号授权正常',
          expiresAt: lic.expiresAt,
          remainingDays,
        };
      } else {
        return {
          ok: false,
          message: `该授权码已强绑定其他账号 (${lic.boundEmail})，严禁一卡多用！`,
        };
      }
    }

    if (lic.status === 'expired') {
      return { ok: false, message: '该授权码已到期失效' };
    }

    // 全新卡密：立即激活并绑定当前邮箱
    const now = new Date();
    const expireDate = new Date(now.getTime() + lic.days * 24 * 60 * 60 * 1000);

    lic.status = 'active';
    lic.boundEmail = cleanEmail;
    lic.activatedAt = now.toISOString();
    lic.expiresAt = expireDate.toISOString();
    this.save();

    console.log(`[LicenseManager] 🎉 账号 ${cleanEmail} 成功激活卡密 ${cleanCode}，有效期 ${lic.days} 天`);

    return {
      ok: true,
      message: '激活成功！已与您的账号强绑定',
      expiresAt: lic.expiresAt,
      remainingDays: lic.days,
    };
  }

  /**
   * 核心鉴权：验证指定 Google 邮箱是否有合法有效授权
   */
  checkAuthorization(email) {
    if (!email) {
      return { authorized: false, reason: '未识别到 Google 账号' };
    }

    const cleanEmail = email.trim().toLowerCase();
    const now = new Date();

    // 查找该邮箱绑定的有效卡密
    for (const code in this.licenses) {
      const lic = this.licenses[code];
      if (lic.boundEmail === cleanEmail && (lic.status === 'active' || lic.status === 'unused')) {
        const expireTime = new Date(lic.expiresAt).getTime();
        if (expireTime > now.getTime()) {
          const remainingDays = Math.ceil((expireTime - now.getTime()) / (1000 * 60 * 60 * 24));
          return {
            authorized: true,
            code: lic.code,
            remainingDays,
            expiresAt: lic.expiresAt,
          };
        } else {
          lic.status = 'expired';
        }
      }
    }

    this.save();
    return {
      authorized: false,
      reason: '未激活软件授权码或授权已过期，请前往发卡网购买卡密激活后使用',
    };
  }

  getRemainingDays(expiresAtStr) {
    if (!expiresAtStr) return 0;
    const diff = new Date(expiresAtStr).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  getAllLicenses() {
    return Object.values(this.licenses);
  }
}
