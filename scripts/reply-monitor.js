#!/usr/bin/env node

/**
 * Twitter Bot 返信監視スクリプト（返信専用版）
 * 返信監視・実行のみを処理 - スケジュール投稿は別ファイル
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
 * ユーザーの最新ツイートを取得 - Rate Limit対応版・データ構造修正版
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
    log.info(`📦 Has data: ${!!tweetsResponse.data}`);
    log.info(`📦 Data type: ${typeof tweetsResponse.data}`);
    log.info(`📦 Data is array: ${Array.isArray(tweetsResponse.data)}`);
    
    if (tweetsResponse.data) {
      log.info(`📦 Data length: ${Array.isArray(tweetsResponse.data) ? tweetsResponse.data.length : 'not array'}`);
    }

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

    // 🔧 重要：データの正規化（データ構造エラー修正・ログ強化版）
    let tweets = [];
    
    if (!tweetsResponse.data) {
      log.warn(`⚠️ No tweetsResponse.data for ${username}`);
      tweets = [];
    } else if (Array.isArray(tweetsResponse.data)) {
      tweets = tweetsResponse.data;
      log.info(`✅ Tweets data is properly formatted array with ${tweets.length} items`);
      
      // 各ツイートの構造を検証
      tweets.forEach((tweet, index) => {
        log.info(`🔍 Tweet ${index + 1} structure: type=${typeof tweet}, hasId=${!!tweet.id}, hasText=${!!tweet.text}`);
        if (tweet && typeof tweet === 'object' && tweet.id && tweet.text) {
          log.info(`  ✅ Valid tweet ${index + 1}: ID=${tweet.id}, Text="${tweet.text.substring(0, 30)}..."`);
        } else {
          log.warn(`  ❌ Invalid tweet ${index + 1}: ${JSON.stringify(tweet).substring(0, 200)}...`);
        }
      });
    } else {
      // データが配列でない場合の詳細ログ
      log.warn(`⚠️ tweetsResponse.data is not an array for ${username}`);
      log.warn(`Data type: ${typeof tweetsResponse.data}`);
      log.warn(`Data content: ${JSON.stringify(tweetsResponse.data).substring(0, 200)}...`);
      
      // 単一オブジェクトかどうかチェック
      if (typeof tweetsResponse.data === 'object' && tweetsResponse.data.id && tweetsResponse.data.text) {
        tweets = [tweetsResponse.data];
        log.info(`🔄 Converted single tweet object to array`);
      } else {
        log.error(`❌ Unexpected data structure: ${JSON.stringify(tweetsResponse.data)}`);
        tweets = [];
      }
    }

    log.info(`📊 Final processed tweets count: ${tweets.length} for ${username}`);
    
    // 🔍 返すデータの最終検証
    log.info(`🔍 Returning data structure: isArray=${Array.isArray(tweets)}, length=${tweets.length}`);
    
    return {
      data: tweets,  // これは確実に配列
      success: true,
      meta: tweetsResponse.meta
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
 * 新仕様：返信監視・実行を処理 - データ構造エラー修正版
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
            // Rate Limitエラーの特別処理
            if (tweetsResult.rateLimited) {
              log.warn(`⏰ Rate limit reached for ${targetBotAccount.account_name}, skipping this cycle`);
              continue; // エラーカウントせずに次へ
            } else {
              log.error(`❌ Failed to fetch tweets for ${targetBotAccount.account_name}: ${tweetsResult.error}`);
              errorCount++;
              continue;
            }
          }

          // 🔧 重要：データ構造の修正（配列であることを保証）・詳細ログ版
          const newTweets = tweetsResult.data;
          
          log.info(`📦 Tweet data received: type=${typeof newTweets}, isArray=${Array.isArray(newTweets)}`);
          
          if (newTweets && Array.isArray(newTweets)) {
            log.info(`📦 Tweet array length: ${newTweets.length}`);
            
            // 配列の各要素の構造を詳しく検証
            newTweets.forEach((item, index) => {
              log.info(`🔍 Item ${index + 1} analysis:`);
              log.info(`  Type: ${typeof item}`);
              log.info(`  Is object: ${typeof item === 'object' && item !== null}`);
              
              if (typeof item === 'object' && item !== null) {
                // オブジェクトのキーを確認
                const keys = Object.keys(item);
                log.info(`  Keys: [${keys.join(', ')}]`);
                
                // Twitter APIレスポンス全体が混入している場合の検出
                if (keys.includes('data') && keys.includes('meta')) {
                  log.error(`❌ Item ${index + 1}: API response object detected instead of tweet!`);
                  log.error(`  This is the root cause: ${JSON.stringify(item).substring(0, 200)}...`);
                  return; // この要素はスキップ
                }
                
                // 正しいツイートオブジェクトの検証
                if (item.id && item.text) {
                  log.info(`  ✅ Valid tweet: ID=${item.id}, Text="${item.text.substring(0, 30)}..."`);
                } else {
                  log.warn(`  ⚠️ Missing required fields: hasId=${!!item.id}, hasText=${!!item.text}`);
                  log.warn(`  Content: ${JSON.stringify(item).substring(0, 100)}...`);
                }
              } else {
                log.error(`❌ Item ${index + 1}: Not an object - ${JSON.stringify(item)}`);
              }
            });
          } else {
            log.error(`❌ newTweets is not an array: type=${typeof newTweets}`);
            log.error(`Content: ${JSON.stringify(newTweets).substring(0, 200)}...`);
          }
          
          // ⚠️ データ構造の検証強化
          if (!Array.isArray(newTweets)) {
            log.warn(`⚠️ Invalid tweets data structure for ${targetBotAccount.account_name}: expected array, got ${typeof newTweets}`);
            log.debug(`Raw data: ${JSON.stringify(newTweets).substring(0, 100)}...`);
            continue;
          }
          
          // 🔧 APIレスポンス全体が混入している場合の修正処理
          const validTweets = [];
          for (let i = 0; i < newTweets.length; i++) {
            const item = newTweets[i];
            
            // APIレスポンス全体が混入している場合の検出と修正
            if (typeof item === 'object' && item !== null && item.data && item.meta && Array.isArray(item.data)) {
              log.warn(`🔧 Detected API response object at index ${i}, extracting tweets...`);
              // APIレスポンス内のdata配列を抽出
              item.data.forEach(tweet => {
                if (tweet && typeof tweet === 'object' && tweet.id && tweet.text) {
                  validTweets.push(tweet);
                  log.info(`  ↳ Extracted valid tweet: ${tweet.id}`);
                }
              });
            } else if (typeof item === 'object' && item !== null && item.id && item.text) {
              // 正常なツイートオブジェクト
              validTweets.push(item);
              log.info(`  ✅ Valid tweet: ${item.id}`);
            } else {
              log.warn(`  ❌ Skipping invalid item at index ${i}: ${JSON.stringify(item).substring(0, 100)}...`);
            }
          }
          
          if (validTweets.length === 0) {
            log.debug(`📭 No valid tweets found for ${targetBotAccount.account_name} after processing`);
            continue;
          }

          log.info(`📨 Found ${validTweets.length} valid tweets from ${targetBotAccount.account_name}`);

          // 最新のツイートIDを記録（時系列で最新のもの）
          const latestTweet = validTweets[0];
          
          // 🔧 ツイートオブジェクトの構造検証強化
          if (!latestTweet || typeof latestTweet !== 'object' || !latestTweet.id) {
            log.warn(`⚠️ Invalid latest tweet structure for ${targetBotAccount.account_name}`);
            log.debug(`Latest tweet data: ${JSON.stringify(latestTweet)}`);
            continue;
          }
          
          const latestTweetId = latestTweet.id;
          log.info(`📌 Latest tweet ID: ${latestTweetId} from ${targetBotAccount.account_name}`);
          updateLastCheckedTweetIds(configData, settingIndex, targetBotId, latestTweetId);
          configUpdated = true;

          // 返信Botのクライアントを作成
          const replyClient = createTwitterClient(replyBotAccount);

          // 各新しいツイートに対して返信処理
          for (const tweet of validTweets) {
            // 🔧 ツイートデータの詳細検証（既に validTweets で検証済みだが念のため）
            if (!tweet || typeof tweet !== 'object' || !tweet.id || !tweet.text) {
              log.warn(`⚠️ Skipping invalid tweet structure`);
              log.debug(`Invalid tweet: ${JSON.stringify(tweet)}`);
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

              // Rate制限を避けるため待機時間を増加
              await new Promise(resolve => setTimeout(resolve, 3000));

            } catch (error) {
              errorCount++;
              log.error(`💥 Error posting reply from ${replyBotAccount.account_name}: ${error.message}`);
            }
          }

          targetProcessed++;
          // Rate Limit対策: ツイート処理間の待機時間を増加
          await new Promise(resolve => setTimeout(resolve, 2000));

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

    // Rate Limit対策: 設定間の待機時間を増加
    await new Promise(resolve => setTimeout(resolve, 2000));
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

  return { successCount, errorCount };
}

/**
 * メイン処理（返信監視のみ）
 */
async function main() {
  try {
    log.info('🚀 Starting Twitter Auto Manager - REPLY MONITORING ONLY (DEBUG VERSION)...');
    log.info(`📊 Environment: ${process.env.NODE_ENV || 'production'}`);
    log.info(`🔄 Dry run: ${config.dryRun}`);
    log.info(`⏰ Current time (JST): ${getJapanTime()}`);
    log.info(`⚡ Rate limit optimizations: Extended wait times, reduced API calls`);
    log.info(`🔧 Enhanced debugging: Data structure validation enabled`);
    
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
      log.warn(`🚨 Please check Twitter API rate limits and data structure processing.`);
      
      log.error(`❌ Process completed with ${replyResults.errorCount} errors - requires investigation`);
      process.exit(1);
    } else {
      log.info(`🎉 Reply monitoring completed successfully!`);
      log.info(`📊 Result: ${replyResults.successCount} replies posted successfully`);
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