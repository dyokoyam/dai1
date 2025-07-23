#!/usr/bin/env node

/**
 * Twitter Bot 返信監視スクリプト（返信専用版・重複監視対策版）
 * 返信監視・実行のみを処理 - スケジュール投稿は別ファイル
 * 
 * 🆕 同一ターゲット重複監視対策:
 * - 監視対象アカウントごとに1回だけツイート取得
 * - 取得したツイートを複数の返信Botで共有
 * - Rate Limit問題を根本的に解決
 */

import { 
  config, 
  log, 
  loadConfig, 
  saveConfig, 
  createTwitterClient, 
  getBotAccountById,
  getBotNameById,
  getJapanTime,
  setupErrorHandling 
} from './shared-utils.js';
import { readFileSync } from 'fs';

// 一時的にデバッグログを強制出力（問題特定のため）
const originalDebug = log.debug;
log.debug = (msg) => {
  console.log(`[DEBUG] ${new Date().toISOString()} ${msg}`);
};

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
 * ユーザーの最新ツイートを取得 - twitter-api-v2 ライブラリ対応版
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

    log.info(`🔍 Getting tweets for user: ${username}, since: ${sinceId || 'beginning'}`);

    // Rate Limit対策: 事前待機
    await new Promise(resolve => setTimeout(resolve, 1000));

    // ユーザー名からユーザーIDを取得
    const userResponse = await client.v2.userByUsername(username);
    if (!userResponse.data) {
      throw new Error(`User ${username} not found`);
    }

    const userId = userResponse.data.id;
    log.info(`📋 Found user ID: ${userId} for ${username}`);

    // Rate Limit対策: API呼び出し間の待機
    await new Promise(resolve => setTimeout(resolve, 1500));

    // ツイートを取得
    const options = {
      max_results: 5,  // Rate Limit対応
      'tweet.fields': ['created_at', 'conversation_id', 'author_id'],
      exclude: 'retweets,replies'  // リツイートと返信を除外
    };

    if (sinceId) {
      options.since_id = sinceId;
      log.info(`📅 Using since_id: ${sinceId}`);
    }

    log.info(`🚀 Fetching tweets with options: ${JSON.stringify(options)}`);
    const tweetsResponse = await client.v2.userTimeline(userId, options);
    
    // 🔧 重要：APIレスポンス全体の構造をログ出力（問題特定用）
    log.info(`📦 RAW API Response: ${JSON.stringify(tweetsResponse).substring(0, 500)}...`);
    log.info(`📦 Response type: ${typeof tweetsResponse}`);
    log.info(`📦 Response keys: [${Object.keys(tweetsResponse).join(', ')}]`);

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

    // 🔧 重要：twitter-api-v2ライブラリの正しいデータアクセス方法
    let tweets = [];
    let meta = null;
    
    // twitter-api-v2の複数のデータアクセスパターンに対応
    if (tweetsResponse._realData && tweetsResponse._realData.data) {
      // パターン1: _realData構造の場合
      log.info(`📦 Using _realData structure`);
      tweets = tweetsResponse._realData.data;
      meta = tweetsResponse._realData.meta;
      log.info(`✅ Found ${tweets.length} tweets in _realData.data`);
    } else if (Array.isArray(tweetsResponse.data)) {
      // パターン2: 直接data配列の場合
      log.info(`📦 Using direct data array structure`);
      tweets = tweetsResponse.data;
      meta = tweetsResponse.meta;
      log.info(`✅ Found ${tweets.length} tweets in direct data array`);
    } else if (tweetsResponse.data && typeof tweetsResponse.data === 'object' && tweetsResponse.data.data) {
      // パターン3: data.data構造の場合
      log.info(`📦 Using data.data structure`);
      tweets = tweetsResponse.data.data;
      meta = tweetsResponse.data.meta;
      log.info(`✅ Found ${tweets.length} tweets in data.data`);
    } else {
      // パターン4: その他の構造を詳細に調査
      log.warn(`⚠️ Unexpected response structure, investigating...`);
      log.info(`📦 Has data: ${!!tweetsResponse.data}`);
      log.info(`📦 Data type: ${typeof tweetsResponse.data}`);
      log.info(`📦 Data is array: ${Array.isArray(tweetsResponse.data)}`);
      
      if (tweetsResponse.data) {
        log.info(`📦 Data keys: [${Object.keys(tweetsResponse.data).join(', ')}]`);
        log.info(`📦 Data content sample: ${JSON.stringify(tweetsResponse.data).substring(0, 200)}...`);
      }
      
      // フォールバック：可能な限りデータを抽出
      if (typeof tweetsResponse.data === 'object' && tweetsResponse.data.id && tweetsResponse.data.text) {
        // 単一ツイートオブジェクトの場合
        tweets = [tweetsResponse.data];
        log.info(`🔄 Converted single tweet object to array`);
      } else {
        log.error(`❌ Unable to extract tweets from response structure`);
        tweets = [];
      }
    }

    // ツイートデータの検証
    if (Array.isArray(tweets)) {
      log.info(`📊 Processing ${tweets.length} tweets`);
      
      // 各ツイートの構造を検証
      const validTweets = [];
      tweets.forEach((tweet, index) => {
        if (tweet && typeof tweet === 'object' && tweet.id && tweet.text) {
          validTweets.push(tweet);
          log.info(`  ✅ Valid tweet ${index + 1}: ID=${tweet.id}, Text="${tweet.text.substring(0, 30)}..."`);
        } else {
          log.warn(`  ❌ Invalid tweet ${index + 1}: ${JSON.stringify(tweet).substring(0, 100)}...`);
        }
      });
      
      tweets = validTweets;
      log.info(`📊 Final processed tweets count: ${tweets.length} for ${username}`);
    } else {
      log.error(`❌ tweets is not an array: ${typeof tweets}`);
      tweets = [];
    }
    
    return {
      data: tweets,  // 検証済みのツイート配列
      success: true,
      meta: meta
    };
  } catch (error) {
    // Rate Limit エラーの特別処理
    if (error.message && error.message.includes('429')) {
      log.warn(`⏰ Rate limit reached for ${username}. Will retry later.`);
      return { 
        success: false, 
        error: `Rate limit reached (429)`, 
        data: [],
        rateLimited: true 
      };
    }
    
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
 * 🆕 監視対象アカウントのツイートを事前にキャッシュ
 * Rate Limit問題を解決するため、同一ターゲットは1回だけAPI呼び出し
 */
async function preloadTargetTweets(configData) {
  const tweetsCache = new Map(); // targetBotId -> { tweets: [], account: BotAccount, error: string|null }
  const targetAccountsToFetch = new Set();
  
  // 1. 全返信設定から監視対象アカウントを収集（重複除去）
  log.info(`🔄 Phase 1: Collecting unique target accounts to fetch...`);
  
  for (const replySetting of configData.reply_settings) {
    if (!replySetting.is_active) continue;
    
    try {
      const targetBotIds = JSON.parse(replySetting.target_bot_ids);
      if (Array.isArray(targetBotIds)) {
        targetBotIds.forEach(id => {
          const targetAccount = getBotAccountById(configData, id);
          if (targetAccount && targetAccount.status === 'active') {
            targetAccountsToFetch.add(id);
          }
        });
      }
    } catch (e) {
      // パースエラーは後で処理
    }
  }
  
  log.info(`📋 Found ${targetAccountsToFetch.size} unique target accounts to fetch: [${Array.from(targetAccountsToFetch).join(', ')}]`);
  
  // 2. 監視対象アカウントごに1回だけツイートを取得してキャッシュ
  log.info(`🔄 Phase 2: Fetching tweets for each target account...`);
  
  for (const targetBotId of targetAccountsToFetch) {
    const targetAccount = getBotAccountById(configData, targetBotId);
    if (!targetAccount) {
      log.warn(`⚠️ Target account ${targetBotId} not found during preload`);
      continue;
    }
    
    log.info(`📡 [CACHE] Fetching tweets for ${targetAccount.account_name} (ID: ${targetBotId})...`);
    
    try {
      // Twitter クライアントを作成
      const targetClient = createTwitterClient(targetAccount);
      
      // 🔧 last_checked_tweet_idの取得：全返信設定から最新の値を取得
      let mostRecentLastCheckedId = null;
      for (const replySetting of configData.reply_settings) {
        if (!replySetting.is_active) continue;
        
        try {
          const targetBotIds = JSON.parse(replySetting.target_bot_ids);
          if (targetBotIds.includes(targetBotId)) {
            const lastCheckedId = getLastCheckedTweetId(replySetting, targetBotId);
            if (lastCheckedId) {
              // より新しいツイートIDを優先（IDは時系列順なので数値比較可能）
              if (!mostRecentLastCheckedId || lastCheckedId > mostRecentLastCheckedId) {
                mostRecentLastCheckedId = lastCheckedId;
              }
            }
          }
        } catch (e) {
          // パースエラーは無視
        }
      }
      
      log.debug(`[CACHE] Most recent last_checked_tweet_id for ${targetAccount.account_name}: ${mostRecentLastCheckedId}`);
      
      // ツイートを取得
      const tweetsResult = await getUserTweets(
        targetClient, 
        targetAccount.account_name, 
        mostRecentLastCheckedId
      );
      
      if (tweetsResult.success) {
        tweetsCache.set(targetBotId, {
          tweets: tweetsResult.data || [],
          account: targetAccount,
          error: null,
          lastCheckedId: mostRecentLastCheckedId
        });
        log.info(`✅ [CACHE] Successfully cached ${tweetsResult.data.length} tweets for ${targetAccount.account_name}`);
      } else {
        tweetsCache.set(targetBotId, {
          tweets: [],
          account: targetAccount,
          error: tweetsResult.error,
          rateLimited: tweetsResult.rateLimited || false
        });
        
        if (tweetsResult.rateLimited) {
          log.warn(`⏰ [CACHE] Rate limit reached for ${targetAccount.account_name} - cached as rate limited`);
        } else {
          log.error(`❌ [CACHE] Failed to fetch tweets for ${targetAccount.account_name}: ${tweetsResult.error}`);
        }
      }
      
      // Rate Limit対策: アカウント間の待機時間
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      log.error(`💥 [CACHE] Error fetching tweets for ${targetAccount.account_name}: ${error.message}`);
      tweetsCache.set(targetBotId, {
        tweets: [],
        account: targetAccount,
        error: error.message
      });
    }
  }
  
  log.info(`🎯 Phase 2 completed: Cached tweets for ${tweetsCache.size} target accounts`);
  return tweetsCache;
}

/**
 * 🆕 新仕様：返信監視・実行を処理 - キャッシュ最適化版
 * 同一ターゲットの重複監視対策を実装
 */
async function processReplies(configData) {
  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  let configUpdated = false;
  
  if (!configData.reply_settings || configData.reply_settings.length === 0) {
    log.info('📄 No reply settings found, skipping reply processing');
    return { successCount, errorCount };
  }

  log.info(`🔍 Processing ${configData.reply_settings.length} reply settings (CACHE OPTIMIZED VERSION)...`);
  
  // 🆕 Phase 1 & 2: 監視対象アカウントのツイートを事前にキャッシュ
  const tweetsCache = await preloadTargetTweets(configData);
  
  // Phase 3: 各返信設定を処理（キャッシュを使用）
  log.info(`🔄 Phase 3: Processing reply settings using cached tweets...`);

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
        log.warn(`⚠️ Skipping orphaned reply setting: reply_bot_id ${replySetting.reply_bot_id} not found (setting may be outdated)`);
        log.info(`📝 Available bot IDs: ${configData.bots.map(b => `${b.account.id}(${b.account.account_name})`).join(', ')}`);
        skippedCount++;
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
          log.warn(`⚠️ Skipping reply setting with invalid target_bot_ids: ${replySetting.target_bot_ids}`);
          skippedCount++;
          continue;
        }
      } catch (parseError) {
        log.warn(`⚠️ Skipping reply setting with unparseable target_bot_ids: ${replySetting.target_bot_ids}`);
        log.debug(`Parse error: ${parseError.message}`);
        skippedCount++;
        continue;
      }
      
      log.info(`🔍 Reply bot ${replyBotAccount.account_name} monitoring ${targetBotIds.length} targets (using cache)...`);

      // 🆕 各監視対象Botをチェック（キャッシュを使用）
      let targetProcessed = 0;
      for (const targetBotId of targetBotIds) {
        log.debug(`🎯 Processing target bot ID: ${targetBotId} (from cache)`);
        
        // キャッシュから取得
        const cachedData = tweetsCache.get(targetBotId);
        if (!cachedData) {
          log.warn(`⚠️ No cached data for target bot ID: ${targetBotId}`);
          continue;
        }
        
        const targetBotAccount = cachedData.account;
        log.info(`👀 [CACHE] Processing ${targetBotAccount.account_name} (ID: ${targetBotId})...`);

        // Rate Limitエラーのチェック
        if (cachedData.rateLimited) {
          log.warn(`⏰ [CACHE] Rate limit detected for ${targetBotAccount.account_name}, skipping this cycle`);
          continue;
        }
        
        // その他のエラーチェック
        if (cachedData.error) {
          log.error(`❌ [CACHE] Cached error for ${targetBotAccount.account_name}: ${cachedData.error}`);
          errorCount++;
          continue;
        }

        // キャッシュからツイートを取得
        const newTweets = cachedData.tweets;
        
        log.info(`📦 [CACHE] Retrieved ${newTweets.length} tweets for ${targetBotAccount.account_name}`);
        
        if (newTweets.length === 0) {
          log.debug(`📭 [CACHE] No new tweets found for ${targetBotAccount.account_name}`);
          continue;
        }

        log.info(`📨 [CACHE] Found ${newTweets.length} tweets from ${targetBotAccount.account_name}`);

        // 最新のツイートIDを記録（時系列で最新のもの）
        const latestTweet = newTweets[0];
        
        if (!latestTweet || typeof latestTweet !== 'object' || !latestTweet.id) {
          log.warn(`⚠️ [CACHE] Invalid latest tweet structure for ${targetBotAccount.account_name}`);
          log.debug(`Latest tweet data: ${JSON.stringify(latestTweet)}`);
          continue;
        }
        
        const latestTweetId = latestTweet.id;
        log.info(`📌 [CACHE] Latest tweet ID: ${latestTweetId} from ${targetBotAccount.account_name}`);
        updateLastCheckedTweetIds(configData, settingIndex, targetBotId, latestTweetId);
        configUpdated = true;

        // 返信Botのクライアントを作成
        const replyClient = createTwitterClient(replyBotAccount);

        // 各新しいツイートに対して返信処理
        for (const tweet of newTweets) {
          if (!tweet || typeof tweet !== 'object' || !tweet.id || !tweet.text) {
            log.warn(`⚠️ Skipping invalid tweet structure`);
            log.debug(`Invalid tweet: ${JSON.stringify(tweet)}`);
            continue;
          }
          
          log.info(`💬 [CACHE] Processing tweet ${tweet.id} from ${targetBotAccount.account_name}: "${tweet.text.substring(0, 50)}..."`);

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
              log.info(`✅ [CACHE] Reply posted by ${replyBotAccount.account_name} to ${targetBotAccount.account_name}'s tweet ${tweet.id}`);
            } else {
              errorCount++;
              log.error(`❌ [CACHE] Reply failed from ${replyBotAccount.account_name}: ${replyResult.error}`);
            }

            // Rate制限を避けるため待機時間を増加
            await new Promise(resolve => setTimeout(resolve, 3000));

          } catch (error) {
            errorCount++;
            log.error(`💥 [CACHE] Error posting reply from ${replyBotAccount.account_name}: ${error.message}`);
          }
        }

        targetProcessed++;
        // Rate Limit対策: ツイート処理間の待機時間
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      log.info(`📊 Reply setting ${settingIndex + 1} completed: processed ${targetProcessed}/${targetBotIds.length} targets (cached)`);

    } catch (error) {
      errorCount++;
      log.error(`💥 Error processing reply setting ${settingIndex + 1}: ${error.message}`);
      log.debug(`Error stack: ${error.stack}`);
    }

    // Rate Limit対策: 設定間の待機時間
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // 設定ファイルが更新された場合は保存を試行
  if (configUpdated) {
    log.info(`💾 Reply configuration has been updated, attempting to save...`);
    const saved = saveConfig(configData);
    if (!saved) {
      log.warn(`⚠️ Config file update failed for reply settings, but memory was updated`);
    } else {
      log.info(`✅ Reply settings configuration saved successfully`);
      
      // 🔧 GitHub Actions自動コミット確認用ログ
      log.info(`📝 IMPORTANT: Reply configuration has been updated for GitHub Actions auto-commit`);
      log.info(`📂 Updated file: ${config.configPath}`);
      log.info(`🕐 Update timestamp: ${new Date().toISOString()}`);
      
      // 設定ファイルの現在の状態を出力
      try {
        const currentConfig = JSON.parse(readFileSync(config.configPath, 'utf8'));
        if (currentConfig.reply_settings) {
          log.info(`🔗 Current reply settings count: ${currentConfig.reply_settings.length}`);
          currentConfig.reply_settings.forEach((setting, index) => {
            if (setting.is_active) {
              log.info(`  Reply setting ${index + 1}: last_checked_tweet_ids = ${setting.last_checked_tweet_ids}`);
            }
          });
        }
      } catch (e) {
        log.warn(`Failed to read updated config for verification: ${e.message}`);
      }
    }
  }

  // スキップされた設定がある場合の情報ログ
  if (skippedCount > 0) {
    log.info(`📋 Summary: ${skippedCount} reply settings were skipped due to outdated configuration (orphaned bot references)`);
    log.info(`💡 These orphaned settings can be cleaned up by deleting and recreating the affected reply configurations`);
  }

  return { successCount, errorCount };
}

/**
 * メイン処理（返信監視のみ）
 */
async function main() {
  try {
    log.info('🚀 Starting Twitter Auto Manager - REPLY MONITORING ONLY (CACHE OPTIMIZED VERSION)...');
    log.info(`📊 Environment: ${process.env.NODE_ENV || 'production'}`);
    log.info(`🔄 Dry run: ${config.dryRun}`);
    log.info(`⏰ Current time (JST): ${getJapanTime()}`);
    log.info(`⚡ Rate limit optimizations: Extended wait times, reduced API calls`);
    log.info(`🔧 Enhanced debugging: Data structure validation enabled`);
    log.info(`🛡️ Orphaned setting detection: Skip outdated bot references without errors`);
    log.info(`🆕 Cache optimization: Same target tweets fetched only once, shared across reply bots`);
    
    // 設定ファイルを読み込み
    const configData = loadConfig();
    
    if (!configData) {
      log.error('❌ No configuration found');
      process.exit(1);
    }

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
    
    // 返信処理を実行
    const replyResults = await processReplies(configData);
    log.info(`💬 Reply monitoring result: ${replyResults.successCount} success, ${replyResults.errorCount} errors`);
    
    // 結果サマリー
    if (replyResults.errorCount > 0) {
      log.warn(`🚨 ATTENTION: ${replyResults.errorCount} reply errors detected!`);
      log.warn(`🚨 This indicates actual processing errors (API failures, network issues, etc.)`);
      log.warn(`🚨 Please check Twitter API rate limits, authentication, and network connectivity.`);
      
      log.error(`❌ Process completed with ${replyResults.errorCount} errors - requires investigation`);
      process.exit(1);
    } else {
      log.info(`🎉 Reply monitoring completed successfully!`);
      log.info(`📊 Result: ${replyResults.successCount} replies posted successfully`);
      if (replyResults.successCount === 0) {
        log.info(`💡 No replies posted this time - this is normal if no new tweets were found from monitored accounts`);
      }
    }
    
  } catch (error) {
    log.error(`💥 Main process error: ${error.message}`);
    log.debug(`Error stack: ${error.stack}`);
    process.exit(1);
  }
}

// エラーハンドリング設定
setupErrorHandling();

// スクリプト実行
main().catch((error) => {
  log.error(`💥 Script execution failed: ${error.message}`);
  log.debug(`Error stack: ${error.stack}`);
  process.exit(1);
});