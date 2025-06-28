#!/usr/bin/env node

/**
 * Twitter Bot 自動投稿スクリプト (GitHub Actions対応版)
 * スケジュール投稿専用版（時間範囲判定対応・投稿内容リスト対応・返信機能新仕様対応・エラー修正版）
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
 * 設定ファイルを読み込み - 改善版
 */
function loadConfig() {
  try {
    if (!existsSync(config.configPath)) {
      log.warn(`Configuration file not found: ${config.configPath}`);
      return null;
    }
    
    log.info(`📂 Loading configuration from: ${config.configPath}`);
    
    const configContent = readFileSync(config.configPath, 'utf8');
    const configData = JSON.parse(configContent);
    
    log.info(`Configuration loaded: ${configData.bots?.length || 0} bots found, ${configData.reply_settings?.length || 0} reply settings found`);
    
    // 🔍 設定ファイルの詳細分析
    log.info(`📊 Configuration file analysis:`);
    log.info(`  📄 File size: ${configContent.length} bytes`);
    log.info(`  🕐 File modified: ${require('fs').statSync(config.configPath).mtime.toISOString()}`);
    
    // 各Botの現在のインデックス状態をログ出力
    if (configData.bots && configData.bots.length > 0) {
      log.info(`🤖 Bot index states at load time:`);
      configData.bots.forEach((bot, index) => {
        if (bot && bot.account) {
          const currentIndex = bot.current_index || 0;
          let contentCount = 'unknown';
          
          if (bot.scheduled_content_list) {
            try {
              const contentList = JSON.parse(bot.scheduled_content_list);
              contentCount = Array.isArray(contentList) ? contentList.length : 'invalid';
            } catch (e) {
              contentCount = 'parse_error';
            }
          } else if (bot.scheduled_content) {
            contentCount = 1;
          }
          
          log.info(`  🤖 ${bot.account.account_name} (ID: ${bot.account.id}): index=${currentIndex}, content_count=${contentCount}`);
        }
      });
    }
    
    // デバッグ：設定ファイルの構造をログ出力
    if (configData.bots && configData.bots.length > 0) {
      log.debug(`Bot configuration structure check:`);
      configData.bots.forEach((bot, index) => {
        if (bot && bot.account) {
          log.debug(`  Bot ${index}: ID=${bot.account.id} (${typeof bot.account.id}), Name=${bot.account.account_name}, Status=${bot.account.status}`);
        } else {
          log.warn(`  Bot ${index}: Invalid structure - ${JSON.stringify(bot)}`);
        }
      });
    }
    
    return configData;
  } catch (error) {
    log.error(`Failed to load configuration: ${error.message}`);
    return null;
  }
}

/**
 * 設定ファイルを保存（インデックス更新用）- 改善版
 */
function saveConfig(configData) {
  try {
    if (config.dryRun) {
      log.info(`[DRY RUN] Would save updated config to: ${config.configPath}`);
      return true;
    }
    
    // 設定ファイルの保存前にバックアップ作成
    const configJson = JSON.stringify(configData, null, 2);
    
    log.info(`💾 Saving configuration to: ${config.configPath}`);
    log.debug(`📝 Config content preview: ${configJson.substring(0, 200)}...`);
    
    writeFileSync(config.configPath, configJson, 'utf8');
    
    // ファイル保存の確認
    if (existsSync(config.configPath)) {
      const savedContent = readFileSync(config.configPath, 'utf8');
      const savedData = JSON.parse(savedContent);
      
      // インデックス更新の確認
      if (savedData.bots && savedData.bots.length > 0) {
        savedData.bots.forEach((bot, index) => {
          if (bot.account && bot.current_index !== undefined) {
            log.info(`🔄 Saved index for ${bot.account.account_name}: ${bot.current_index}`);
          }
        });
      }
      
      log.info(`✅ Configuration saved and verified: ${config.configPath}`);
      
      // Git への明示的な書き込み完了の確認
      log.info(`📂 File size: ${savedContent.length} bytes`);
      log.info(`🕐 Save timestamp: ${new Date().toISOString()}`);
      
      return true;
    } else {
      throw new Error('File was not saved properly');
    }
  } catch (error) {
    log.error(`❌ Failed to save configuration: ${error.message}`);
    log.warn(`⚠️ Continuing with in-memory index management`);
    return false;
  }
}

/**
 * 投稿内容を取得（リスト対応版・メモリインデックス考慮）
 */
function getPostContentWithMemoryIndex(botConfig, memoryIndices, accountName) {
  // 投稿リスト形式の場合
  if (botConfig.scheduled_content_list) {
    try {
      // JSON文字列をパース
      const contentList = typeof botConfig.scheduled_content_list === 'string' 
        ? JSON.parse(botConfig.scheduled_content_list)
        : botConfig.scheduled_content_list;
      
      if (!Array.isArray(contentList) || contentList.length === 0) {
        log.warn(`Empty or invalid content list for bot: ${accountName}`);
        return null;
      }
      
      // メモリインデックスを優先、なければ設定ファイルのインデックス
      let currentIndex;
      if (memoryIndices.has(accountName)) {
        currentIndex = memoryIndices.get(accountName);
        log.debug(`Using memory index for ${accountName}: ${currentIndex}`);
      } else {
        currentIndex = botConfig.current_index || 0;
        memoryIndices.set(accountName, currentIndex);
        log.debug(`Initialized memory index for ${accountName}: ${currentIndex}`);
      }
      
      const safeIndex = currentIndex % contentList.length; // 配列範囲を超えた場合の安全策
      
      log.debug(`Content list length: ${contentList.length}, current index: ${currentIndex}, safe index: ${safeIndex}`);
      
      return {
        content: contentList[safeIndex],
        isFromList: true,
        currentIndex: currentIndex,
        listLength: contentList.length
      };
    } catch (error) {
      log.error(`Failed to parse content list for bot ${accountName}: ${error.message}`);
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
 * 投稿インデックスを更新（メモリ管理対応版）
 */
function updatePostIndexWithMemory(configData, botIndex, memoryIndices, accountName) {
  const botConfig = configData.bots[botIndex];
  
  if (botConfig.scheduled_content_list) {
    try {
      const contentList = typeof botConfig.scheduled_content_list === 'string' 
        ? JSON.parse(botConfig.scheduled_content_list)
        : botConfig.scheduled_content_list;
      
      // 現在のインデックスを取得（メモリ優先）
      const currentIndex = memoryIndices.has(accountName) 
        ? memoryIndices.get(accountName) 
        : (botConfig.current_index || 0);
      
      const nextIndex = (currentIndex + 1) % contentList.length;
      
      // メモリインデックスを更新
      memoryIndices.set(accountName, nextIndex);
      
      // 設定ファイルのインデックスも更新
      configData.bots[botIndex].current_index = nextIndex;
      
      log.info(`📈 Updated post index for ${accountName}: ${currentIndex} → ${nextIndex} (memory managed)`);
      
      // 一周した場合の通知
      if (nextIndex === 0 && currentIndex !== 0) {
        log.info(`🔄 Content list cycle completed for ${accountName}, restarting from index 0`);
      }
      
      return true;
    } catch (error) {
      log.error(`Failed to update post index for ${accountName}: ${error.message}`);
      return false;
    }
  }
  
  return false; // リスト形式でない場合は更新不要
}

/**
 * Twitter クライアントを作成
 */
function createTwitterClient(account) {
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
 * ツイートへの返信を投稿
 */
async function postReply(client, content, tweetId, botName) {
  try {
    if (config.dryRun) {
      log.info(`[DRY RUN] Would post reply for ${botName} to tweet ${tweetId}: "${content}"`);
      return {
        data: { id: 'dry_run_reply_' + Date.now(), text: content },
        success: true
      };
    }

    const response = await client.v2.tweet(content, {
      reply: {
        in_reply_to_tweet_id: tweetId
      }
    });
    
    if (response.data) {
      log.info(`✅ Successfully posted reply for ${botName}: ${response.data.id}`);
      return { ...response, success: true };
    } else {
      throw new Error('No data in response');
    }
  } catch (error) {
    log.error(`❌ Failed to post reply for ${botName}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * ユーザーの最新ツイートを取得 - 修正版
 */
async function getUserTweets(client, username, sinceId = null) {
  try {
    if (config.dryRun) {
      log.info(`[DRY RUN] Would fetch tweets for ${username} since ${sinceId || 'beginning'}`);
      return {
        data: sinceId ? [] : [{
          id: 'dry_run_tweet_' + Date.now(),
          text: 'This is a dry run tweet',
          created_at: new Date().toISOString()
        }],
        success: true
      };
    }

    log.debug(`🔍 Getting tweets for user: ${username}, since: ${sinceId || 'beginning'}`);

    // ユーザー名からユーザーIDを取得
    const userResponse = await client.v2.userByUsername(username);
    if (!userResponse.data) {
      throw new Error(`User ${username} not found`);
    }

    const userId = userResponse.data.id;
    log.debug(`📋 Found user ID: ${userId} for ${username}`);

    // ツイートを取得
    const options = {
      max_results: 10,
      'tweet.fields': ['created_at', 'conversation_id', 'author_id'],
      exclude: 'retweets,replies'  // リツイートと返信を除外
    };

    if (sinceId) {
      options.since_id = sinceId;
      log.debug(`📅 Using since_id: ${sinceId}`);
    }

    log.debug(`🚀 Fetching tweets with options: ${JSON.stringify(options)}`);
    const tweetsResponse = await client.v2.userTimeline(userId, options);
    
    // レスポンス構造をデバッグ出力
    log.debug(`📦 Twitter API response structure: ${JSON.stringify({
      hasData: !!tweetsResponse.data,
      dataType: typeof tweetsResponse.data,
      dataLength: Array.isArray(tweetsResponse.data) ? tweetsResponse.data.length : 'not array',
      hasMeta: !!tweetsResponse.meta,
      hasErrors: !!tweetsResponse.errors,
      errors: tweetsResponse.errors
    })}`);

    // データの存在確認
    if (!tweetsResponse) {
      log.warn(`⚠️ No response from Twitter API for ${username}`);
      return { data: [], success: true };
    }

    // エラーチェック
    if (tweetsResponse.errors && tweetsResponse.errors.length > 0) {
      log.warn(`⚠️ Twitter API errors for ${username}: ${JSON.stringify(tweetsResponse.errors)}`);
      // エラーがあっても、データがある場合は続行
    }

    // データの正規化
    let tweets = [];
    if (tweetsResponse.data && Array.isArray(tweetsResponse.data)) {
      tweets = tweetsResponse.data;
    } else if (tweetsResponse.data) {
      // データが配列でない場合（単一オブジェクト）
      tweets = [tweetsResponse.data];
    } else {
      // データが空の場合
      tweets = [];
    }

    log.debug(`📊 Retrieved ${tweets.length} tweets for ${username}`);
    
    // 各ツイートの基本情報をログ出力
    tweets.forEach((tweet, index) => {
      if (tweet && tweet.id) {
        log.debug(`  Tweet ${index + 1}: ID=${tweet.id}, Text="${(tweet.text || '').substring(0, 30)}..."`);
      } else {
        log.warn(`  Tweet ${index + 1}: Invalid structure - ${JSON.stringify(tweet)}`);
      }
    });
    
    return {
      data: tweets,
      success: true,
      meta: tweetsResponse.meta
    };
  } catch (error) {
    log.error(`❌ Failed to fetch tweets for ${username}: ${error.message}`);
    log.debug(`Error details: ${error.stack}`);
    return { success: false, error: error.message, data: [] };
  }
}

/**
 * 新仕様：返信設定のlast_checked_tweet_idsを更新（複数の監視対象に対応）
 */
function updateLastCheckedTweetIds(configData, replySettingIndex, targetBotId, tweetId) {
  try {
    const replySetting = configData.reply_settings[replySettingIndex];
    
    // 現在のlast_checked_tweet_idsを取得
    let lastCheckedTweetIds = {};
    if (replySetting.last_checked_tweet_ids) {
      try {
        // 新形式（JSON配列）をパース
        const idsArray = JSON.parse(replySetting.last_checked_tweet_ids);
        if (Array.isArray(idsArray)) {
          // 配列形式 ["1:tweet_id", "2:tweet_id"] から {1: "tweet_id", 2: "tweet_id"} に変換
          idsArray.forEach(entry => {
            const parts = entry.split(':');
            if (parts.length === 2) {
              lastCheckedTweetIds[parts[0]] = parts[1];
            }
          });
        }
      } catch (parseError) {
        log.warn(`Failed to parse last_checked_tweet_ids, resetting: ${parseError.message}`);
        lastCheckedTweetIds = {};
      }
    }
    
    // 該当するtarget_bot_idのツイートIDを更新
    lastCheckedTweetIds[targetBotId.toString()] = tweetId;
    
    // JSON配列形式に戻す ["1:tweet_id", "2:tweet_id"]
    const updatedIds = Object.entries(lastCheckedTweetIds).map(([botId, tweetId]) => `${botId}:${tweetId}`);
    
    configData.reply_settings[replySettingIndex].last_checked_tweet_ids = JSON.stringify(updatedIds);
    configData.reply_settings[replySettingIndex].updated_at = new Date().toISOString();
    
    log.debug(`Updated last_checked_tweet_ids for reply setting ${replySettingIndex}, target bot ${targetBotId}: ${tweetId}`);
    return true;
  } catch (error) {
    log.error(`Failed to update last_checked_tweet_ids: ${error.message}`);
    return false;
  }
}

/**
 * 新仕様：特定の監視対象のlast_checked_tweet_idを取得
 */
function getLastCheckedTweetId(replySetting, targetBotId) {
  try {
    if (!replySetting.last_checked_tweet_ids) {
      return null;
    }
    
    const idsArray = JSON.parse(replySetting.last_checked_tweet_ids);
    if (!Array.isArray(idsArray)) {
      return null;
    }
    
    // 配列から該当するBot IDのツイートIDを検索
    for (const entry of idsArray) {
      const parts = entry.split(':');
      if (parts.length === 2 && parts[0] === targetBotId.toString()) {
        return parts[1];
      }
    }
    
    return null;
  } catch (error) {
    log.warn(`Failed to get last_checked_tweet_id for bot ${targetBotId}: ${error.message}`);
    return null;
  }
}

/**
 * Bot名を取得（アカウントIDから）- エラー修正版
 */
function getBotNameById(configData, botId) {
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
 * Botアカウント情報を取得（アカウントIDから）- エラー修正版
 */
function getBotAccountById(configData, botId) {
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
 * 新仕様：返信監視・実行を処理 - エラー修正版
 */
async function processReplies(configData) {
  let successCount = 0;
  let errorCount = 0;
  let configUpdated = false;
  
  if (!configData.reply_settings || configData.reply_settings.length === 0) {
    log.info('📄 No reply settings found, skipping reply processing');
    return { successCount, errorCount };
  }

  log.info(`🔍 Processing ${configData.reply_settings.length} reply settings (NEW SPEC)...`);

  for (let settingIndex = 0; settingIndex < configData.reply_settings.length; settingIndex++) {
    const replySetting = configData.reply_settings[settingIndex];
    
    // アクティブでない設定はスキップ
    if (!replySetting.is_active) {
      log.debug(`Skipping inactive reply setting ${settingIndex + 1}`);
      continue;
    }

    try {
      // 新仕様：返信するBotの情報を取得（単一）
      const replyBotAccount = getBotAccountById(configData, replySetting.reply_bot_id);
      if (!replyBotAccount) {
        log.warn(`❌ Reply bot account not found for reply setting ${settingIndex + 1} (ID: ${replySetting.reply_bot_id})`);
        errorCount++;
        continue;
      }

      // 返信するBotがアクティブでない場合はスキップ
      if (replyBotAccount.status !== 'active') {
        log.debug(`⏸️ Skipping inactive reply bot: ${replyBotAccount.account_name}`);
        continue;
      }

      // 新仕様：監視対象Botのリストを取得（複数）
      let targetBotIds;
      try {
        targetBotIds = JSON.parse(replySetting.target_bot_ids);
        if (!Array.isArray(targetBotIds) || targetBotIds.length === 0) {
          log.warn(`❌ Invalid or empty target_bot_ids for reply setting ${settingIndex + 1}: ${replySetting.target_bot_ids}`);
          errorCount++;
          continue;
        }
      } catch (parseError) {
        log.error(`❌ Failed to parse target_bot_ids for reply setting ${settingIndex + 1}: ${parseError.message}`);
        log.error(`❌ Raw target_bot_ids value: ${replySetting.target_bot_ids}`);
        errorCount++;
        continue;
      }
      
      log.info(`🔍 Reply bot ${replyBotAccount.account_name} monitoring ${targetBotIds.length} targets...`);

      // 各監視対象Botをチェック
      let targetProcessed = 0;
      for (const targetBotId of targetBotIds) {
        log.debug(`🎯 Processing target bot ID: ${targetBotId}`);
        
        const targetBotAccount = getBotAccountById(configData, targetBotId);
        if (!targetBotAccount) {
          log.warn(`❌ Target bot account not found for ID: ${targetBotId}`);
          errorCount++;
          continue;
        }

        // 監視対象Botがアクティブでない場合はスキップ
        if (targetBotAccount.status !== 'active') {
          log.debug(`⏸️ Skipping inactive target bot: ${targetBotAccount.account_name}`);
          continue;
        }

        log.info(`👀 Checking ${targetBotAccount.account_name} (ID: ${targetBotId}) for new tweets...`);

        try {
          // 監視対象アカウントのTwitterクライアントを作成
          const targetClient = createTwitterClient(targetBotAccount);

          // この監視対象の最後にチェックしたツイートIDを取得
          const lastCheckedTweetId = getLastCheckedTweetId(replySetting, targetBotId);
          log.debug(`Last checked tweet ID for ${targetBotAccount.account_name}: ${lastCheckedTweetId}`);

          // 最新ツイートを取得
          const tweetsResult = await getUserTweets(
            targetClient, 
            targetBotAccount.account_name, 
            lastCheckedTweetId
          );

          if (!tweetsResult.success) {
            log.error(`❌ Failed to fetch tweets for ${targetBotAccount.account_name}: ${tweetsResult.error}`);
            errorCount++;
            continue;
          }

          const newTweets = tweetsResult.data;
          
          // ツイートデータの検証
          if (!Array.isArray(newTweets)) {
            log.warn(`⚠️ Invalid tweets data structure for ${targetBotAccount.account_name}: expected array, got ${typeof newTweets}`);
            continue;
          }
          
          if (newTweets.length === 0) {
            log.debug(`📭 No new tweets found for ${targetBotAccount.account_name}`);
            continue;
          }

          log.info(`📨 Found ${newTweets.length} new tweets from ${targetBotAccount.account_name}`);

          // 最新のツイートIDを記録（時系列で最新のもの）
          const latestTweet = newTweets[0];
          if (!latestTweet || !latestTweet.id) {
            log.warn(`⚠️ Invalid latest tweet structure for ${targetBotAccount.account_name}: ${JSON.stringify(latestTweet)}`);
            continue;
          }
          
          const latestTweetId = latestTweet.id;
          updateLastCheckedTweetIds(configData, settingIndex, targetBotId, latestTweetId);
          configUpdated = true;

          // 返信Botのクライアントを作成
          const replyClient = createTwitterClient(replyBotAccount);

          // 各新しいツイートに対して返信処理
          for (const tweet of newTweets) {
            // ツイートデータの検証
            if (!tweet || !tweet.id || !tweet.text) {
              log.warn(`⚠️ Skipping invalid tweet structure: ${JSON.stringify(tweet)}`);
              continue;
            }
            
            log.info(`💬 Processing tweet ${tweet.id} from ${targetBotAccount.account_name}: "${tweet.text.substring(0, 50)}..."`);

            try {
              // 返信を投稿
              const replyResult = await postReply(
                replyClient,
                replySetting.reply_content,
                tweet.id,
                replyBotAccount.account_name
              );

              if (replyResult.success) {
                successCount++;
                log.info(`✅ Reply posted by ${replyBotAccount.account_name} to ${targetBotAccount.account_name}'s tweet ${tweet.id}`);
              } else {
                errorCount++;
                log.error(`❌ Reply failed from ${replyBotAccount.account_name}: ${replyResult.error}`);
              }

              // レート制限を避けるため少し待機
              await new Promise(resolve => setTimeout(resolve, 2000));

            } catch (error) {
              errorCount++;
              log.error(`💥 Error posting reply from ${replyBotAccount.account_name}: ${error.message}`);
            }
          }

          targetProcessed++;
          // ツイート処理間の待機
          await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
          errorCount++;
          log.error(`💥 Error processing target bot ${targetBotAccount.account_name}: ${error.message}`);
          log.debug(`Error stack: ${error.stack}`);
        }
      }
      
      log.info(`📊 Reply setting ${settingIndex + 1} completed: processed ${targetProcessed}/${targetBotIds.length} targets`);

    } catch (error) {
      errorCount++;
      log.error(`💥 Error processing reply setting ${settingIndex + 1}: ${error.message}`);
      log.debug(`Error stack: ${error.stack}`);
    }

    // 設定間の待機
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // 設定ファイルが更新された場合は保存を試行
  if (configUpdated) {
    const saved = saveConfig(configData);
    if (!saved) {
      log.warn(`⚠️ Config file update failed for reply settings, but memory was updated`);
    }
  }

  return { successCount, errorCount };
}

/**
 * スケジュール投稿を処理（リスト対応版）
 */
async function processScheduledPosts(configData) {
  let successCount = 0;
  let errorCount = 0;
  let configUpdated = false;
  
  // メモリ内インデックス管理（同一実行内での重複回避）
  const memoryIndices = new Map();
  
  for (let botIndex = 0; botIndex < configData.bots.length; botIndex++) {
    const botConfig = configData.bots[botIndex];
    const account = botConfig.account;
    const scheduledTimes = botConfig.scheduled_times;
    
    // アカウントがアクティブでない場合はスキップ
    if (account.status !== 'active') {
      log.debug(`Skipping inactive bot: ${account.account_name}`);
      continue;
    }
    
    // 投稿内容を取得（メモリインデックスを考慮）
    const postInfo = getPostContentWithMemoryIndex(botConfig, memoryIndices, account.account_name);
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
      log.info(`📋 Current content (${postInfo.content.length} chars): "${postInfo.content}"`);
      log.debug(`Using index: ${postInfo.currentIndex} (memory: ${memoryIndices.has(account.account_name)})`);
    } else {
      log.info(`📝 Processing scheduled post for: ${account.account_name} [single content]`);
      log.info(`📋 Content (${postInfo.content.length} chars): "${postInfo.content}"`);
    }
    
    try {
      // Twitter クライアント作成
      const client = createTwitterClient(account);
      
      // ツイート投稿
      const result = await postTweet(client, postInfo.content, account.account_name);
      
      if (result.success) {
        successCount++;
        log.info(`✅ Scheduled tweet posted for ${account.account_name}`);
        
        // 投稿成功時のみインデックスを更新
        if (postInfo.isFromList) {
          const updated = updatePostIndexWithMemory(configData, botIndex, memoryIndices, account.account_name);
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
            const updated = updatePostIndexWithMemory(configData, botIndex, memoryIndices, account.account_name);
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
  
  // 設定ファイルが更新された場合は保存を試行
  if (configUpdated) {
    const saved = saveConfig(configData);
    if (!saved) {
      log.warn(`⚠️ Config file update failed, but memory indices were updated for this execution`);
    }
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
    log.info('🚀 Starting Twitter Auto Manager posting process (NEW REPLY SPEC - TWITTER API ERROR FIXED)...');
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
        if (botConfig.scheduled_content_list) {
          try {
            const contentList = JSON.parse(botConfig.scheduled_content_list);
            const currentIndex = botConfig.current_index || 0;
            log.debug(`Bot ${index + 1}: ${account.account_name} (ID: ${account.id}) - List: ${contentList.length} items, Current: ${currentIndex + 1}, Next content: "${contentList[currentIndex] || 'undefined'}"`);
          } catch (e) {
            log.debug(`Bot ${index + 1}: ${account.account_name} (ID: ${account.id}) - Invalid content list`);
          }
        } else if (botConfig.scheduled_content) {
          log.debug(`Bot ${index + 1}: ${account.account_name} (ID: ${account.id}) - Single content mode`);
        }
      }
    });
    
    // 返信設定の詳細ログ出力（デバッグ用）
    if (configData.reply_settings && configData.reply_settings.length > 0) {
      log.info(`🔗 Reply settings overview:`);
      configData.reply_settings.forEach((setting, index) => {
        if (setting.is_active) {
          try {
            const targetBotIds = JSON.parse(setting.target_bot_ids);
            const replyBotName = getBotNameById(configData, setting.reply_bot_id);
            const targetBotNames = targetBotIds.map(id => getBotNameById(configData, id)).join(', ');
            log.info(`  ${index + 1}. ${replyBotName} (ID: ${setting.reply_bot_id}) → monitors [${targetBotNames}] (IDs: [${targetBotIds.join(', ')}])`);
          } catch (e) {
            log.warn(`  ${index + 1}. Invalid reply setting format: ${e.message}`);
            log.debug(`  Raw setting: ${JSON.stringify(setting)}`);
          }
        }
      });
    }
    
    // スケジュール投稿を処理
    const scheduledResults = await processScheduledPosts(configData);
    log.info(`📈 Scheduled posts: ${scheduledResults.successCount} success, ${scheduledResults.errorCount} errors`);
    
    // 返信処理を実行
    const replyResults = await processReplies(configData);
    log.info(`💬 Reply posts: ${replyResults.successCount} success, ${replyResults.errorCount} errors`);
    
    // 結果サマリー
    const totalSuccess = scheduledResults.successCount + replyResults.successCount;
    const totalErrors = scheduledResults.errorCount + replyResults.errorCount;
    
    log.info(`🏁 Processing completed: ${totalSuccess} total success, ${totalErrors} total errors`);
    log.info(`📊 Breakdown: Scheduled(${scheduledResults.successCount}/${scheduledResults.errorCount}), Replies(${replyResults.successCount}/${replyResults.errorCount})`);
    
    // 🔧 重要: 設定ファイル更新の最終確認
    if (existsSync(config.configPath)) {
      try {
        const finalConfig = JSON.parse(readFileSync(config.configPath, 'utf8'));
        log.info(`📋 Final configuration state:`);
        if (finalConfig.bots) {
          finalConfig.bots.forEach((bot, index) => {
            if (bot.account && bot.current_index !== undefined) {
              log.info(`  🤖 ${bot.account.account_name}: current_index = ${bot.current_index}`);
            }
          });
        }
        
        // Git への反映を確実にするため少し待機
        log.info(`⏳ Waiting for file system sync...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        log.info(`✅ File system sync completed`);
        
      } catch (parseError) {
        log.error(`❌ Failed to read final config: ${parseError.message}`);
      }
    }
    
    if (totalErrors > 0) {
      log.warn(`⚠️ Process completed with ${totalErrors} errors`);
      process.exit(1);
    } else {
      log.info(`🎉 Process completed successfully!`);
    }
    
  } catch (error) {
    log.error(`💥 Main process error: ${error.message}`);
    log.debug(`Error stack: ${error.stack}`);
    process.exit(1);
  }
}

/**
 * エラーハンドリング
 */
process.on('uncaughtException', (error) => {
  log.error(`💥 Uncaught exception: ${error.message}`);
  log.debug(`Error stack: ${error.stack}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log.error(`💥 Unhandled rejection at: ${promise}, reason: ${reason}`);
  process.exit(1);
});

// スクリプト実行
main().catch((error) => {
  log.error(`💥 Script execution failed: ${error.message}`);
  log.debug(`Error stack: ${error.stack}`);
  process.exit(1);
});