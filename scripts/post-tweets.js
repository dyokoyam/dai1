#!/usr/bin/env node

/**
 * Twitter Bot 自動投稿スクリプト（自動投稿専用版）
 * スケジュール投稿のみを処理 - 返信機能は別ファイル
 */

import { 
  config, 
  log, 
  loadConfig, 
  saveConfig, 
  createTwitterClient, 
  shouldPostNow, 
  getJapanTime,
  setupErrorHandling 
} from './shared-utils.js';

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
      log.info(`✅ Successfully posted tweet for ${botName}: ${response.data.id}`);
      return { ...response, success: true };
    } else {
      throw new Error('No data in response');
    }
  } catch (error) {
    log.error(`❌ Failed to post tweet for ${botName}: ${error.message}`);
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
    log.info(`💾 Scheduled posts configuration has been updated, attempting to save...`);
    const saved = saveConfig(configData);
    if (!saved) {
      log.warn(`⚠️ Config file update failed, but memory indices were updated for this execution`);
    } else {
      log.info(`✅ Scheduled posts configuration saved successfully`);
      
      // 🔧 GitHub Actions自動コミット確認用ログ
      log.info(`📝 CRITICAL: Post indices have been updated for GitHub Actions auto-commit`);
      log.info(`📂 Updated file: ${config.configPath}`);
      log.info(`🕐 Update timestamp: ${new Date().toISOString()}`);
      
      // 更新されたインデックス情報をログ出力
      try {
        const currentConfig = JSON.parse(readFileSync(config.configPath, 'utf8'));
        if (currentConfig.bots) {
          log.info(`🤖 Updated bot indices in saved config:`);
          currentConfig.bots.forEach((bot, index) => {
            if (bot.account && bot.current_index !== undefined) {
              log.info(`  ${bot.account.account_name}: current_index = ${bot.current_index}`);
            }
          });
        }
      } catch (e) {
        log.warn(`Failed to read updated config for verification: ${e.message}`);
      }
      
      // 🚨 自動コミット機能への重要な警告
      log.warn(`🚨 GITHUB ACTIONS: Please check if auto-commit is working properly!`);
      log.warn(`🚨 If indices are not committed, duplicate posts will occur in next execution.`);
    }
  }
  
  return { successCount, errorCount };
}

/**
 * メイン処理（自動投稿のみ）
 */
async function main() {
  try {
    log.info('🚀 Starting Twitter Auto Manager - SCHEDULED POSTS ONLY...');
    log.info(`📊 Environment: ${process.env.NODE_ENV || 'production'}`);
    log.info(`🔄 Dry run: ${config.dryRun}`);
    log.info(`⏰ Current time (JST): ${getJapanTime()}`);
    
    // 設定ファイルを読み込み
    const configData = loadConfig();
    
    if (!configData || !configData.bots || configData.bots.length === 0) {
      log.error('❌ No configuration found or no bots configured');
      process.exit(1);
    }

    log.info(`📋 Processing ${configData.bots.length} configured bots for scheduled posts...`);
    
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
    
    // スケジュール投稿を処理
    const scheduledResults = await processScheduledPosts(configData);
    log.info(`📈 Scheduled posts result: ${scheduledResults.successCount} success, ${scheduledResults.errorCount} errors`);
    
    // 結果サマリー
    if (scheduledResults.errorCount > 0) {
      log.warn(`🚨 ATTENTION: ${scheduledResults.errorCount} scheduled post errors detected!`);
      log.warn(`🚨 This might indicate duplicate content issues (403 errors).`);
      log.warn(`🚨 Please check if GitHub Actions auto-commit is working properly.`);
      log.warn(`🚨 If post indices are not committed to Git, duplicates will continue to occur.`);
      
      log.error(`❌ Process completed with ${scheduledResults.errorCount} errors - requires investigation`);
      process.exit(1);
    } else {
      log.info(`🎉 Scheduled posts completed successfully!`);
      log.info(`📊 Result: ${scheduledResults.successCount} posts sent successfully`);
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