# Twitter Bot Auto Manager

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-blue.svg)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-18.x-61dafb.svg)](https://reactjs.org/)
[![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-Enabled-green.svg)](https://github.com/features/actions)

## 🎯 概要

**Twitter Bot Auto Manager** は、複数のTwitter Botを効率的に管理し、24時間365日の自動運用を実現する高機能デスクトップアプリケーションです。

### ✨ 主要機能

- 🤖 **マルチBot管理**: 最大10個のTwitter Botアカウントを統合管理
- 📅 **スケジュール投稿**: 複数の投稿内容を時間指定で自動投稿
- 💬 **自動リプライ**: 1つのBotで複数アカウントを監視し自動返信
- ☁️ **GitHub Actions連携**: クラウドベースの24/7自動実行
- 📊 **実行ログ管理**: 詳細な実行履歴とエラートラッキング
- 💾 **データバックアップ**: 設定とログの完全バックアップ機能

## 🏗️ アーキテクチャ

```
🖥️ デスクトップアプリ (Tauri + React)
    ↕️
📊 SQLiteデータベース (Bot設定・ログ管理)
    ↕️
🤖 GitHub Actions (自動化エンジン)
    ↕️  
🐦 Twitter API v2 (投稿・監視)
```

## 🚀 はじめ方

### 前提条件

- **Node.js** 18.0.0以上
- **Rust** (Tauriビルド用)
- **Git** (GitHub Actions連携用)
- **Twitter Developer Account** (API Key取得用)

### インストール

1. **リポジトリのクローン**
   ```bash
   git clone https://github.com/yourusername/twitter-auto-manager.git
   cd twitter-auto-manager
   ```

2. **依存関係のインストール**
   ```bash
   # メインアプリケーション
   npm install
   
   # スクリプト依存関係
   cd scripts && npm install && cd ..
   ```

3. **開発環境の起動**
   ```bash
   npm run tauri
   ```

### Twitter API設定

1. [Twitter Developer Portal](https://developer.twitter.com/) でアプリを作成
2. API Key, API Secret, Access Token, Access Token Secret を取得
3. アプリ内の「Bot管理」からTwitterアカウントを追加

## 📁 プロジェクト構造

```
X_5/
├── 🎨 フロントエンド
│   ├── src/
│   │   ├── App.jsx                 # メインアプリケーション
│   │   ├── components/
│   │   │   ├── BotManagement.jsx   # Bot管理画面
│   │   │   ├── ExecutionLogs.jsx   # 実行ログ画面
│   │   │   ├── MyPage.jsx         # ダッシュボード
│   │   │   └── Settings.jsx       # システム設定
│   │   └── main.jsx               # Reactエントリー
│   
├── 🤖 自動化エンジン
│   ├── scripts/
│   │   ├── post-tweets.js         # スケジュール投稿
│   │   ├── reply-monitor.js       # リプライ監視  
│   │   ├── shared-utils.js        # 共通ユーティリティ
│   │   └── package.json           # Node.js依存関係
│   
├── ⚙️ GitHub Actions
│   ├── .github/workflows/
│   │   ├── auto-tweet.yml         # 投稿自動化 (毎時0分)
│   │   └── reply-monitor.yml      # 返信監視 (毎時30分)
│   
├── 💾 データ層
│   ├── data/
│   │   ├── github-config.json     # GitHub Actions用設定
│   │   └── *.sqlite              # SQLiteデータベース
│   
└── 🔧 バックエンド
    └── src-tauri/                 # Rustバックエンド
```

## 🔄 使用方法

### Bot追加と設定

1. **Bot追加**
   - 「Bot管理」→「新規追加」
   - Twitter API認証情報を入力
   - ステータスを「稼働中」に変更

2. **スケジュール投稿設定**
   - Botカードの「設定」ボタンをクリック
   - 投稿時間を選択（複数時間対応）
   - 投稿内容リストを作成（順次自動投稿）

3. **自動リプライ設定**
   - Botカードの「返信」ボタンをクリック
   - 監視対象アカウントを選択（複数選択可）
   - 返信内容を設定

### GitHub Actions連携

1. **設定エクスポート**
   - 「設定」→「GitHub Actions連携」
   - 「GitHub Actions用設定をエクスポート」実行
   - `data/github-config.json` を生成

2. **GitHubリポジトリ設定**
   ```bash
   # 設定ファイルをコミット
   git add data/github-config.json
   git commit -m "Add bot configuration"
   git push
   ```

3. **自動実行開始**
   - GitHub Actionsが自動的に開始
   - 毎時0分: スケジュール投稿
   - 毎時30分: リプライ監視

## 🛠️ 技術スタック

### フロントエンド
- **React 18**: モダンなUI構築
- **Vite**: 高速ビルドツール
- **React Router**: SPA routing
- **React Icons**: アイコンライブラリ

### バックエンド
- **Tauri 2.x**: Rustベースデスクトップフレームワーク
- **SQLite**: 軽量データベース
- **Rust**: 高性能バックエンド

### 自動化
- **Node.js 18**: JavaScript実行環境
- **GitHub Actions**: CI/CDパイプライン
- **twitter-api-v2**: Twitter API v2ライブラリ

## 🔧 高度な機能

### メモリインデックス管理
```javascript
// 同一実行内での重複投稿完全回避
const memoryIndices = new Map();
const currentIndex = memoryIndices.has(accountName) 
  ? memoryIndices.get(accountName) 
  : (botConfig.current_index || 0);
```

### Rate Limit対応
```javascript
// Twitter API制限を考慮した実装
await new Promise(resolve => setTimeout(resolve, 1500));
if (result.rateLimited) {
  log.warn('Rate limit reached, skipping this cycle');
  continue;
}
```

### 自動設定同期
- デスクトップアプリでの設定変更
- GitHub Actions実行時の設定自動更新
- 変更内容の自動Gitコミット

## 📊 監視とログ

### 実行ログ機能
- ✅ 成功/失敗の詳細記録
- 🔍 アカウント別フィルタリング
- 📈 統計情報とグラフ表示
- 🔗 Twitter投稿への直接リンク

### エラートラッキング
- API制限エラーの自動検知
- 認証エラーの詳細ログ
- 自動復旧メカニズム

## 🚦 開発・デプロイ

### 開発環境
```bash
# 開発サーバー起動
npm run dev

# Tauriアプリ起動
npm run tauri

# スクリプトテスト
cd scripts
npm run test:posts
npm run dry-run:replies
```

### プロダクションビルド
```bash
# デスクトップアプリビルド
npm run tauri:build

# 配布可能な実行ファイル生成
# Windows: *.exe
# macOS: *.dmg
# Linux: *.AppImage
```

## 🔒 セキュリティ

- **API Key暗号化**: ローカルデータベースでの安全な保存
- **設定ファイル分離**: 認証情報の適切な管理
- **GitHub Secrets**: 機密情報のクラウド保護

⚠️ **重要**: `github-config.json` にはAPI認証情報が含まれます。パブリックリポジトリへの誤コミットに注意してください。

## 📈 ロードマップ

- [ ] **プラン管理機能**: Starter/Basic/Pro対応
- [ ] **分析ダッシュボード**: エンゲージメント分析
- [ ] **テンプレート機能**: 投稿内容テンプレート
- [ ] **Webhook連携**: 外部サービス連携
- [ ] **マルチ言語対応**: 英語・日本語対応

## 🤝 コントリビューション

1. このリポジトリをフォーク
2. フィーチャーブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'Add amazing feature'`)
4. ブランチにプッシュ (`git push origin feature/amazing-feature`)
5. Pull Requestを開く

## 📝 ライセンス

このプロジェクトは [MIT License](LICENSE) の下で公開されています。

## 🆘 サポート

- **Issue**: バグ報告や機能要望
- **Discord**: [コミュニティサーバー](https://discord.gg/your-server)
- **Email**: support@your-domain.com

## 🙏 謝辞

- [Tauri](https://tauri.app/) - 素晴らしいデスクトップアプリフレームワーク
- [Twitter API](https://developer.twitter.com/) - 強力なAPI提供
- [GitHub Actions](https://github.com/features/actions) - 信頼性の高いCI/CD環境

---

**Twitter Bot Auto Manager** で、効率的なTwitter Bot運用を始めましょう！ 🚀