#!/usr/bin/env node

/**
 * Twitter Bot 自動投稿スクリプト (GitHub Actions対応版)
 * スケジュール投稿専用版（時間範囲判定対応）
 */

import { TwitterApi } from 'twitter-api-v2';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ES modules での __dirname 取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 設定（GitHub Actions対応）
const config = {
  configPath: process.env.CONFIG_PATH || join(__dirname, '../data/github-config.json'),
  logLevel: process.env.LOG_LEVEL || 'info',
  dryRun: process.env.DRY_RUN === 'true',
  timezone: 'Asia/Tokyo'
};

// ログ関数
const log = {
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
 * 現在時刻（日本時間）を取得
 */
function getCurrentJSTTime() {
  const now = new Date();
  const jstOffset = 9 * 60; // JST は UTC+9
  const jstTime = new Date(now.getTime() + (jstOffset * 60 * 1000));
  return jstTime.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

/**
 * 現在時刻が投稿時間かチェック（時間範囲判定・日本時刻基準）
 */
function shouldPostNow(scheduledTimes) {
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
 * 設定ファイルを読み込み
 */
function loadConfig() {
  try {
    if (!existsSync(config.configPath)) {
      log.warn(`Configuration file not found: ${config.configPath}`);
      return null;
    }
    
    const configData = JSON.parse(readFileSync(config.configPath, 'utf8'));
    log.info(`Configuration loaded: ${configData.bots?.length || 0} bots found`);
    return configData;
  } catch (error) {
    log.error(`Failed to load configuration: ${error.message}`);
    return null;
  }
}

/**
 * Twitter クライアントを作成
 */
function createTwitterClient(botConfig) {
  try {
    const account = botConfig.account;
    
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
    log.error(`Failed to create Twitter client for ${botConfig.account?.account_name}: ${error.message}`);
    throw error;
  }
}

/**
 * ツイートを投稿
 */
async function postTweet(client, content, botName) {
  try {
    if (config.dryRun) {
      log.info(`[DRY RUN] Would post tweet for ${botName}: "${content}"`);
      return {
        data: { id: 'dry_run_' + Date.now(), text: content },
        success: true
      };
    }

    const response = await client.v2.tweet(content);
    
    if (response.data) {
      log.info(`Successfully posted tweet for ${botName}: ${response.data.id}`);
      return { ...response, success: true };
    } else {
      throw new Error('No data in response');
    }
  } catch (error) {
    log.error(`Failed to post tweet for ${botName}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * スケジュール投稿を処理
 */
async function processScheduledPosts(configData) {
  let successCount = 0;
  let errorCount = 0;
  
  for (const botConfig of configData.bots) {
    const account = botConfig.account;
    const scheduledContent = botConfig.scheduled_content;
    const scheduledTimes = botConfig.scheduled_times;
    
    // アカウントがアクティブでない場合はスキップ
    if (account.status !== 'active') {
      log.debug(`Skipping inactive bot: ${account.account_name}`);
      continue;
    }
    
    // スケジュール投稿が設定されていない場合はスキップ
    if (!scheduledContent || !scheduledTimes) {
      log.debug(`No scheduled post for bot: ${account.account_name}`);
      continue;
    }
    
    // 投稿時間をチェック（時間範囲判定）
    const timesArray = scheduledTimes.split(',').map(t => t.trim());
    if (!shouldPostNow(timesArray)) {
      log.debug(`Not time to post for bot: ${account.account_name} (current hour doesn't match scheduled hours)`);
      continue;
    }
    
    log.info(`📝 Processing scheduled post for: ${account.account_name}`);
    
    try {
      // Twitter クライアント作成
      const client = createTwitterClient(botConfig);
      
      // ツイート投稿
      const result = await postTweet(client, scheduledContent, account.account_name);
      
      if (result.success) {
        successCount++;
        log.info(`✅ Scheduled tweet posted for ${account.account_name}`);
      } else {
        errorCount++;
        log.error(`❌ Scheduled tweet failed for ${account.account_name}: ${result.error}`);
      }
      
    } catch (error) {
      errorCount++;
      log.error(`💥 Error processing ${account.account_name}: ${error.message}`);
    }
    
    // レート制限を避けるため少し待機
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  return { successCount, errorCount };
}

/**
 * 日本時刻での現在時刻を取得
 */
function getJapanTime() {
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
 * メイン処理
 */
async function main() {
  try {
    log.info('🚀 Starting Twitter Auto Manager posting process...');
    log.info(`📊 Environment: ${process.env.NODE_ENV || 'production'}`);
    log.info(`🔄 Dry run: ${config.dryRun}`);
    log.info(`⏰ Current time (JST): ${getJapanTime()}`);
    
    // 設定ファイルを読み込み
    const configData = loadConfig();
    
    if (!configData || !configData.bots || configData.bots.length === 0) {
      log.error('❌ No configuration found or no bots configured');
      process.exit(1);
    }

    log.info(`📋 Processing ${configData.bots.length} configured bots...`);
    
    // スケジュール投稿を処理
    const scheduledResults = await processScheduledPosts(configData);
    
    log.info(`📈 Scheduled posts: ${scheduledResults.successCount} success, ${scheduledResults.errorCount} errors`);
    
    // 結果サマリー
    log.info(`🏁 Posting process completed: ${scheduledResults.successCount} success, ${scheduledResults.errorCount} errors`);
    
    if (scheduledResults.errorCount > 0) {
      process.exit(1);
    }
    
  } catch (error) {
    log.error(`💥 Main process error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * エラーハンドリング
 */
process.on('uncaughtException', (error) => {
  log.error(`💥 Uncaught exception: ${error.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log.error(`💥 Unhandled rejection at: ${promise}, reason: ${reason}`);
  process.exit(1);
});

// スクリプト実行
main().catch((error) => {
  log.error(`💥 Script execution failed: ${error.message}`);
  process.exit(1);
});