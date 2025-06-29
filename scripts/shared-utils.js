#!/usr/bin/env node

/**
 * Twitter Bot 共通ユーティリティ
 * 自動投稿・返信監視で共有する機能
 */

import { TwitterApi } from 'twitter-api-v2';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ES modules での __dirname 取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 設定（GitHub Actions対応）
export const config = {
  configPath: process.env.CONFIG_PATH || join(__dirname, '../data/github-config.json'),
  logLevel: process.env.LOG_LEVEL || 'info',
  dryRun: process.env.DRY_RUN === 'true',
  timezone: 'Asia/Tokyo'
};

// ログ関数
export const log = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${new Date().toISOString()} ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`),
  debug: (msg) => {
    if (config.logLevel === 'debug') {
      console.log(`[DEBUG] ${new Date().toISOString()} ${msg}`);
    }
  }
};

/**
 * 設定ファイルを読み込み
 */
export function loadConfig() {
  try {
    if (!existsSync(config.configPath)) {
      log.warn(`Configuration file not found: ${config.configPath}`);
      return null;
    }
    
    const configData = JSON.parse(readFileSync(config.configPath, 'utf8'));
    log.info(`Configuration loaded: ${configData.bots?.length || 0} bots found, ${configData.reply_settings?.length || 0} reply settings found`);
    
    return configData;
  } catch (error) {
    log.error(`Failed to load configuration: ${error.message}`);
    return null;
  }
}

/**
 * 設定ファイルを保存
 */
export function saveConfig(configData) {
  try {
    if (config.dryRun) {
      log.info(`[DRY RUN] Would save updated config to: ${config.configPath}`);
      return true;
    }
    
    writeFileSync(config.configPath, JSON.stringify(configData, null, 2), 'utf8');
    log.info(`✅ Configuration saved to: ${config.configPath}`);
    return true;
  } catch (error) {
    log.error(`❌ Failed to save configuration: ${error.message}`);
    log.warn(`⚠️ Continuing with in-memory management`);
    return false;
  }
}

/**
 * Twitter クライアントを作成
 */
export function createTwitterClient(account) {
  try {
    if (!account.api_key || !account.api_key_secret || !account.access_token || !account.access_token_secret) {
      throw new Error('Missing Twitter API credentials');
    }

    return new TwitterApi({
      appKey: account.api_key,
      appSecret: account.api_key_secret,
      accessToken: account.access_token,
      accessSecret: account.access_token_secret,
    });
  } catch (error) {
    log.error(`Failed to create Twitter client for ${account?.account_name}: ${error.message}`);
    throw error;
  }
}

/**
 * Botアカウント情報を取得（IDから）
 */
export function getBotAccountById(configData, botId) {
  log.debug(`Getting bot account for ID: ${botId} (${typeof botId})`);
  
  if (!configData || !configData.bots || !Array.isArray(configData.bots)) {
    log.error(`Invalid configData structure: bots=${configData?.bots}`);
    return null;
  }
  
  // Bot IDの型を統一（数値・文字列両対応）
  const normalizedBotId = parseInt(botId);
  if (isNaN(normalizedBotId)) {
    log.error(`Invalid botId: ${botId} cannot be converted to number`);
    return null;
  }
  
  log.debug(`Searching for bot with ID: ${normalizedBotId}`);
  
  const bot = configData.bots.find(b => {
    if (!b || !b.account) {
      log.debug(`Skipping invalid bot structure: ${JSON.stringify(b)}`);
      return false;
    }
    
    const botAccountId = parseInt(b.account.id);
    if (isNaN(botAccountId)) {
      log.debug(`Skipping bot with invalid ID: ${b.account.id}`);
      return false;
    }
    
    log.debug(`Comparing normalized ID ${normalizedBotId} with bot account ID ${botAccountId}`);
    return botAccountId === normalizedBotId;
  });
  
  if (bot && bot.account) {
    log.debug(`Found bot account: ${bot.account.account_name} (ID: ${bot.account.id})`);
    return bot.account;
  }
  
  log.warn(`Bot account not found for ID: ${botId}`);
  log.debug(`Available bot IDs: ${configData.bots
    .filter(b => b && b.account && b.account.id)
    .map(b => `${b.account.id}(${b.account.account_name})`)
    .join(', ')}`);
  
  return null;
}

/**
 * Bot名を取得（IDから）
 */
export function getBotNameById(configData, botId) {
  log.debug(`Getting bot name for ID: ${botId} (${typeof botId})`);
  
  if (!configData || !configData.bots || !Array.isArray(configData.bots)) {
    log.warn(`Invalid configData.bots structure`);
    return `Bot_${botId}`;
  }
  
  // Bot IDの型を統一（数値・文字列両対応）
  const normalizedBotId = parseInt(botId);
  
  const bot = configData.bots.find(b => {
    if (!b || !b.account) {
      log.debug(`Invalid bot structure: ${JSON.stringify(b)}`);
      return false;
    }
    
    const botAccountId = parseInt(b.account.id);
    log.debug(`Comparing ${normalizedBotId} with ${botAccountId}`);
    return botAccountId === normalizedBotId;
  });
  
  if (bot && bot.account && bot.account.account_name) {
    log.debug(`Found bot name: ${bot.account.account_name}`);
    return bot.account.account_name;
  }
  
  log.warn(`Bot not found for ID: ${botId}, available bots: ${configData.bots.map(b => b?.account?.id).join(', ')}`);
  return `Bot_${botId}`;
}

/**
 * 日本時刻での現在時刻を取得
 */
export function getJapanTime() {
  return new Date().toLocaleString('ja-JP', { 
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * 現在時刻が投稿時間かチェック（時間範囲判定・日本時刻基準）
 */
export function shouldPostNow(scheduledTimes) {
  if (!scheduledTimes || scheduledTimes.length === 0) {
    return false;
  }
  
  // 日本時刻で現在時刻を取得（HH:MM形式）
  const currentTime = new Date().toLocaleString('en-GB', { 
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false 
  });
  
  // 現在の「時」のみ抽出（例：01:39 → 01）
  const currentHour = currentTime.split(':')[0];
  
  // 設定されたスケジュール時間から「時」のみ抽出
  const scheduledHours = scheduledTimes.map(time => time.split(':')[0]);
  
  // 時間範囲でマッチング
  const shouldPost = scheduledHours.includes(currentHour);
  
  log.debug(`Current time (JST): ${currentTime}`);
  log.debug(`Current hour: ${currentHour}`);
  log.debug(`Scheduled times: ${scheduledTimes.join(', ')}`);
  log.debug(`Scheduled hours: ${scheduledHours.join(', ')}`);
  log.debug(`Should post: ${shouldPost}`);
  
  return shouldPost;
}

/**
 * エラーハンドリング設定
 */
export function setupErrorHandling() {
  process.on('uncaughtException', (error) => {
    log.error(`💥 Uncaught exception: ${error.message}`);
    log.debug(`Error stack: ${error.stack}`);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    log.error(`💥 Unhandled rejection at: ${promise}, reason: ${reason}`);
    process.exit(1);
  });
}