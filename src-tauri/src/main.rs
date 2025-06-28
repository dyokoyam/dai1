#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use rusqlite::{Connection, params, Result as SqliteResult};
use std::sync::Mutex;
use std::fs;
use tauri::State;
use serde::{Serialize, Deserialize};
use chrono::Utc;
use anyhow::{Result, Context};
use directories::ProjectDirs;
use reqwest;
use serde_json::json;
use base64;

// アプリケーション状態
struct AppState {
    db: Mutex<Connection>,
}

// Bot アカウント情報（簡素化版）
#[derive(Debug, Serialize, Deserialize)]
struct BotAccount {
    id: Option<i64>,
    account_name: String,
    api_type: String, // "Free", "Basic", "Pro"
    api_key: String,
    api_key_secret: String,
    access_token: String,
    access_token_secret: String,
    status: String, // "active", "inactive", "error"
    #[serde(skip_serializing_if = "Option::is_none")]
    created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    updated_at: Option<String>,
}

// Bot 設定
#[derive(Debug, Serialize, Deserialize)]
struct BotConfig {
    id: Option<i64>,
    account_id: i64,
    is_enabled: bool,
    auto_tweet_enabled: bool,
    tweet_interval_minutes: i32,
    tweet_templates: Option<String>, // JSON配列
    hashtags: Option<String>,
    created_at: String,
    updated_at: String,
}

// 返信設定（新仕様）
#[derive(Debug, Serialize, Deserialize)]
struct ReplySettings {
    id: Option<i64>,
    target_bot_ids: String,        // 監視対象のBotアカウントIDの配列（JSON）
    reply_bot_id: i64,             // 返信するBotアカウントID（単一）
    reply_content: String,         // 返信内容
    is_active: bool,               // 有効/無効
    last_checked_tweet_ids: Option<String>, // 最後にチェックしたツイートIDのJSON配列
    created_at: String,
    updated_at: String,
}

// 実行ログ
#[derive(Debug, Serialize, Deserialize)]
struct ExecutionLog {
    id: Option<i64>,
    account_id: i64,
    log_type: String, // "tweet", "error", "info", "reply"
    message: String,
    tweet_id: Option<String>,
    tweet_content: Option<String>,
    status: String, // "success", "error", "warning"
    created_at: String,
}

// ユーザー設定
#[derive(Debug, Serialize, Deserialize)]
struct UserSettings {
    id: Option<i64>,
    user_id: String,
    plan_type: String, // "starter", "basic", "pro"
    max_accounts: i32,
    created_at: String,
    updated_at: String,
}

// スケジュール投稿（投稿内容リスト対応版）
#[derive(Debug, Serialize, Deserialize)]
struct ScheduledTweet {
    id: Option<i64>,
    account_id: i64,
    content: String, // 後方互換のため残す
    content_list: Option<String>, // JSON配列 ["投稿1", "投稿2", "投稿3"]
    current_index: Option<i32>, // 現在の投稿インデックス
    scheduled_times: String, // カンマ区切りの時間リスト "09:00,12:00,18:00"
    is_active: bool,
    created_at: String,
    updated_at: String,
}

// 統計情報
#[derive(Debug, Serialize, Deserialize)]
struct DashboardStats {
    total_accounts: i32,
    active_accounts: i32,
    today_tweets: i32,
    total_tweets: i32,
    error_count: i32,
}

// テスト投稿リクエスト
#[derive(Debug, Serialize, Deserialize)]
struct TestTweetRequest {
    account_id: i64,
    content: String,
}

// Twitter API レスポンス
#[derive(Debug, Serialize, Deserialize)]
struct TwitterApiResponse {
    success: bool,
    tweet_id: Option<String>,
    message: String,
}

// データベース初期化
fn init_database() -> Result<Connection> {
    let proj_dirs = ProjectDirs::from("com", "twilia", "bot-manager")
        .context("Failed to determine project directories")?;
    
    let data_dir = proj_dirs.data_dir();
    fs::create_dir_all(data_dir).context("Failed to create data directory")?;
    
    let db_path = data_dir.join("twilia.sqlite");
    
    // データベース接続
    let conn = Connection::open(&db_path)?;
    
    // データベースが新規作成かどうかを確認
    let table_exists: i32 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='bot_accounts'",
        [],
        |row| row.get(0)
    ).unwrap_or(0);
    
    // テーブルが存在しない場合のみ作成
    if table_exists == 0 {
        // Bot アカウントテーブル（簡素化版）
        conn.execute(
            "CREATE TABLE IF NOT EXISTS bot_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_name TEXT NOT NULL UNIQUE,
                api_key TEXT NOT NULL,
                api_key_secret TEXT NOT NULL,
                access_token TEXT NOT NULL,
                access_token_secret TEXT NOT NULL,
                api_type TEXT NOT NULL DEFAULT 'Free',
                status TEXT DEFAULT 'inactive',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;
        
        // Bot 設定テーブル
        conn.execute(
            "CREATE TABLE IF NOT EXISTS bot_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                is_enabled BOOLEAN DEFAULT 0,
                auto_tweet_enabled BOOLEAN DEFAULT 0,
                tweet_interval_minutes INTEGER DEFAULT 60,
                tweet_templates TEXT,
                hashtags TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (account_id) REFERENCES bot_accounts(id) ON DELETE CASCADE
            )",
            [],
        )?;
        
        // 返信設定テーブル（新仕様）
        conn.execute(
            "CREATE TABLE IF NOT EXISTS reply_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                target_bot_ids TEXT NOT NULL,
                reply_bot_id INTEGER NOT NULL,
                reply_content TEXT NOT NULL,
                is_active BOOLEAN DEFAULT 1,
                last_checked_tweet_ids TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (reply_bot_id) REFERENCES bot_accounts(id) ON DELETE CASCADE
            )",
            [],
        )?;
        
        // 実行ログテーブル
        conn.execute(
            "CREATE TABLE IF NOT EXISTS execution_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                log_type TEXT NOT NULL,
                message TEXT NOT NULL,
                tweet_id TEXT,
                tweet_content TEXT,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (account_id) REFERENCES bot_accounts(id) ON DELETE CASCADE
            )",
            [],
        )?;
        
        // スケジュール投稿テーブル（投稿リスト対応版）
        conn.execute(
            "CREATE TABLE IF NOT EXISTS scheduled_tweets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                content_list TEXT,
                current_index INTEGER DEFAULT 0,
                scheduled_times TEXT NOT NULL,
                is_active BOOLEAN DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (account_id) REFERENCES bot_accounts(id) ON DELETE CASCADE
            )",
            [],
        )?;
        
        // ユーザー設定テーブル
        conn.execute(
            "CREATE TABLE IF NOT EXISTS user_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL UNIQUE DEFAULT 'default',
                plan_type TEXT DEFAULT 'starter',
                max_accounts INTEGER DEFAULT 999,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;
        
        // アプリ設定テーブル（日次リセット追跡用）
        conn.execute(
            "CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;
        
        // デフォルトユーザー設定を挿入
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR IGNORE INTO user_settings (user_id, created_at, updated_at) 
             VALUES ('default', ?, ?)",
            params![now, now],
        )?;
    } else {
        // 既存のデータベースに対してマイグレーションを実行
        run_database_migrations(&conn)?;
    }
    
    Ok(conn)
}

// データベースマイグレーション
fn run_database_migrations(conn: &Connection) -> Result<()> {
    // 返信設定テーブルの存在チェック
    let reply_table_exists: i32 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='reply_settings'",
        [],
        |row| row.get(0)
    ).unwrap_or(0);
    
    if reply_table_exists == 0 {
        // 返信設定テーブルを新規作成（新仕様）
        conn.execute(
            "CREATE TABLE reply_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                target_bot_ids TEXT NOT NULL,
                reply_bot_id INTEGER NOT NULL,
                reply_content TEXT NOT NULL,
                is_active BOOLEAN DEFAULT 1,
                last_checked_tweet_ids TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (reply_bot_id) REFERENCES bot_accounts(id) ON DELETE CASCADE
            )",
            [],
        )?;
        println!("Created reply_settings table with new schema (multiple targets, single replier)");
    } else {
        // 既存テーブルを新仕様にマイグレーション
        migrate_reply_settings_table(conn)?;
    }
    
    // scheduled_tweets テーブルが存在するかチェック
    let table_exists: i32 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='scheduled_tweets'",
        [],
        |row| row.get(0)
    ).unwrap_or(0);
    
    if table_exists == 0 {
        // テーブルが存在しない場合は新規作成
        conn.execute(
            "CREATE TABLE scheduled_tweets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                content_list TEXT,
                current_index INTEGER DEFAULT 0,
                scheduled_times TEXT NOT NULL,
                is_active BOOLEAN DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (account_id) REFERENCES bot_accounts(id) ON DELETE CASCADE
            )",
            [],
        )?;
        println!("Created scheduled_tweets table with content_list support");
    } else {
        // 投稿リスト対応のカラムを追加
        let content_list_exists: i32 = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('scheduled_tweets') WHERE name='content_list'",
            [],
            |row| row.get(0)
        ).unwrap_or(0);
        
        if content_list_exists == 0 {
            conn.execute(
                "ALTER TABLE scheduled_tweets ADD COLUMN content_list TEXT",
                [],
            )?;
            println!("Added content_list column to scheduled_tweets table");
        }
        
        let current_index_exists: i32 = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('scheduled_tweets') WHERE name='current_index'",
            [],
            |row| row.get(0)
        ).unwrap_or(0);
        
        if current_index_exists == 0 {
            conn.execute(
                "ALTER TABLE scheduled_tweets ADD COLUMN current_index INTEGER DEFAULT 0",
                [],
            )?;
            println!("Added current_index column to scheduled_tweets table");
        }
        
        // 他のマイグレーション処理
        let scheduled_times_exists: i32 = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('scheduled_tweets') WHERE name='scheduled_times'",
            [],
            |row| row.get(0)
        ).unwrap_or(0);
        
        if scheduled_times_exists == 0 {
            conn.execute(
                "ALTER TABLE scheduled_tweets ADD COLUMN scheduled_times TEXT DEFAULT ''",
                [],
            )?;
            println!("Added scheduled_times column to scheduled_tweets table");
        }
        
        let is_active_exists: i32 = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('scheduled_tweets') WHERE name='is_active'",
            [],
            |row| row.get(0)
        ).unwrap_or(0);
        
        if is_active_exists == 0 {
            conn.execute(
                "ALTER TABLE scheduled_tweets ADD COLUMN is_active BOOLEAN DEFAULT 1",
                [],
            )?;
            println!("Added is_active column to scheduled_tweets table");
        }
    }
    
    Ok(())
}

// 返信設定テーブルマイグレーション
fn migrate_reply_settings_table(conn: &Connection) -> Result<()> {
    // 既存の構造を確認
    let target_bot_ids_exists: i32 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('reply_settings') WHERE name='target_bot_ids'",
        [],
        |row| row.get(0)
    ).unwrap_or(0);
    
    if target_bot_ids_exists == 0 {
        // 旧構造から新構造へマイグレーション
        println!("Migrating reply_settings table to new schema...");
        
        // 既存データをバックアップ
        let mut existing_settings = Vec::new();
        {
            let mut stmt = conn.prepare("SELECT * FROM reply_settings WHERE is_active = 1")?;
            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, i64>(1)?,      // target_bot_id
                    row.get::<_, String>(2)?,   // reply_bot_ids
                    row.get::<_, String>(3)?,   // reply_content
                    row.get::<_, String>(6)?,   // created_at
                    row.get::<_, Option<String>>(5)?, // last_checked_tweet_id
                ))
            })?;
            
            for row in rows {
                if let Ok(data) = row {
                    existing_settings.push(data);
                }
            }
        }
        
        // テーブルを削除して再作成
        conn.execute("DROP TABLE reply_settings", [])?;
        
        conn.execute(
            "CREATE TABLE reply_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                target_bot_ids TEXT NOT NULL,
                reply_bot_id INTEGER NOT NULL,
                reply_content TEXT NOT NULL,
                is_active BOOLEAN DEFAULT 1,
                last_checked_tweet_ids TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (reply_bot_id) REFERENCES bot_accounts(id) ON DELETE CASCADE
            )",
            [],
        )?;
        
        // データを新構造で移行
        let now = Utc::now().to_rfc3339();
        for (target_bot_id, reply_bot_ids, reply_content, created_at, last_checked_tweet_id) in existing_settings {
            // 旧構造: 1つの監視対象、複数の返信者
            // 新構造: 複数の監視対象、1つの返信者
            
            // reply_bot_ids をパースして、各返信者に対して個別の設定を作成
            if let Ok(reply_bot_id_list) = serde_json::from_str::<Vec<i64>>(&reply_bot_ids) {
                for reply_bot_id in reply_bot_id_list {
                    // last_checked_tweet_id を配列形式に変換
                    let last_checked_tweet_ids = if let Some(tweet_id) = &last_checked_tweet_id {
                        serde_json::to_string(&vec![format!("{}:{}", target_bot_id, tweet_id)])
                            .unwrap_or_else(|_| "[]".to_string())
                    } else {
                        "[]".to_string()
                    };
                    
                    conn.execute(
                        "INSERT INTO reply_settings (target_bot_ids, reply_bot_id, reply_content, is_active, last_checked_tweet_ids, created_at, updated_at)
                         VALUES (?, ?, ?, 1, ?, ?, ?)",
                        params![
                            serde_json::to_string(&vec![target_bot_id]).unwrap(),
                            reply_bot_id,
                            reply_content,
                            last_checked_tweet_ids,
                            created_at,
                            now
                        ],
                    )?;
                }
            }
        }
        
        println!("Successfully migrated reply_settings table to new schema");
    }
    
    Ok(())
}

// 返信設定管理（新仕様）
#[tauri::command]
fn save_reply_settings(
    reply_bot_id: i64,
    target_bot_ids: Vec<i64>, 
    reply_content: String, 
    state: State<AppState>
) -> Result<i64, String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
    let now = Utc::now().to_rfc3339();
    
    // バリデーション
    if reply_content.trim().is_empty() {
        return Err("返信内容が空です".to_string());
    }
    if target_bot_ids.is_empty() {
        return Err("監視対象Botが選択されていません".to_string());
    }
    
    // 既存の設定を無効化
    conn.execute(
        "UPDATE reply_settings SET is_active = 0, updated_at = ? WHERE reply_bot_id = ?",
        params![now, reply_bot_id],
    ).map_err(|e| e.to_string())?;
    
    // 新しい設定を保存
    let target_bot_ids_json = serde_json::to_string(&target_bot_ids)
        .map_err(|e| format!("JSON変換エラー: {}", e))?;
    
    conn.execute(
        "INSERT INTO reply_settings (target_bot_ids, reply_bot_id, reply_content, is_active, last_checked_tweet_ids, created_at, updated_at)
         VALUES (?, ?, ?, 1, '[]', ?, ?)",
        params![target_bot_ids_json, reply_bot_id, reply_content, now, now],
    ).map_err(|e| e.to_string())?;
    
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
fn get_reply_settings(state: State<AppState>) -> Result<Vec<ReplySettings>, String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
    let mut stmt = conn.prepare(
        "SELECT * FROM reply_settings WHERE is_active = 1 ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;
    
    let settings = stmt.query_map([], |row| {
        Ok(ReplySettings {
            id: row.get(0)?,
            target_bot_ids: row.get(1)?,
            reply_bot_id: row.get(2)?,
            reply_content: row.get(3)?,
            is_active: row.get(4)?,
            last_checked_tweet_ids: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<SqliteResult<Vec<_>>>()
    .map_err(|e| e.to_string())?;
    
    Ok(settings)
}

#[tauri::command]
fn delete_reply_settings(id: i64, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
    
    conn.execute("DELETE FROM reply_settings WHERE id = ?", params![id])
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
fn update_last_checked_tweet(
    target_bot_id: i64, 
    tweet_id: String, 
    reply_bot_id: i64,
    state: State<AppState>
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
    let now = Utc::now().to_rfc3339();
    
    // 現在の last_checked_tweet_ids を取得
    let current_ids: String = conn.query_row(
        "SELECT last_checked_tweet_ids FROM reply_settings WHERE reply_bot_id = ? AND is_active = 1",
        params![reply_bot_id],
        |row| row.get(0)
    ).unwrap_or_else(|_| "[]".to_string());
    
    // JSON を解析して更新
    let mut tweet_id_map: std::collections::HashMap<String, String> = if let Ok(ids) = serde_json::from_str::<Vec<String>>(&current_ids) {
        ids.into_iter()
            .filter_map(|entry| {
                let parts: Vec<&str> = entry.split(':').collect();
                if parts.len() == 2 {
                    Some((parts[0].to_string(), parts[1].to_string()))
                } else {
                    None
                }
            })
            .collect()
    } else {
        std::collections::HashMap::new()
    };
    
    // 該当するtarget_bot_idのツイートIDを更新
    tweet_id_map.insert(target_bot_id.to_string(), tweet_id);
    
    // JSON 配列形式に戻す
    let updated_ids: Vec<String> = tweet_id_map.into_iter()
        .map(|(bot_id, tweet_id)| format!("{}:{}", bot_id, tweet_id))
        .collect();
    
    let updated_ids_json = serde_json::to_string(&updated_ids)
        .map_err(|e| format!("JSON変換エラー: {}", e))?;
    
    conn.execute(
        "UPDATE reply_settings SET last_checked_tweet_ids = ?, updated_at = ? 
         WHERE reply_bot_id = ? AND is_active = 1",
        params![updated_ids_json, now, reply_bot_id],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

// 以下、既存の関数群...
// ダッシュボード統計取得
#[tauri::command]
fn get_dashboard_stats(state: State<AppState>) -> Result<DashboardStats, String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
    
    let total_accounts: i32 = conn.query_row(
        "SELECT COUNT(*) FROM bot_accounts",
        [],
        |row| row.get(0)
    ).map_err(|e| e.to_string())?;
    
    let active_accounts: i32 = conn.query_row(
        "SELECT COUNT(*) FROM bot_accounts WHERE status = 'active'",
        [],
        |row| row.get(0)
    ).map_err(|e| e.to_string())?;
    
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let today_tweets: i32 = conn.query_row(
        "SELECT COUNT(*) FROM execution_logs WHERE log_type = 'tweet' AND date(created_at) = ?",
        params![today],
        |row| row.get(0)
    ).map_err(|e| e.to_string())?;
    
    let total_tweets: i32 = conn.query_row(
        "SELECT COUNT(*) FROM execution_logs WHERE log_type = 'tweet'",
        [],
        |row| row.get(0)
    ).map_err(|e| e.to_string())?;
    
    let error_count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM execution_logs WHERE status = 'error' AND date(created_at) = ?",
        params![today],
        |row| row.get(0)
    ).map_err(|e| e.to_string())?;
    
    Ok(DashboardStats {
        total_accounts,
        active_accounts,
        today_tweets,
        total_tweets,
        error_count,
    })
}

// Bot アカウント管理
#[tauri::command]
fn get_bot_accounts(state: State<AppState>) -> Result<Vec<BotAccount>, String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
    let mut stmt = conn.prepare("SELECT * FROM bot_accounts ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    
    let accounts = stmt.query_map([], |row| {
        Ok(BotAccount {
            id: row.get(0)?,
            account_name: row.get(1)?,
            api_key: row.get(2)?,
            api_key_secret: row.get(3)?,
            access_token: row.get(4)?,
            access_token_secret: row.get(5)?,
            api_type: row.get(6)?,
            status: row.get(7)?,
            created_at: Some(row.get(8)?),
            updated_at: Some(row.get(9)?),
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<SqliteResult<Vec<_>>>()
    .map_err(|e| e.to_string())?;
    
    Ok(accounts)
}

#[tauri::command]
fn add_bot_account(account: BotAccount, state: State<AppState>) -> Result<i64, String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
    let now = Utc::now().to_rfc3339();
    
    // バリデーション
    if account.account_name.trim().is_empty() {
        return Err("アカウント名が空です".to_string());
    }
    if account.api_key.trim().is_empty() {
        return Err("API Keyが空です".to_string());
    }
    if account.api_key_secret.trim().is_empty() {
        return Err("API Key Secretが空です".to_string());
    }
    if account.access_token.trim().is_empty() {
        return Err("Access Tokenが空です".to_string());
    }
    if account.access_token_secret.trim().is_empty() {
        return Err("Access Token Secretが空です".to_string());
    }
    
    let result = conn.execute(
        "INSERT INTO bot_accounts (account_name, api_key, api_key_secret, 
         access_token, access_token_secret, api_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            account.account_name,
            account.api_key,
            account.api_key_secret,
            account.access_token,
            account.access_token_secret,
            account.api_type,
            now,
            now
        ],
    );
    
    result.map_err(|e| format!("データベースエラー: {}", e))?;
    
    let account_id = conn.last_insert_rowid();
    
    // デフォルトの Bot 設定を作成
    let config_result = conn.execute(
        "INSERT INTO bot_configs (account_id, created_at, updated_at)
         VALUES (?, ?, ?)",
        params![account_id, now, now],
    );
    
    config_result.map_err(|e| format!("設定作成エラー: {}", e))?;
    
    Ok(account_id)
}

#[tauri::command]
fn update_bot_account(account: BotAccount, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
    let now = Utc::now().to_rfc3339();
    
    conn.execute(
        "UPDATE bot_accounts 
         SET account_name = ?, api_key = ?, api_key_secret = ?,
             access_token = ?, access_token_secret = ?, api_type = ?, 
             status = ?, updated_at = ?
         WHERE id = ?",
        params![
            account.account_name,
            account.api_key,
            account.api_key_secret,
            account.access_token,
            account.access_token_secret,
            account.api_type,
            account.status,
            now,
            account.id
        ],
    )
    .map_err(|e| format!("データベース更新エラー: {}", e))?;
    
    Ok(())
}

#[tauri::command]
fn delete_bot_account(id: i64, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
    
    conn.execute("DELETE FROM bot_accounts WHERE id = ?", params![id])
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

// Bot 設定管理
#[tauri::command]
fn get_bot_config(account_id: i64, state: State<AppState>) -> Result<BotConfig, String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
    
    let config = conn.query_row(
        "SELECT * FROM bot_configs WHERE account_id = ?",
        params![account_id],
        |row| {
            Ok(BotConfig {
                id: row.get(0)?,
                account_id: row.get(1)?,
                is_enabled: row.get(2)?,
                auto_tweet_enabled: row.get(3)?,
                tweet_interval_minutes: row.get(4)?,
                tweet_templates: row.get(5)?,
                hashtags: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        }
    ).map_err(|e| e.to_string())?;
    
    Ok(config)
}

#[tauri::command]
fn update_bot_config(config: BotConfig, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
    let now = Utc::now().to_rfc3339();
    
    conn.execute(
        "UPDATE bot_configs 
         SET is_enabled = ?, auto_tweet_enabled = ?, tweet_interval_minutes = ?,
             tweet_templates = ?, hashtags = ?, updated_at = ?
         WHERE account_id = ?",
        params![
            config.is_enabled,
            config.auto_tweet_enabled,
            config.tweet_interval_minutes,
            config.tweet_templates,
            config.hashtags,
            now,
            config.account_id
        ],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(())
}

// スケジュール投稿の保存（投稿リスト対応版）
#[tauri::command]
fn save_scheduled_tweet_list(account_id: i64, scheduled_times: String, content_list: Vec<String>, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
    let now = Utc::now().to_rfc3339();
    
    // 既存のスケジュール投稿を無効化
    conn.execute(
        "UPDATE scheduled_tweets SET is_active = 0, updated_at = ? WHERE account_id = ?",
        params![now, account_id],
    )
    .map_err(|e| e.to_string())?;
    
    // 新しいスケジュール投稿を作成
    if !scheduled_times.is_empty() && !content_list.is_empty() {
        let content_list_json = serde_json::to_string(&content_list)
            .map_err(|e| format!("JSON変換エラー: {}", e))?;
        
        let first_content = content_list.first().unwrap_or(&String::new()).clone();
        
        conn.execute(
            "INSERT INTO scheduled_tweets (account_id, content, content_list, current_index, scheduled_times, is_active, created_at, updated_at)
             VALUES (?, ?, ?, 0, ?, 1, ?, ?)",
            params![account_id, first_content, content_list_json, scheduled_times, now, now],
        )
        .map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

// 従来の save_scheduled_tweet も維持（後方互換）
#[tauri::command]
fn save_scheduled_tweet(account_id: i64, scheduled_times: String, content: String, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
    let now = Utc::now().to_rfc3339();
    
    // 既存のスケジュール投稿を無効化
    conn.execute(
        "UPDATE scheduled_tweets SET is_active = 0, updated_at = ? WHERE account_id = ?",
        params![now, account_id],
    )
    .map_err(|e| e.to_string())?;
    
    // 新しいスケジュール投稿を作成
    if !scheduled_times.is_empty() && !content.trim().is_empty() {
        conn.execute(
            "INSERT INTO scheduled_tweets (account_id, content, scheduled_times, is_active, created_at, updated_at)
             VALUES (?, ?, ?, 1, ?, ?)",
            params![account_id, content, scheduled_times, now, now],
        )
        .map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

// インデックス更新機能（投稿成功後に呼ばれる）
#[tauri::command]
fn update_post_index(account_id: i64, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
    let now = Utc::now().to_rfc3339();
    
    // 現在のインデックスと投稿リストを取得
    let (current_index, content_list_json): (i32, Option<String>) = conn.query_row(
        "SELECT current_index, content_list FROM scheduled_tweets WHERE account_id = ? AND is_active = 1",
        params![account_id],
        |row| Ok((row.get(0)?, row.get(1)?))
    ).map_err(|e| format!("インデックス取得エラー: {}", e))?;
    
    if let Some(content_list_str) = content_list_json {
        // JSON配列をパース
        let content_list: Vec<String> = serde_json::from_str(&content_list_str)
            .map_err(|e| format!("JSON解析エラー: {}", e))?;
        
        // 次のインデックスを計算（末尾に達したら0にリセット）
        let next_index = if current_index + 1 >= content_list.len() as i32 {
            0
        } else {
            current_index + 1
        };
        
        // インデックスを更新
        conn.execute(
            "UPDATE scheduled_tweets SET current_index = ?, updated_at = ? WHERE account_id = ? AND is_active = 1",
            params![next_index, now, account_id],
        )
        .map_err(|e| format!("インデックス更新エラー: {}", e))?;
        
        println!("Updated post index for account {}: {} -> {}", account_id, current_index, next_index);
    }
    
    Ok(())
}

// スケジュール投稿管理
#[tauri::command]
fn add_scheduled_tweet(tweet: ScheduledTweet, state: State<AppState>) -> Result<i64, String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
    let now = Utc::now().to_rfc3339();
    
    conn.execute(
        "INSERT INTO scheduled_tweets (account_id, content, content_list, current_index, scheduled_times, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            tweet.account_id,
            tweet.content,
            tweet.content_list,
            tweet.current_index.unwrap_or(0),
            tweet.scheduled_times,
            tweet.is_active,
            now,
            now
        ],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
fn get_scheduled_tweets(account_id: Option<i64>, state: State<AppState>) -> Result<Vec<ScheduledTweet>, String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
    
    let tweets = match account_id {
        Some(id) => {
            let mut stmt = conn.prepare(
                "SELECT id, account_id, content, content_list, current_index, scheduled_times, is_active, created_at, updated_at 
                 FROM scheduled_tweets WHERE account_id = ? AND is_active = 1 ORDER BY created_at DESC"
            ).map_err(|e| e.to_string())?;
            
            let rows = stmt.query_map(params![id], |row| {
                Ok(ScheduledTweet {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    content: row.get(2)?,
                    content_list: row.get(3)?,
                    current_index: row.get(4)?,
                    scheduled_times: row.get(5)?,
                    is_active: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;

            rows.collect::<SqliteResult<Vec<_>>>()
                .map_err(|e| e.to_string())?
        }
        None => {
            let mut stmt = conn.prepare(
                "SELECT id, account_id, content, content_list, current_index, scheduled_times, is_active, created_at, updated_at 
                 FROM scheduled_tweets WHERE is_active = 1 ORDER BY created_at DESC"
            ).map_err(|e| e.to_string())?;
            
            let rows = stmt.query_map([], |row| {
                Ok(ScheduledTweet {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    content: row.get(2)?,
                    content_list: row.get(3)?,
                    current_index: row.get(4)?,
                    scheduled_times: row.get(5)?,
                    is_active: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;

            rows.collect::<SqliteResult<Vec<_>>>()
                .map_err(|e| e.to_string())?
        }
    };
    
    Ok(tweets)
}

// 実行ログ管理
#[tauri::command]
fn get_execution_logs(account_id: Option<i64>, limit: Option<i32>, state: State<AppState>) -> Result<Vec<ExecutionLog>, String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
    let limit = limit.unwrap_or(100);
    
    let logs = match account_id {
        Some(id) => {
            let mut stmt = conn.prepare(
                "SELECT * FROM execution_logs WHERE account_id = ? 
                 ORDER BY created_at DESC LIMIT ?"
            ).map_err(|e| e.to_string())?;
            
            let rows = stmt.query_map(params![id, limit], |row| {
                Ok(ExecutionLog {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    log_type: row.get(2)?,
                    message: row.get(3)?,
                    tweet_id: row.get(4)?,
                    tweet_content: row.get(5)?,
                    status: row.get(6)?,
                    created_at: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;

            rows.collect::<SqliteResult<Vec<_>>>()
                .map_err(|e| e.to_string())?
        }
        None => {
            let mut stmt = conn.prepare(
                "SELECT * FROM execution_logs ORDER BY created_at DESC LIMIT ?"
            ).map_err(|e| e.to_string())?;
            
            let rows = stmt.query_map(params![limit], |row| {
                Ok(ExecutionLog {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    log_type: row.get(2)?,
                    message: row.get(3)?,
                    tweet_id: row.get(4)?,
                    tweet_content: row.get(5)?,
                    status: row.get(6)?,
                    created_at: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;

            rows.collect::<SqliteResult<Vec<_>>>()
                .map_err(|e| e.to_string())?
        }
    };
    
    Ok(logs)
}

#[tauri::command]
fn add_execution_log(log: ExecutionLog, state: State<AppState>) -> Result<i64, String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
    let now = Utc::now().to_rfc3339();
    
    conn.execute(
        "INSERT INTO execution_logs (account_id, log_type, message, tweet_id, tweet_content, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![
            log.account_id,
            log.log_type,
            log.message,
            log.tweet_id,
            log.tweet_content,
            log.status,
            now
        ],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(conn.last_insert_rowid())
}

// ユーザー設定管理
#[tauri::command]
fn get_user_settings(state: State<AppState>) -> Result<UserSettings, String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
    
    let settings = conn.query_row(
        "SELECT * FROM user_settings WHERE user_id = 'default'",
        [],
        |row| {
            Ok(UserSettings {
                id: row.get(0)?,
                user_id: row.get(1)?,
                plan_type: row.get(2)?,
                max_accounts: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        }
    ).map_err(|e| e.to_string())?;
    
    Ok(settings)
}

#[tauri::command]
fn update_user_settings(settings: UserSettings, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
    let now = Utc::now().to_rfc3339();
    
    conn.execute(
        "UPDATE user_settings SET plan_type = ?, max_accounts = ?, updated_at = ? 
         WHERE user_id = 'default'",
        params![settings.plan_type, settings.max_accounts, now],
    )
    .map_err(|e| e.to_string())?;
    
    Ok(())
}

// エクスポート/インポート機能
#[tauri::command]
fn export_data(path: String, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
    
    // プロジェクトルートのdataディレクトリに保存するようにパスを調整
    let adjusted_path = if path.starts_with("data/") {
        format!("../{}", path)
    } else {
        path
    };
    
    // パスの親ディレクトリを作成
    if let Some(parent) = std::path::Path::new(&adjusted_path).parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return Err(format!("ディレクトリ作成エラー: {}", e));
        }
    }
    
    // アカウント情報を取得
    let mut stmt = conn.prepare("SELECT * FROM bot_accounts ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    
    let accounts_rows = stmt.query_map([], |row| {
        Ok(BotAccount {
            id: row.get(0)?,
            account_name: row.get(1)?,
            api_key: row.get(2)?,
            api_key_secret: row.get(3)?,
            access_token: row.get(4)?,
            access_token_secret: row.get(5)?,
            api_type: row.get(6)?,
            status: row.get(7)?,
            created_at: Some(row.get(8)?),
            updated_at: Some(row.get(9)?),
        })
    })
    .map_err(|e| e.to_string())?;
    
    let accounts: Vec<BotAccount> = accounts_rows.collect::<SqliteResult<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    
    // スケジュール投稿を取得
    let mut scheduled_stmt = conn.prepare("SELECT id, account_id, content, content_list, current_index, scheduled_times, is_active, created_at, updated_at FROM scheduled_tweets WHERE is_active = 1 ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    
    let scheduled_rows = scheduled_stmt.query_map([], |row| {
        Ok(ScheduledTweet {
            id: row.get(0)?,
            account_id: row.get(1)?,
            content: row.get(2)?,
            content_list: row.get(3)?,
            current_index: row.get(4)?,
            scheduled_times: row.get(5)?,
            is_active: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    })
    .map_err(|e| e.to_string())?;
    
    let scheduled_tweets: Vec<ScheduledTweet> = scheduled_rows.collect::<SqliteResult<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    
    // 返信設定を取得
    let mut reply_stmt = conn.prepare("SELECT * FROM reply_settings WHERE is_active = 1 ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    
    let reply_rows = reply_stmt.query_map([], |row| {
        Ok(ReplySettings {
            id: row.get(0)?,
            target_bot_ids: row.get(1)?,
            reply_bot_id: row.get(2)?,
            reply_content: row.get(3)?,
            is_active: row.get(4)?,
            last_checked_tweet_ids: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    })
    .map_err(|e| e.to_string())?;
    
    let reply_settings: Vec<ReplySettings> = reply_rows.collect::<SqliteResult<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    
    // 実行ログを取得
    let mut logs_stmt = conn.prepare("SELECT * FROM execution_logs ORDER BY created_at DESC LIMIT 1000")
        .map_err(|e| e.to_string())?;
    
    let logs_rows = logs_stmt.query_map([], |row| {
        Ok(ExecutionLog {
            id: row.get(0)?,
            account_id: row.get(1)?,
            log_type: row.get(2)?,
            message: row.get(3)?,
            tweet_id: row.get(4)?,
            tweet_content: row.get(5)?,
            status: row.get(6)?,
            created_at: row.get(7)?,
        })
    })
    .map_err(|e| e.to_string())?;
    
    let logs: Vec<ExecutionLog> = logs_rows.collect::<SqliteResult<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    
    // ユーザー設定を取得
    let settings = conn.query_row(
        "SELECT * FROM user_settings WHERE user_id = 'default'",
        [],
        |row| {
            Ok(UserSettings {
                id: row.get(0)?,
                user_id: row.get(1)?,
                plan_type: row.get(2)?,
                max_accounts: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        }
    ).map_err(|e| e.to_string())?;
    
    // エクスポートデータを構成
    let export_data = serde_json::json!({
        "bot_accounts": accounts,
        "scheduled_tweets": scheduled_tweets,
        "reply_settings": reply_settings,
        "execution_logs": logs,
        "user_settings": settings,
        "exported_at": Utc::now().to_rfc3339()
    });
    
    // ファイルに書き込み
    fs::write(&adjusted_path, serde_json::to_string_pretty(&export_data).unwrap())
        .map_err(|e| format!("ファイル書き込みエラー ({}): {}", adjusted_path, e))?;
    
    println!("データエクスポートファイルを作成しました: {}", adjusted_path);
    Ok(())
}

// GitHub Actions用の設定ファイル出力（返信機能対応版）
#[tauri::command]
fn export_github_config(path: String, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
    
    // プロジェクトルートのdataディレクトリに保存するようにパスを調整
    let adjusted_path = if path.starts_with("data/") {
        format!("../{}", path)
    } else {
        path
    };
    
    // パスの親ディレクトリを作成
    if let Some(parent) = std::path::Path::new(&adjusted_path).parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return Err(format!("ディレクトリ作成エラー: {}", e));
        }
    }
    
    // アクティブなBot一覧を取得（投稿リスト対応）
    let mut stmt = conn.prepare(
        "SELECT ba.*, st.content, st.content_list, st.current_index, st.scheduled_times 
         FROM bot_accounts ba 
         LEFT JOIN scheduled_tweets st ON ba.id = st.account_id AND st.is_active = 1
         WHERE ba.status = 'active'
         ORDER BY ba.created_at DESC"
    ).map_err(|e| e.to_string())?;
    
    let rows = stmt.query_map([], |row| {
        let account = BotAccount {
            id: row.get(0)?,
            account_name: row.get(1)?,
            api_key: row.get(2)?,
            api_key_secret: row.get(3)?,
            access_token: row.get(4)?,
            access_token_secret: row.get(5)?,
            api_type: row.get(6)?,
            status: row.get(7)?,
            created_at: Some(row.get(8)?),
            updated_at: Some(row.get(9)?),
        };
        
        let scheduled_content: Option<String> = row.get(10).ok();
        let content_list_json: Option<String> = row.get(11).ok();
        let current_index: Option<i32> = row.get(12).ok();
        let scheduled_times: Option<String> = row.get(13).ok();
        
        // 投稿リストがある場合は配列として出力、ない場合は従来形式
        let bot_data = if let Some(content_list_str) = content_list_json {
            // 投稿リスト形式
            serde_json::json!({
                "account": account,
                "scheduled_content_list": content_list_str,
                "current_index": current_index.unwrap_or(0),
                "scheduled_times": scheduled_times
            })
        } else {
            // 従来形式（後方互換）
            serde_json::json!({
                "account": account,
                "scheduled_content": scheduled_content,
                "scheduled_times": scheduled_times
            })
        };
        
        Ok(bot_data)
    })
    .map_err(|e| e.to_string())?;
    
    let bot_configs: Vec<_> = rows.collect::<SqliteResult<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    
    // 返信設定を取得（新仕様）
    let mut reply_stmt = conn.prepare("SELECT * FROM reply_settings WHERE is_active = 1")
        .map_err(|e| e.to_string())?;
    
    let reply_rows = reply_stmt.query_map([], |row| {
        Ok(ReplySettings {
            id: row.get(0)?,
            target_bot_ids: row.get(1)?,
            reply_bot_id: row.get(2)?,
            reply_content: row.get(3)?,
            is_active: row.get(4)?,
            last_checked_tweet_ids: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    })
    .map_err(|e| e.to_string())?;
    
    let reply_settings: Vec<ReplySettings> = reply_rows.collect::<SqliteResult<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    
    // GitHub Actions用設定
    let github_config = serde_json::json!({
        "version": "1.0",
        "bots": bot_configs,
        "reply_settings": reply_settings,
        "updated_at": Utc::now().to_rfc3339()
    });
    
    // GitHub Actions用設定ファイルを書き込み
    fs::write(&adjusted_path, serde_json::to_string_pretty(&github_config).unwrap())
        .map_err(|e| format!("ファイル書き込みエラー ({}): {}", adjusted_path, e))?;
    
    println!("GitHub Actions用設定ファイルを作成しました（新仕様返信機能対応）: {}", adjusted_path);
    Ok(())
}

// テスト投稿機能
#[tauri::command]
async fn test_tweet(request: TestTweetRequest, state: State<'_, AppState>) -> Result<TwitterApiResponse, String> {
    // アカウント情報を取得
    let account = {
        let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
        conn.query_row(
            "SELECT * FROM bot_accounts WHERE id = ?",
            params![request.account_id],
            |row| {
                Ok(BotAccount {
                    id: Some(row.get(0)?),
                    account_name: row.get(1)?,
                    api_key: row.get(2)?,
                    api_key_secret: row.get(3)?,
                    access_token: row.get(4)?,
                    access_token_secret: row.get(5)?,
                    api_type: row.get(6)?,
                    status: row.get(7)?,
                    created_at: Some(row.get(8)?),
                    updated_at: Some(row.get(9)?),
                })
            }
        ).map_err(|e| format!("アカウント取得エラー: {}", e))?
    };
    
    // Twitter API v2 へ投稿
    match post_to_twitter(&account, &request.content).await {
        Ok(tweet_id) => {
            // 実行ログを追加
            let log = ExecutionLog {
                id: None,
                account_id: request.account_id,
                log_type: "tweet".to_string(),
                message: "テスト投稿が成功しました".to_string(),
                tweet_id: Some(tweet_id.clone()),
                tweet_content: Some(request.content),
                status: "success".to_string(),
                created_at: Utc::now().to_rfc3339(),
            };
            
            let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
            let _ = conn.execute(
                "INSERT INTO execution_logs (account_id, log_type, message, tweet_id, tweet_content, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
                params![
                    log.account_id,
                    log.log_type,
                    log.message,
                    log.tweet_id,
                    log.tweet_content,
                    log.status,
                    log.created_at
                ],
            );
            
            Ok(TwitterApiResponse {
                success: true,
                tweet_id: Some(tweet_id),
                message: "テスト投稿が成功しました！".to_string(),
            })
        }
        Err(e) => {
            // エラーログを追加
            let log = ExecutionLog {
                id: None,
                account_id: request.account_id,
                log_type: "error".to_string(),
                message: format!("テスト投稿に失敗しました: {}", e),
                tweet_id: None,
                tweet_content: Some(request.content),
                status: "error".to_string(),
                created_at: Utc::now().to_rfc3339(),
            };
            
            let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
            let _ = conn.execute(
                "INSERT INTO execution_logs (account_id, log_type, message, tweet_id, tweet_content, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
                params![
                    log.account_id,
                    log.log_type,
                    log.message,
                    log.tweet_id,
                    log.tweet_content,
                    log.status,
                    log.created_at
                ],
            );
            
            Ok(TwitterApiResponse {
                success: false,
                tweet_id: None,
                message: format!("投稿に失敗しました: {}", e),
            })
        }
    }
}

// Twitter API v2 への投稿（正しいOAuth 1.0a版）
async fn post_to_twitter(account: &BotAccount, content: &str) -> Result<String, String> {
    let url = "https://api.twitter.com/2/tweets";
    let method = "POST";
    
    let payload = json!({
        "text": content
    }).to_string();
    
    // OAuth 1.0a認証を手動実装（oauth1クレートの代わり）
    let authorization_header = create_oauth_header(
        method,
        url,
        &account.api_key,
        &account.api_key_secret,
        &account.access_token,
        &account.access_token_secret,
        Some(&payload),
    )?;
    
    let client = reqwest::Client::new();
    
    let response = client
        .post(url)
        .header("Authorization", authorization_header)
        .header("Content-Type", "application/json")
        .body(payload)
        .send()
        .await
        .map_err(|e| format!("リクエスト送信エラー: {}", e))?;
    
    let status = response.status();
    let response_text = response.text().await
        .map_err(|e| format!("レスポンス読取エラー: {}", e))?;
    
    if status.is_success() {
        // JSON パースしてツイートIDを取得
        let json: serde_json::Value = serde_json::from_str(&response_text)
            .map_err(|e| format!("JSON解析エラー: {}", e))?;
        
        if let Some(tweet_id) = json["data"]["id"].as_str() {
            Ok(tweet_id.to_string())
        } else {
            Err("ツイートIDが取得できませんでした".to_string())
        }
    } else {
        Err(format!("Twitter API エラー ({}): {}", status, response_text))
    }
}

// OAuth 1.0a認証ヘッダーを作成（簡易版だが動作する）
fn create_oauth_header(
    method: &str,
    url: &str,
    consumer_key: &str,
    consumer_secret: &str,
    access_token: &str,
    access_token_secret: &str,
    _body: Option<&str>, // _ を付けて未使用警告を回避
) -> Result<String, String> {
    use std::time::{SystemTime, UNIX_EPOCH};
    use std::collections::BTreeMap;
    
    // タイムスタンプとナンスを生成
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    
    let nonce: String = (0..32)
        .map(|_| {
            let chars = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
            chars[rand::random::<usize>() % chars.len()] as char
        })
        .collect();
    
    // OAuthパラメータ
    let mut oauth_params = BTreeMap::new();
    oauth_params.insert("oauth_consumer_key", consumer_key.to_string());
    oauth_params.insert("oauth_nonce", nonce);
    oauth_params.insert("oauth_signature_method", "HMAC-SHA1".to_string());
    oauth_params.insert("oauth_timestamp", timestamp.to_string());
    oauth_params.insert("oauth_token", access_token.to_string());
    oauth_params.insert("oauth_version", "1.0".to_string());
    
    // パラメータ文字列を作成
    let param_string = oauth_params
        .iter()
        .map(|(k, v)| format!("{}={}", url_encode(k), url_encode(v)))
        .collect::<Vec<_>>()
        .join("&");
    
    // 署名ベース文字列を作成
    let base_string = format!(
        "{}&{}&{}",
        method,
        url_encode(url),
        url_encode(&param_string)
    );
    
    // 署名キーを作成
    let signing_key = format!("{}&{}", url_encode(consumer_secret), url_encode(access_token_secret));
    
    // HMAC-SHA1署名を生成（簡易版）
    use hmac::{Hmac, Mac};
    use sha1::Sha1;
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    
    type HmacSha1 = Hmac<Sha1>;
    let mut mac = HmacSha1::new_from_slice(signing_key.as_bytes())
        .map_err(|e| format!("HMAC初期化エラー: {}", e))?;
    mac.update(base_string.as_bytes());
    let signature = STANDARD.encode(mac.finalize().into_bytes());
    
    oauth_params.insert("oauth_signature", signature);
    
    // Authorizationヘッダーを構築
    let auth_header = oauth_params
        .iter()
        .map(|(k, v)| format!("{}=\"{}\"", url_encode(k), url_encode(v)))
        .collect::<Vec<_>>()
        .join(", ");
    
    Ok(format!("OAuth {}", auth_header))
}

// URL エンコード関数
fn url_encode(input: &str) -> String {
    input
        .chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '.' | '_' | '~' => c.to_string(),
            _ => format!("%{:02X}", c as u8),
        })
        .collect()
}

fn main() {
    let db_conn = match init_database() {
        Ok(conn) => conn,
        Err(e) => {
            eprintln!("Failed to initialize database: {}", e);
            return;
        }
    };
    
    tauri::Builder::default()
        .manage(AppState {
            db: Mutex::new(db_conn),
        })
        .invoke_handler(tauri::generate_handler![
            get_dashboard_stats,
            get_bot_accounts,
            add_bot_account,
            update_bot_account,
            delete_bot_account,
            get_bot_config,
            update_bot_config,
            get_execution_logs,
            add_execution_log,
            get_user_settings,
            update_user_settings,
            export_data,
            export_github_config,
            test_tweet,
            add_scheduled_tweet,
            get_scheduled_tweets,
            save_scheduled_tweet,
            save_scheduled_tweet_list,
            update_post_index,
            save_reply_settings,
            get_reply_settings,
            delete_reply_settings,
            update_last_checked_tweet
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}