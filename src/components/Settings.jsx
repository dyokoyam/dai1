// components/Settings.jsx
import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import { FaSave, FaUpload, FaInfoCircle, FaCog, FaDatabase, FaShieldAlt, FaGithub } from 'react-icons/fa';
import './Settings.css';

function Settings({ userSettings, onSettingsUpdate }) {
  const [exportPath, setExportPath] = useState('');
  const [importPath, setImportPath] = useState('');
  const [gitHubExportPath, setGitHubExportPath] = useState('data/github-config.json');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isGitHubExporting, setIsGitHubExporting] = useState(false);
  const [message, setMessage] = useState(null);
  const [appSettings, setAppSettings] = useState({
    autoStart: false,
    notifications: true,
    darkMode: false,
    logLevel: 'info'
  });

  console.log('Settings component rendered with userSettings:', userSettings);

  // ダイアログでエクスポート先を選択
  const selectExportPath = async () => {
    try {
      const path = await save({
        title: 'データのエクスポート先を選択',
        filters: [{
          name: 'JSON',
          extensions: ['json']
        }],
        defaultPath: `twilia-backup-${new Date().toISOString().split('T')[0]}.json`
      });
      if (path) {
        setExportPath(path);
      }
    } catch (error) {
      console.error('ファイル選択エラー:', error);
      // フォールバック：プロンプトを使用
      const path = prompt('エクスポート先のファイルパスを入力してください：', 
        `twilia-backup-${new Date().toISOString().split('T')[0]}.json`);
      if (path) {
        setExportPath(path);
      }
    }
  };

  // ダイアログでインポートファイルを選択
  const selectImportPath = async () => {
    try {
      const path = await open({
        title: 'インポートするファイルを選択',
        filters: [{
          name: 'JSON',
          extensions: ['json']
        }],
        multiple: false
      });
      if (path) {
        setImportPath(path);
      }
    } catch (error) {
      console.error('ファイル選択エラー:', error);
      // フォールバック：プロンプトを使用
      const path = prompt('インポートするファイルのパスを入力してください：');
      if (path) {
        setImportPath(path);
      }
    }
  };

  // ダイアログでGitHub設定ファイルの保存先を選択
  const selectGitHubExportPath = async () => {
    try {
      const path = await save({
        title: 'GitHub Actions用設定ファイルの保存先を選択',
        filters: [{
          name: 'JSON',
          extensions: ['json']
        }],
        defaultPath: 'data/github-config.json'
      });
      if (path) {
        setGitHubExportPath(path);
      }
    } catch (error) {
      console.error('ファイル選択エラー:', error);
      // フォールバック：プロンプトを使用
      const path = prompt('GitHub Actions用設定ファイルの保存先を入力してください：', 
        'data/github-config.json');
      if (path) {
        setGitHubExportPath(path);
      }
    }
  };

  const handleExport = async () => {
    if (!exportPath) {
      setMessage({ type: 'error', text: 'エクスポート先を選択してください' });
      return;
    }
    
    setIsExporting(true);
    setMessage(null);
    
    try {
      console.log('Exporting data to:', exportPath);
      await invoke('export_data', { path: exportPath });
      setMessage({ 
        type: 'success', 
        text: `データを正常にエクスポートしました: ${exportPath}` 
      });
      setExportPath('');
    } catch (error) {
      console.error('Export failed:', error);
      setMessage({ type: 'error', text: `エクスポートに失敗しました: ${error}` });
    } finally {
      setIsExporting(false);
    }
  };

  const handleGitHubExport = async () => {
    if (!gitHubExportPath) {
      setMessage({ type: 'error', text: 'GitHub Actions用設定ファイルの保存先を選択してください' });
      return;
    }
    
    setIsGitHubExporting(true);
    setMessage(null);
    
    try {
      console.log('Exporting GitHub config to:', gitHubExportPath);
      await invoke('export_github_config', { path: gitHubExportPath });
      setMessage({ 
        type: 'success', 
        text: `GitHub Actions用設定を正常にエクスポートしました: ${gitHubExportPath}\n\nこのファイルをGitHubリポジトリにコミットしてください。` 
      });
      setGitHubExportPath('data/github-config.json');
    } catch (error) {
      console.error('GitHub export failed:', error);
      setMessage({ type: 'error', text: `GitHub Actions用設定のエクスポートに失敗しました: ${error}` });
    } finally {
      setIsGitHubExporting(false);
    }
  };

  const handleImport = async () => {
    if (!importPath) {
      setMessage({ type: 'error', text: 'インポートするファイルを選択してください' });
      return;
    }
    
    if (!window.confirm('インポートを実行すると既存のデータが上書きされる可能性があります。続行しますか？')) {
      return;
    }
    
    setIsImporting(true);
    setMessage(null);
    
    try {
      console.log('Importing data from:', importPath);
      // TODO: インポート機能の実装が必要
      // await invoke('import_data', { path: importPath });
      setMessage({ 
        type: 'warning', 
        text: 'インポート機能は現在開発中です。' 
      });
      setImportPath('');
      if (onSettingsUpdate) onSettingsUpdate();
    } catch (error) {
      console.error('Import failed:', error);
      setMessage({ type: 'error', text: `インポートに失敗しました: ${error}` });
    } finally {
      setIsImporting(false);
    }
  };

  const handleSettingsChange = (key, value) => {
    console.log(`App setting changed: ${key} = ${value}`);
    setAppSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const saveAppSettings = async () => {
    try {
      console.log('Saving app settings:', appSettings);
      // TODO: アプリケーション設定の保存機能
      setMessage({ type: 'success', text: '設定を保存しました' });
    } catch (error) {
      console.error('Save settings failed:', error);
      setMessage({ type: 'error', text: '設定の保存に失敗しました' });
    }
  };

  const clearMessage = () => {
    setMessage(null);
  };

  if (!userSettings) {
    return (
      <div className="page-container">
        <div className="loading">
          <div className="spinner"></div>
          読み込み中...
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">設定</h1>
        <p className="page-subtitle">アプリケーションの設定とデータ管理</p>
      </div>

      {/* メッセージ表示 */}
      {message && (
        <div className={`message ${message.type}`}>
          <FaInfoCircle />
          <span>{message.text}</span>
          <button className="message-close" onClick={clearMessage}>×</button>
        </div>
      )}

      {/* アプリケーション設定 */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            <FaCog className="card-icon" />
            アプリケーション設定
          </h2>
        </div>
        
        <div className="settings-grid">
          <div className="setting-item">
            <div className="setting-info">
              <h4>自動起動</h4>
              <p>システム起動時にTwitter Auto Managerを自動で開始します</p>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={appSettings.autoStart}
                onChange={(e) => handleSettingsChange('autoStart', e.target.checked)}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <h4>通知</h4>
              <p>Bot実行やエラーの通知を表示します</p>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={appSettings.notifications}
                onChange={(e) => handleSettingsChange('notifications', e.target.checked)}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <h4>ダークモード</h4>
              <p>UIをダークテーマで表示します</p>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={appSettings.darkMode}
                onChange={(e) => handleSettingsChange('darkMode', e.target.checked)}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <h4>ログレベル</h4>
              <p>保存するログの詳細度を設定します</p>
            </div>
            <select
              className="form-select"
              value={appSettings.logLevel}
              onChange={(e) => handleSettingsChange('logLevel', e.target.value)}
            >
              <option value="error">エラーのみ</option>
              <option value="warning">警告以上</option>
              <option value="info">情報以上</option>
              <option value="debug">すべて</option>
            </select>
          </div>
        </div>

        <div className="card-actions">
          <button className="btn btn-primary" onClick={saveAppSettings}>
            <FaSave /> 設定を保存
          </button>
        </div>
      </div>

      {/* GitHub Actions連携 */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            <FaGithub className="card-icon" />
            GitHub Actions連携
          </h2>
        </div>
        
        <div className="backup-grid">
          <div className="backup-option">
            <div className="backup-header">
              <FaGithub className="backup-icon export" />
              <div>
                <h3>スケジュール投稿設定エクスポート</h3>
                <p>Bot設定で指定したスケジュール投稿をGitHub Actionsで実行するための設定ファイルを出力します</p>
              </div>
            </div>
            
            <div className="backup-content">
              <div className="backup-warning">
                <FaShieldAlt className="warning-icon" />
                <span>このファイルにはAPI認証情報が含まれます。GitHubリポジトリにコミットする際はご注意ください</span>
              </div>
              
              <div className="path-selector">
                <input
                  type="text"
                  className="form-input"
                  value={gitHubExportPath}
                  onChange={(e) => setGitHubExportPath(e.target.value)}
                  placeholder="保存先: data/github-config.json"
                />
                <button className="btn btn-secondary" onClick={selectGitHubExportPath}>
                  ファイル選択
                </button>
              </div>
              
              <button 
                className="btn btn-primary"
                onClick={handleGitHubExport}
                disabled={isGitHubExporting || !gitHubExportPath}
              >
                <FaGithub />
                {isGitHubExporting ? 'エクスポート中...' : 'GitHub Actions用設定をエクスポート'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* データバックアップ */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            <FaDatabase className="card-icon" />
            データバックアップ
          </h2>
        </div>
        
        <div className="backup-grid">
          <div className="backup-option">
            <div className="backup-header">
              <FaSave className="backup-icon export" />
              <div>
                <h3>データのエクスポート</h3>
                <p>Bot設定、実行ログ、ユーザー設定をJSONファイルに保存します</p>
              </div>
            </div>
            
            <div className="backup-content">
              <div className="path-selector">
                <input
                  type="text"
                  className="form-input"
                  value={exportPath}
                  onChange={(e) => setExportPath(e.target.value)}
                  placeholder="保存先パスを入力または下記ボタンで設定..."
                />
                <button className="btn btn-secondary" onClick={selectExportPath}>
                  ファイル選択
                </button>
              </div>
              
              <button 
                className="btn btn-primary"
                onClick={handleExport}
                disabled={isExporting || !exportPath}
              >
                <FaSave />
                {isExporting ? 'エクスポート中...' : 'エクスポート実行'}
              </button>
            </div>
          </div>
          
          <div className="backup-option">
            <div className="backup-header">
              <FaUpload className="backup-icon import" />
              <div>
                <h3>データのインポート</h3>
                <p>以前にエクスポートしたデータファイルを読み込みます</p>
              </div>
            </div>
            
            <div className="backup-content">
              <div className="backup-warning">
                <FaShieldAlt className="warning-icon" />
                <span>インポートを実行すると既存のデータが置き換えられます</span>
              </div>
              
              <div className="path-selector">
                <input
                  type="text"
                  className="form-input"
                  value={importPath}
                  onChange={(e) => setImportPath(e.target.value)}
                  placeholder="インポートファイルのパスを入力または下記ボタンで設定..."
                />
                <button className="btn btn-secondary" onClick={selectImportPath}>
                  ファイル選択
                </button>
              </div>
              
              <button 
                className="btn btn-primary"
                onClick={handleImport}
                disabled={isImporting || !importPath}
              >
                <FaUpload />
                {isImporting ? 'インポート中...' : 'インポート実行'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* アプリケーション情報 */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            <FaInfoCircle className="card-icon" />
            アプリケーション情報
          </h2>
        </div>
        
        <div className="app-info">
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">アプリケーション名</span>
              <span className="info-value">Twitter Auto Manager</span>
            </div>
            <div className="info-item">
              <span className="info-label">バージョン</span>
              <span className="info-value">v0.1.0</span>
            </div>
            <div className="info-item">
              <span className="info-label">プラン</span>
              <span className="info-value">
                <span className={`badge ${userSettings.plan_type}`}>
                  {userSettings.plan_type === 'starter' && 'スタータープラン'}
                  {userSettings.plan_type === 'basic' && 'ベーシックプラン'}
                  {userSettings.plan_type === 'pro' && 'プロプラン'}
                </span>
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">最大Bot数</span>
              <span className="info-value">{userSettings.max_accounts}個</span>
            </div>
            <div className="info-item">
              <span className="info-label">技術スタック</span>
              <span className="info-value">Tauri + React + SQLite</span>
            </div>
            <div className="info-item">
              <span className="info-label">Twitter API</span>
              <span className="info-value">v2 対応</span>
            </div>
          </div>
          
          <div className="app-description">
            <p>
              <strong>Twitter Auto Manager</strong> は、Twitter Bot の自動運用を支援するデスクトップアプリケーションです。
              複数のTwitterアカウントを効率的に管理し、スケジュールに基づいた自動投稿を実現します。
              GitHub Actionsとの連携により、24時間365日の自動投稿が可能です。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Settings;