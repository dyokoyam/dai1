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

// 実行ログ
#[derive(Debug, Serialize, Deserialize)]
struct ExecutionLog {
    id: Option<i64>,
    account_id: i64,
    log_type: String, // "tweet", "error", "info"
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
    
    // 開発中なので既存のDBファイルを強制削除
    if db_path.exists() {
        println!("🗑️  Removing existing database for development: {:?}", db_path);
        fs::remove_file(&db_path).context("Failed to remove existing database")?;
    } else {
        println!("📁 Database path: {:?}", db_path);
    }
    
    println!("🚀 Creating new database...");
    let conn = Connection::open(&db_path)?;
    
    // Bot アカウントテーブル（簡素化版）
    println!("📋 Creating bot_accounts table...");
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
    println!("⚙️  Creating bot_configs table...");
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
    
    // 実行ログテーブル
    println!("📝 Creating execution_logs table...");
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
    
    // ユーザー設定テーブル
    println!("👤 Creating user_settings table...");
    conn.execute(
        "CREATE TABLE IF NOT EXISTS user_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL UNIQUE DEFAULT 'default',
            plan_type TEXT DEFAULT 'starter',
            max_accounts INTEGER DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )?;
    
    // アプリ設定テーブル（日次リセット追跡用）
    println!("🔧 Creating app_settings table...");
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
    println!("👤 Inserting default user settings...");
    conn.execute(
        "INSERT OR IGNORE INTO user_settings (user_id, created_at, updated_at) 
         VALUES ('default', ?, ?)",
        params![now, now],
    )?;
    
    println!("✅ Database initialized successfully");
    Ok(conn)
}

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
    println!("=== ADD BOT ACCOUNT DEBUG ===");
    println!("Received account: {:?}", account);
    
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
    
    println!("Starting database insert...");
    
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
    
    match result {
        Ok(_) => println!("Bot account inserted successfully"),
        Err(ref e) => println!("Database insert error: {}", e),
    }
    
    result.map_err(|e| format!("データベースエラー: {}", e))?;
    
    let account_id = conn.last_insert_rowid();
    println!("New account ID: {}", account_id);
    
    // デフォルトの Bot 設定を作成
    let config_result = conn.execute(
        "INSERT INTO bot_configs (account_id, created_at, updated_at)
         VALUES (?, ?, ?)",
        params![account_id, now, now],
    );
    
    match config_result {
        Ok(_) => println!("Bot config created successfully"),
        Err(ref e) => println!("Config creation error: {}", e),
    }
    
    config_result.map_err(|e| format!("設定作成エラー: {}", e))?;
    
    println!("=== ADD BOT ACCOUNT SUCCESS ===");
    Ok(account_id)
}

#[tauri::command]
fn update_bot_account(account: BotAccount, state: State<AppState>) -> Result<(), String> {
    println!("=== UPDATE BOT ACCOUNT DEBUG ===");
    println!("Received account: {:?}", account);
    
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
    
    println!("=== UPDATE BOT ACCOUNT SUCCESS ===");
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
        "execution_logs": logs,
        "user_settings": settings,
        "exported_at": Utc::now().to_rfc3339()
    });
    
    // ファイルに書き込み
    fs::write(path, serde_json::to_string_pretty(&export_data).unwrap())
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

// テスト投稿機能
#[tauri::command]
async fn test_tweet(request: TestTweetRequest, state: State<'_, AppState>) -> Result<TwitterApiResponse, String> {
    println!("=== TEST TWEET DEBUG ===");
    println!("Request: {:?}", request);
    
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
    
    println!("Account found: {}", account.account_name);
    
    // Twitter API v2 へ投稿
    match post_to_twitter(&account, &request.content).await {
        Ok(tweet_id) => {
            println!("Tweet posted successfully: {}", tweet_id);
            
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
            println!("Tweet failed: {}", e);
            
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
    println!("Posting to Twitter API v2 with OAuth 1.0a...");
    
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
    
    println!("OAuth Authorization header generated");
    
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
    
    println!("Twitter API response status: {}", status);
    println!("Twitter API response: {}", response_text);
    
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
            test_tweet
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}