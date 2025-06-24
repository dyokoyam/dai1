#!/usr/bin/env node

/**
 * Twitter Bot 自動投稿スクリプト (GitHub Actions対応版)
 * スケジュール投稿専用版（時間範囲判定対応・投稿内容リスト対応）
 */

import { TwitterApi } from 'twitter-api-v2';
import { readFileSync, existsSync, writeFileSync } from 'fs';
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
 * 設定ファイルを保存（インデックス更新用）
 */
function saveConfig(configData) {
  try {
    if (config.dryRun) {
      log.info(`[DRY RUN] Would save updated config to: ${config.configPath}`);
      return;
    }
    
    writeFileSync(config.configPath, JSON.stringify(configData, null, 2), 'utf8');
    log.debug(`Configuration saved to: ${config.configPath}`);
  } catch (error) {
    log.error(`Failed to save configuration: ${error.message}`);
  }
}

/**
 * 投稿内容を取得（リスト対応版）
 */
function getPostContent(botConfig) {
  // 投稿リスト形式の場合
  if (botConfig.scheduled_content_list) {
    try {
      // JSON文字列をパース
      const contentList = typeof botConfig.scheduled_content_list === 'string' 
        ? JSON.parse(botConfig.scheduled_content_list)
        : botConfig.scheduled_content_list;
      
      if (!Array.isArray(contentList) || contentList.length === 0) {
        log.warn(`Empty or invalid content list for bot: ${botConfig.account?.account_name}`);
        return null;
      }
      
      const currentIndex = botConfig.current_index || 0;
      const safeIndex = currentIndex % contentList.length; // 配列範囲を超えた場合の安全策
      
      log.debug(`Content list length: ${contentList.length}, current index: ${currentIndex}, safe index: ${safeIndex}`);
      
      return {
        content: contentList[safeIndex],
        isFromList: true,
        currentIndex: currentIndex,
        listLength: contentList.length
      };
    } catch (error) {
      log.error(`Failed to parse content list for bot ${botConfig.account?.account_name}: ${error.message}`);
      return null;
    }
  }
  
  // 従来形式の場合（後方互換）
  if (botConfig.scheduled_content) {
    return {
      content: botConfig.scheduled_content,
      isFromList: false
    };
  }
  
  return null;
}

/**
 * 投稿インデックスを更新
 */
function updatePostIndex(configData, botIndex) {
  const botConfig = configData.bots[botIndex];
  
  if (botConfig.scheduled_content_list) {
    try {
      const contentList = typeof botConfig.scheduled_content_list === 'string' 
        ? JSON.parse(botConfig.scheduled_content_list)
        : botConfig.scheduled_content_list;
      
      const currentIndex = botConfig.current_index || 0;
      const nextIndex = (currentIndex + 1) % contentList.length;
      
      // インデックスを更新
      configData.bots[botIndex].current_index = nextIndex;
      
      log.info(`📈 Updated post index for ${botConfig.account?.account_name}: ${currentIndex} → ${nextIndex}`);
      
      // 一周した場合の通知
      if (nextIndex === 0 && currentIndex !== 0) {
        log.info(`🔄 Content list cycle completed for ${botConfig.account?.account_name}, restarting from index 0`);
      }
      
      return true;
    } catch (error) {
      log.error(`Failed to update post index for ${botConfig.account?.account_name}: ${error.message}`);
      return false;
    }
  }
  
  return false; // リスト形式でない場合は更新不要
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
 * スケジュール投稿を処理（リスト対応版）
 */
async function processScheduledPosts(configData) {
  let successCount = 0;
  let errorCount = 0;
  let configUpdated = false;
  
  for (let botIndex = 0; botIndex < configData.bots.length; botIndex++) {
    const botConfig = configData.bots[botIndex];
    const account = botConfig.account;
    const scheduledTimes = botConfig.scheduled_times;
    
    // アカウントがアクティブでない場合はスキップ
    if (account.status !== 'active') {
      log.debug(`Skipping inactive bot: ${account.account_name}`);
      continue;
    }
    
    // 投稿内容を取得
    const postInfo = getPostContent(botConfig);
    if (!postInfo) {
      log.debug(`No scheduled post content for bot: ${account.account_name}`);
      continue;
    }
    
    // スケジュール時間をチェック（時間範囲判定）
    if (!scheduledTimes) {
      log.debug(`No scheduled times for bot: ${account.account_name}`);
      continue;
    }
    
    const timesArray = scheduledTimes.split(',').map(t => t.trim());
    if (!shouldPostNow(timesArray)) {
      log.debug(`Not time to post for bot: ${account.account_name} (current hour doesn't match scheduled hours)`);
      continue;
    }
    
    // 投稿内容の詳細ログ
    if (postInfo.isFromList) {
      log.info(`📝 Processing scheduled post for: ${account.account_name} [${postInfo.currentIndex + 1}/${postInfo.listLength}]`);
      log.debug(`Current content: "${postInfo.content}"`);
    } else {
      log.info(`📝 Processing scheduled post for: ${account.account_name} [single content]`);
    }
    
    try {
      // Twitter クライアント作成
      const client = createTwitterClient(botConfig);
      
      // ツイート投稿
      const result = await postTweet(client, postInfo.content, account.account_name);
      
      if (result.success) {
        successCount++;
        log.info(`✅ Scheduled tweet posted for ${account.account_name}`);
        
        // 投稿成功時のみインデックスを更新
        if (postInfo.isFromList) {
          const updated = updatePostIndex(configData, botIndex);
          if (updated) {
            configUpdated = true;
          }
        }
      } else {
        errorCount++;
        log.error(`❌ Scheduled tweet failed for ${account.account_name}: ${result.error}`);
        
        // 重複投稿エラー（403）の場合はインデックスを進める
        if (result.error && result.error.includes('403')) {
          log.warn(`⚠️ Duplicate content detected for ${account.account_name}, advancing index`);
          if (postInfo.isFromList) {
            const updated = updatePostIndex(configData, botIndex);
            if (updated) {
              configUpdated = true;
            }
          }
        }
      }
      
    } catch (error) {
      errorCount++;
      log.error(`💥 Error processing ${account.account_name}: ${error.message}`);
    }
    
    // レート制限を避けるため少し待機
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // 設定ファイルが更新された場合は保存
  if (configUpdated) {
    saveConfig(configData);
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
    
    // 各Botの投稿情報をログ出力（デバッグ用）
    configData.bots.forEach((botConfig, index) => {
      const account = botConfig.account;
      if (account.status === 'active') {
        const postInfo = getPostContent(botConfig);
        if (postInfo && postInfo.isFromList) {
          log.debug(`Bot ${index + 1}: ${account.account_name} - List: ${postInfo.listLength} items, Current: ${postInfo.currentIndex + 1}`);
        } else if (postInfo) {
          log.debug(`Bot ${index + 1}: ${account.account_name} - Single content mode`);
        }
      }
    });
    
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