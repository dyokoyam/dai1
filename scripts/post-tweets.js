#!/usr/bin/env node

/**
 * Twitter Bot 自動投稿スクリプト
 * GitHub Actions で実行され、予定されたツイートを投稿する
 */

import { TwitterApi } from 'twitter-api-v2';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import dotenv from 'dotenv';

// ES modules での __dirname 取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 環境変数読み込み
dotenv.config();

// 設定
const config = {
  dbPath: process.env.DB_PATH || join(__dirname, '../data/twitter-auto-manager.sqlite'),
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
 * データベース接続を開く
 */
async function openDatabase() {
  try {
    if (!existsSync(config.dbPath)) {
      throw new Error(`Database file not found: ${config.dbPath}`);
    }

    const db = await open({
      filename: config.dbPath,
      driver: sqlite3.Database
    });

    log.info('Database connection established');
    return db;
  } catch (error) {
    log.error(`Failed to open database: ${error.message}`);
    throw error;
  }
}

/**
 * アクティブなBotアカウントを取得
 */
async function getActiveBotAccounts(db) {
  try {
    const accounts = await db.all(`
      SELECT ba.*, bc.is_enabled, bc.auto_tweet_enabled
      FROM bot_accounts ba
      LEFT JOIN bot_configs bc ON ba.id = bc.account_id
      WHERE ba.status = 'active' 
        AND bc.is_enabled = 1 
        AND bc.auto_tweet_enabled = 1
    `);

    log.info(`Found ${accounts.length} active bot accounts`);
    return accounts;
  } catch (error) {
    log.error(`Failed to get bot accounts: ${error.message}`);
    throw error;
  }
}

/**
 * 投稿予定のツイートを取得
 */
async function getScheduledTweets(db) {
  try {
    const now = new Date().toISOString();
    
    const tweets = await db.all(`
      SELECT st.*, ba.twitter_username, ba.consumer_key, ba.consumer_secret,
             ba.access_token, ba.access_token_secret, ba.daily_tweet_count,
             ba.max_daily_tweets
      FROM scheduled_tweets st
      JOIN bot_accounts ba ON st.account_id = ba.id
      JOIN bot_configs bc ON ba.id = bc.account_id
      WHERE st.status = 'pending'
        AND st.scheduled_time <= ?
        AND ba.status = 'active'
        AND bc.is_enabled = 1
        AND bc.auto_tweet_enabled = 1
        AND ba.daily_tweet_count < ba.max_daily_tweets
      ORDER BY st.scheduled_time ASC
      LIMIT 50
    `, [now]);

    log.info(`Found ${tweets.length} tweets scheduled for posting`);
    return tweets;
  } catch (error) {
    log.error(`Failed to get scheduled tweets: ${error.message}`);
    throw error;
  }
}

/**
 * Twitter クライアントを作成
 */
function createTwitterClient(account) {
  try {
    return new TwitterApi({
      appKey: account.consumer_key,
      appSecret: account.consumer_secret,
      accessToken: account.access_token,
      accessSecret: account.access_token_secret,
    });
  } catch (error) {
    log.error(`Failed to create Twitter client for @${account.twitter_username}: ${error.message}`);
    throw error;
  }
}

/**
 * ツイートを投稿
 */
async function postTweet(client, content, accountName) {
  try {
    if (config.dryRun) {
      log.info(`[DRY RUN] Would post tweet for @${accountName}: "${content}"`);
      return {
        data: { id: 'dry_run_' + Date.now(), text: content },
        success: true
      };
    }

    const response = await client.v2.tweet(content);
    
    if (response.data) {
      log.info(`Successfully posted tweet for @${accountName}: ${response.data.id}`);
      return { ...response, success: true };
    } else {
      throw new Error('No data in response');
    }
  } catch (error) {
    log.error(`Failed to post tweet for @${accountName}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * ツイート状態を更新
 */
async function updateTweetStatus(db, tweetId, status, twitterTweetId = null, errorMessage = null) {
  try {
    await db.run(`
      UPDATE scheduled_tweets 
      SET status = ?, updated_at = ?
      WHERE id = ?
    `, [status, new Date().toISOString(), tweetId]);

    log.debug(`Updated tweet ${tweetId} status to ${status}`);
  } catch (error) {
    log.error(`Failed to update tweet status: ${error.message}`);
  }
}

/**
 * 実行ログを追加
 */
async function addExecutionLog(db, accountId, logType, message, tweetId = null, tweetContent = null, status = 'success') {
  try {
    await db.run(`
      INSERT INTO execution_logs (account_id, log_type, message, tweet_id, tweet_content, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [accountId, logType, message, tweetId, tweetContent, status, new Date().toISOString()]);

    log.debug(`Added execution log for account ${accountId}`);
  } catch (error) {
    log.error(`Failed to add execution log: ${error.message}`);
  }
}

/**
 * 日次投稿カウントを更新
 */
async function updateDailyTweetCount(db, accountId) {
  try {
    await db.run(`
      UPDATE bot_accounts 
      SET daily_tweet_count = daily_tweet_count + 1,
          updated_at = ?
      WHERE id = ?
    `, [new Date().toISOString(), accountId]);

    log.debug(`Updated daily tweet count for account ${accountId}`);
  } catch (error) {
    log.error(`Failed to update daily tweet count: ${error.message}`);
  }
}

/**
 * 日次カウントをリセット（午前0時に実行）
 */
async function resetDailyCountsIfNeeded(db) {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // 最後のリセットから24時間経過している場合のみリセット
    const lastReset = await db.get(`
      SELECT value FROM app_settings 
      WHERE key = 'last_daily_reset'
    `);

    if (!lastReset || new Date(lastReset.value) < todayStart) {
      await db.run(`UPDATE bot_accounts SET daily_tweet_count = 0`);
      
      await db.run(`
        INSERT OR REPLACE INTO app_settings (key, value, updated_at)
        VALUES ('last_daily_reset', ?, ?)
      `, [todayStart.toISOString(), new Date().toISOString()]);

      log.info('Daily tweet counts reset');
    }
  } catch (error) {
    log.error(`Failed to reset daily counts: ${error.message}`);
  }
}

/**
 * メイン処理
 */
async function main() {
  let db = null;
  
  try {
            log.info('Starting Twitter Auto Manager posting process...');
    
    // データベース接続
    db = await openDatabase();
    
    // 日次カウントリセット確認
    await resetDailyCountsIfNeeded(db);
    
    // 投稿予定のツイートを取得
    const scheduledTweets = await getScheduledTweets(db);
    
    if (scheduledTweets.length === 0) {
      log.info('No tweets scheduled for posting at this time');
      return;
    }

    // 各ツイートを処理
    let successCount = 0;
    let errorCount = 0;

    for (const tweet of scheduledTweets) {
      try {
        log.info(`Processing tweet ${tweet.id} for @${tweet.twitter_username}`);
        
        // Twitter クライアント作成
        const client = createTwitterClient(tweet);
        
        // ツイート投稿
        const result = await postTweet(client, tweet.content, tweet.twitter_username);
        
        if (result.success) {
          // 成功時の処理
          await updateTweetStatus(db, tweet.id, 'posted', result.data?.id);
          await updateDailyTweetCount(db, tweet.account_id);
          await addExecutionLog(
            db,
            tweet.account_id,
            'tweet',
            `自動ツイートを投稿しました`,
            result.data?.id,
            tweet.content,
            'success'
          );
          successCount++;
          
          // 投稿間隔を考慮した待機（レート制限対策）
          if (scheduledTweets.length > 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } else {
          // エラー時の処理
          await updateTweetStatus(db, tweet.id, 'failed');
          await addExecutionLog(
            db,
            tweet.account_id,
            'error',
            `ツイート投稿に失敗: ${result.error}`,
            null,
            tweet.content,
            'error'
          );
          errorCount++;
        }
      } catch (error) {
        log.error(`Error processing tweet ${tweet.id}: ${error.message}`);
        await updateTweetStatus(db, tweet.id, 'failed');
        await addExecutionLog(
          db,
          tweet.account_id,
          'error',
          `ツイート処理中にエラーが発生: ${error.message}`,
          null,
          tweet.content,
          'error'
        );
        errorCount++;
      }
    }

    log.info(`Posting process completed. Success: ${successCount}, Errors: ${errorCount}`);
    
  } catch (error) {
    log.error(`Main process error: ${error.message}`);
    process.exit(1);
  } finally {
    if (db) {
      await db.close();
      log.info('Database connection closed');
    }
  }
}

/**
 * エラーハンドリング
 */
process.on('uncaughtException', (error) => {
  log.error(`Uncaught exception: ${error.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log.error(`Unhandled rejection at: ${promise}, reason: ${reason}`);
  process.exit(1);
});

// スクリプト実行
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    log.error(`Script execution failed: ${error.message}`);
    process.exit(1);
  });
}

export { main };