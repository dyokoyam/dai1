#!/usr/bin/env node

/**
 * Twitter Bot 自動投稿スクリプト (GitHub Actions対応版)
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

// 設定（GitHub Actions対応）
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
    log.info(`Database path: ${config.dbPath}`);
    
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
 * 投稿予定のツイートを取得（または生成）
 */
async function getScheduledTweets(db) {
  try {
    const now = new Date().toISOString();
    
    // まず既存のスケジュール済みツイートをチェック
    let tweets = await db.all(`
      SELECT st.*, ba.account_name, ba.api_key, ba.api_key_secret,
             ba.access_token, ba.access_token_secret
      FROM scheduled_tweets st
      JOIN bot_accounts ba ON st.account_id = ba.id
      JOIN bot_configs bc ON ba.id = bc.account_id
      WHERE st.status = 'pending'
        AND st.scheduled_time <= ?
        AND ba.status = 'active'
        AND bc.is_enabled = 1
        AND bc.auto_tweet_enabled = 1
      ORDER BY st.scheduled_time ASC
      LIMIT 10
    `, [now]);

    // スケジュール済みツイートがない場合、テンプレートから生成
    if (tweets.length === 0) {
      log.info('No scheduled tweets found, generating from templates...');
      tweets = await generateTweetsFromTemplates(db);
    }

    log.info(`Found ${tweets.length} tweets ready for posting`);
    return tweets;
  } catch (error) {
    log.error(`Failed to get scheduled tweets: ${error.message}`);
    throw error;
  }
}

/**
 * テンプレートからツイートを生成
 */
async function generateTweetsFromTemplates(db) {
  try {
    const activeAccounts = await getActiveBotAccounts(db);
    const generatedTweets = [];

    for (const account of activeAccounts) {
      // Bot設定を取得
      const config = await db.get(`
        SELECT * FROM bot_configs WHERE account_id = ?
      `, [account.id]);

      if (!config || !config.tweet_templates) {
        log.warn(`No tweet templates found for account: ${account.account_name}`);
        continue;
      }

      // テンプレートを解析
      const templates = config.tweet_templates.split('\n').filter(t => t.trim());
      if (templates.length === 0) {
        log.warn(`No valid templates for account: ${account.account_name}`);
        continue;
      }

      // ランダムにテンプレートを選択
      const template = templates[Math.floor(Math.random() * templates.length)];
      
      // ハッシュタグを追加
      let content = template.trim();
      if (config.hashtags) {
        const hashtags = config.hashtags.split(',').map(h => h.trim()).join(' ');
        content += ` ${hashtags}`;
      }

      // 時刻情報を追加
      const now = new Date();
      const timeString = now.toLocaleString('ja-JP', { 
        timeZone: 'Asia/Tokyo',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      // 一部のテンプレートに時刻を追加（ランダム）
      if (Math.random() < 0.3) {
        content += ` (${timeString})`;
      }

      generatedTweets.push({
        id: `temp_${account.id}_${Date.now()}`,
        account_id: account.id,
        content: content,
        status: 'pending',
        account_name: account.account_name,
        api_key: account.api_key,
        api_key_secret: account.api_key_secret,
        access_token: account.access_token,
        access_token_secret: account.access_token_secret,
        scheduled_time: now.toISOString(),
        created_at: now.toISOString()
      });

      log.info(`Generated tweet for ${account.account_name}: "${content}"`);
    }

    return generatedTweets;
  } catch (error) {
    log.error(`Failed to generate tweets from templates: ${error.message}`);
    throw error;
  }
}

/**
 * Twitter クライアントを作成
 */
function createTwitterClient(account) {
  try {
    return new TwitterApi({
      appKey: account.api_key,
      appSecret: account.api_key_secret,
      accessToken: account.access_token,
      accessSecret: account.access_token_secret,
    });
  } catch (error) {
    log.error(`Failed to create Twitter client for @${account.account_name}: ${error.message}`);
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
 * メイン処理
 */
async function main() {
  let db = null;
  
  try {
    log.info('🚀 Starting Twitter Auto Manager posting process...');
    log.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    log.info(`📁 Database path: ${config.dbPath}`);
    log.info(`🔄 Dry run: ${config.dryRun}`);
    
    // データベース接続
    db = await openDatabase();
    
    // 投稿予定のツイートを取得
    const scheduledTweets = await getScheduledTweets(db);
    
    if (scheduledTweets.length === 0) {
      log.info('✅ No tweets scheduled for posting at this time');
      return;
    }

    // 各ツイートを処理
    let successCount = 0;
    let errorCount = 0;

    for (const tweet of scheduledTweets) {
      try {
        log.info(`📝 Processing tweet for @${tweet.account_name}: "${tweet.content}"`);
        
        // Twitter クライアント作成
        const client = createTwitterClient(tweet);
        
        // ツイート投稿
        const result = await postTweet(client, tweet.content, tweet.account_name);
        
        if (result.success) {
          // 成功時の処理
          successCount++;
          
          await addExecutionLog(
            db,
            tweet.account_id,
            'tweet',
            `自動ツイートを投稿しました (GitHub Actions)`,
            result.data?.id,
            tweet.content,
            'success'
          );
          
          log.info(`✅ Tweet posted successfully for @${tweet.account_name}`);
          
          // 投稿間隔を考慮した待機（レート制限対策）
          if (scheduledTweets.length > 1) {
            log.info('⏳ Waiting 30 seconds before next tweet...');
            await new Promise(resolve => setTimeout(resolve, 30000));
          }
        } else {
          // エラー時の処理
          errorCount++;
          
          await addExecutionLog(
            db,
            tweet.account_id,
            'error',
            `ツイート投稿に失敗 (GitHub Actions): ${result.error}`,
            null,
            tweet.content,
            'error'
          );
          
          log.error(`❌ Tweet failed for @${tweet.account_name}: ${result.error}`);
        }
      } catch (error) {
        log.error(`💥 Error processing tweet for ${tweet.account_name}: ${error.message}`);
        errorCount++;
        
        await addExecutionLog(
          db,
          tweet.account_id,
          'error',
          `ツイート処理中にエラーが発生 (GitHub Actions): ${error.message}`,
          null,
          tweet.content,
          'error'
        );
      }
    }

    log.info(`🎉 Posting process completed!`);
    log.info(`📊 Results: ${successCount} successful, ${errorCount} errors`);
    
  } catch (error) {
    log.error(`💥 Main process error: ${error.message}`);
    process.exit(1);
  } finally {
    if (db) {
      await db.close();
      log.info('📁 Database connection closed');
    }
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
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    log.error(`💥 Script execution failed: ${error.message}`);
    process.exit(1);
  });
}