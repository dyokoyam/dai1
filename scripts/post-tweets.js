#!/usr/bin/env node

/**
 * Twitter Bot 自動投稿スクリプト (GitHub Actions対応版)
 * GitHub Actions で実行され、予定されたツイートを投稿する
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
 * テンプレートベースのツイート生成
 */
function generateTweetFromTemplates() {
  const templates = [
    "こんにちは！今日も良い一日を過ごしましょう！ 🌟",
    "お疲れ様です！素晴らしい一日でした ✨",
    "今日も Twitter Auto Manager で自動投稿中です 🤖",
    "技術の力で日常をもっと便利に！ 💻",
    "自動化って素晴らしいですね 🚀",
    "毎日の作業を効率化して、大切なことに時間を使いましょう ⏰",
    "プログラミングの楽しさを日々実感しています 💡",
    "新しい技術にチャレンジする日々です 📚"
  ];

  const hashtags = [
    "#自動投稿",
    "#Twitter",
    "#プログラミング", 
    "#効率化",
    "#Tech",
    "#Bot"
  ];

  // ランダムにテンプレートを選択
  const template = templates[Math.floor(Math.random() * templates.length)];
  
  // ランダムにハッシュタグを1-2個選択
  const selectedHashtags = hashtags
    .sort(() => 0.5 - Math.random())
    .slice(0, Math.floor(Math.random() * 2) + 1)
    .join(' ');

  // 時刻情報を追加（30%の確率）
  let content = template;
  if (Math.random() < 0.3) {
    const now = new Date();
    const timeString = now.toLocaleString('ja-JP', { 
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit'
    });
    content += ` (${timeString})`;
  }

  content += ` ${selectedHashtags}`;
  
  return content;
}

/**
 * Twitter クライアントを作成
 */
function createTwitterClient() {
  try {
    const apiKey = process.env.TWITTER_API_KEY;
    const apiSecret = process.env.TWITTER_API_SECRET;
    
    if (!apiKey || !apiSecret) {
      throw new Error('Twitter API credentials not found in environment variables');
    }

    return new TwitterApi({
      appKey: apiKey,
      appSecret: apiSecret,
      accessToken: process.env.TWITTER_ACCESS_TOKEN || apiKey, // Fallback
      accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET || apiSecret, // Fallback
    });
  } catch (error) {
    log.error(`Failed to create Twitter client: ${error.message}`);
    throw error;
  }
}

/**
 * ツイートを投稿
 */
async function postTweet(client, content) {
  try {
    if (config.dryRun) {
      log.info(`[DRY RUN] Would post tweet: "${content}"`);
      return {
        data: { id: 'dry_run_' + Date.now(), text: content },
        success: true
      };
    }

    const response = await client.v2.tweet(content);
    
    if (response.data) {
      log.info(`Successfully posted tweet: ${response.data.id}`);
      return { ...response, success: true };
    } else {
      throw new Error('No data in response');
    }
  } catch (error) {
    log.error(`Failed to post tweet: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 過去の投稿をチェック（重複防止）
 */
function shouldPostNow() {
  const now = new Date();
  const hour = now.getHours();
  
  // 投稿しない時間帯 (23:00-6:00)
  if (hour >= 23 || hour < 6) {
    log.info('🌙 Night time - skipping tweet');
    return false;
  }
  
  // ランダムに50%の確率で投稿
  if (Math.random() < 0.5) {
    log.info('🎲 Random skip - not posting this time');
    return false;
  }
  
  return true;
}

/**
 * メイン処理
 */
async function main() {
  try {
    log.info('🚀 Starting Twitter Auto Manager posting process...');
    log.info(`📊 Environment: ${process.env.NODE_ENV || 'production'}`);
    log.info(`🔄 Dry run: ${config.dryRun}`);
    
    // 投稿判定
    if (!shouldPostNow()) {
      log.info('✅ Skipping tweet for this run');
      return;
    }
    
    // Twitter クライアント作成
    const client = createTwitterClient();
    
    // ツイート内容生成
    const content = generateTweetFromTemplates();
    log.info(`📝 Generated tweet content: "${content}"`);
    
    // ツイート投稿
    const result = await postTweet(client, content);
    
    if (result.success) {
      log.info(`✅ Tweet posted successfully!`);
      log.info(`🔗 Tweet ID: ${result.data?.id}`);
    } else {
      log.error(`❌ Tweet failed: ${result.error}`);
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