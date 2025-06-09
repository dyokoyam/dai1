import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FaPlus, FaEdit, FaTrash, FaPlay, FaPause, FaCog, FaTwitter, FaKey, FaRobot, FaPaperPlane } from 'react-icons/fa';
import './BotManagement.css';

function BotManagement({ onUpdate, userSettings }) {
  console.log('BotManagement rendering - SIMPLIFIED VERSION');
  console.log('userSettings:', userSettings);
  
  const [botAccounts, setBotAccounts] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [currentBot, setCurrentBot] = useState({
    account_name: '',
    api_type: 'Free',
    api_key: '',
    api_key_secret: '',
    access_token: '',
    access_token_secret: '',
    status: 'inactive'
    // created_at と updated_at は自動生成されるので含めない
  });
  const [currentConfig, setCurrentConfig] = useState({
    is_enabled: false,
    auto_tweet_enabled: false,
    tweet_interval_minutes: 60,
    tweet_templates: '',
    hashtags: ''
  });
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [testingBotId, setTestingBotId] = useState(null);

  useEffect(() => {
    console.log('useEffect triggered - fetching bot accounts');
    fetchBotAccounts();
  }, []);

  const fetchBotAccounts = async () => {
    console.log('fetchBotAccounts called');
    setIsLoading(true);
    setError(null);
    
    try {
      console.log('Calling invoke get_bot_accounts...');
      const accounts = await invoke('get_bot_accounts');
      console.log('API call successful, accounts:', accounts);
      setBotAccounts(accounts || []);
    } catch (error) {
      console.error('API call failed:', error);
      setError(`APIエラー: ${error.toString()}`);
    } finally {
      console.log('Setting loading to false');
      setIsLoading(false);
    }
  };

  const openAddModal = () => {
    console.log('Opening add modal');
    setCurrentBot({
      account_name: '',
      api_type: 'Free',
      api_key: '',
      api_key_secret: '',
      access_token: '',
      access_token_secret: '',
      status: 'inactive'
      // created_at と updated_at は自動生成されるので含めない
    });
    setIsEditing(false);
    setIsModalOpen(true);
  };

  const openEditModal = (bot) => {
    console.log('Opening edit modal for bot:', bot);
    setCurrentBot(bot);
    setIsEditing(true);
    setIsModalOpen(true);
  };

  const openConfigModal = async (botId) => {
    console.log('Opening config modal for bot ID:', botId);
    try {
      const config = await invoke('get_bot_config', { accountId: botId });
      console.log('Bot config loaded:', config);
      setCurrentConfig({
        ...config,
        tweet_templates: config.tweet_templates || '',
        hashtags: config.hashtags || ''
      });
      setIsConfigModalOpen(true);
    } catch (error) {
      console.error('Failed to fetch bot config:', error);
      alert('Bot設定の取得に失敗しました。');
    }
  };

  const closeModal = () => {
    console.log('Closing modals');
    setIsModalOpen(false);
    setIsConfigModalOpen(false);
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setCurrentBot({
      ...currentBot,
      [name]: type === 'checkbox' ? checked : value
    });
  };

  const handleConfigChange = (e) => {
    const { name, value, type, checked } = e.target;
    setCurrentConfig({
      ...currentConfig,
      [name]: type === 'checkbox' ? checked : value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    console.log('Submitting bot form:', { isEditing, currentBot });
    
    // プラン制限チェック
    if (!isEditing && botAccounts.length >= (userSettings?.max_accounts || 1)) {
      alert(`現在のプランでは最大${userSettings?.max_accounts || 1}個のBotまでしか作成できません。`);
      return;
    }
    
    // バリデーション
    if (!currentBot.account_name.trim()) {
      alert('アカウント名を入力してください。');
      return;
    }
    if (!currentBot.api_key.trim()) {
      alert('API Keyを入力してください。');
      return;
    }
    if (!currentBot.api_key_secret.trim()) {
      alert('API Key Secretを入力してください。');
      return;
    }
    if (!currentBot.access_token.trim()) {
      alert('Access Tokenを入力してください。');
      return;
    }
    if (!currentBot.access_token_secret.trim()) {
      alert('Access Token Secretを入力してください。');
      return;
    }
    
    try {
      if (isEditing) {
        console.log('Updating bot account...');
        await invoke('update_bot_account', { account: currentBot });
        alert('Botアカウントを更新しました！');
      } else {
        console.log('Adding new bot account...');
        console.log('Bot data being sent:', currentBot);
        const result = await invoke('add_bot_account', { account: currentBot });
        console.log('Add bot result:', result);
        alert('Botアカウントを追加しました！');
      }
      
      console.log('Bot account saved successfully');
      fetchBotAccounts();
      if (onUpdate) onUpdate();
      closeModal();
    } catch (error) {
      console.error('Failed to save bot account:', error);
      alert(`Bot アカウントの保存に失敗しました。\n\nエラー詳細: ${error}`);
    }
  };

  const handleConfigSubmit = async (e) => {
    e.preventDefault();
    console.log('Submitting bot config:', currentConfig);
    
    try {
      await invoke('update_bot_config', { config: currentConfig });
      console.log('Bot config saved successfully');
      fetchBotAccounts();
      if (onUpdate) onUpdate();
      closeModal();
    } catch (error) {
      console.error('Failed to save bot config:', error);
      alert('Bot 設定の保存に失敗しました。');
    }
  };

  const handleDeleteBot = async (id) => {
    console.log('Delete bot requested for ID:', id);
    if (window.confirm('このBotを削除してもよろしいですか？関連する設定とログも削除されます。')) {
      try {
        console.log('Deleting bot account...');
        await invoke('delete_bot_account', { id });
        console.log('Bot deleted successfully');
        fetchBotAccounts();
        if (onUpdate) onUpdate();
      } catch (error) {
        console.error('Failed to delete bot account:', error);
        alert('Botの削除に失敗しました。');
      }
    }
  };

  const toggleBotStatus = async (bot) => {
    const newStatus = bot.status === 'active' ? 'inactive' : 'active';
    console.log(`Toggling bot status from ${bot.status} to ${newStatus}`);
    
    try {
      await invoke('update_bot_account', {
        account: { ...bot, status: newStatus }
      });
      console.log('Bot status updated successfully');
      fetchBotAccounts();
      if (onUpdate) onUpdate();
    } catch (error) {
      console.error('Failed to toggle bot status:', error);
      alert('Bot状態の変更に失敗しました。');
    }
  };

  const handleTestTweet = async (botId, botName) => {
    console.log(`Test tweet requested for bot ID: ${botId}`);
    
    const testContent = prompt('テスト投稿の内容を入力してください:', 
      'こんにちは！これはTwitter Auto Managerからのテスト投稿です 🤖 #テスト投稿');
    
    if (!testContent) {
      return; // キャンセルされた場合
    }
    
    if (testContent.length > 280) {
      alert('投稿内容が280文字を超えています。');
      return;
    }
    
    setTestingBotId(botId);
    
    try {
      console.log('Sending test tweet...');
      const result = await invoke('test_tweet', {
        request: {
          account_id: botId,
          content: testContent
        }
      });
      
      console.log('Test tweet result:', result);
      
      if (result.success) {
        alert(`✅ テスト投稿が成功しました！\n\nツイートID: ${result.tweet_id}\n\n「Bot実行ログ」ページで詳細を確認できます。`);
        if (onUpdate) onUpdate(); // 統計情報を更新
      } else {
        alert(`❌ テスト投稿に失敗しました。\n\nエラー: ${result.message}\n\n「Bot実行ログ」ページでエラー詳細を確認してください。`);
      }
    } catch (error) {
      console.error('Failed to send test tweet:', error);
      alert(`❌ テスト投稿中にエラーが発生しました。\n\nエラー詳細: ${error}\n\nAPI Keyの設定を確認してください。`);
    } finally {
      setTestingBotId(null);
    }
  };

  const getApiTypeBadge = (apiType) => {
    const badges = {
      'Free': { text: '新API(無料)', class: 'api-free' },
      'Basic': { text: 'Basic', class: 'api-basic' },
      'Pro': { text: 'Pro', class: 'api-pro' }
    };
    
    return badges[apiType] || badges['Free'];
  };

  console.log('Current state:', { 
    isLoading, 
    error, 
    botAccountsLength: botAccounts.length,
    userSettingsMaxAccounts: userSettings?.max_accounts,
    isModalOpen,
    isConfigModalOpen 
  });

  if (error) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h1 className="page-title">Bot管理</h1>
        </div>
        <div className="card">
          <div style={{ 
            textAlign: 'center', 
            padding: '40px',
            color: '#EF4444'
          }}>
            <h3>エラーが発生しました</h3>
            <p>{error}</p>
            <button 
              className="btn btn-primary" 
              onClick={fetchBotAccounts}
              style={{ marginTop: '16px' }}
            >
              再試行
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
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
        <h1 className="page-title">Bot管理</h1>
        <p className="page-subtitle">
          Twitter Bot アカウントの管理と設定を行います
          ({botAccounts.length}/{userSettings?.max_accounts || 1} 使用中)
        </p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Bot一覧</h2>
          <button 
            className="btn btn-primary"
            onClick={openAddModal}
            disabled={botAccounts.length >= (userSettings?.max_accounts || 1)}
          >
            <FaPlus /> 新規追加
          </button>
        </div>

        {botAccounts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <FaRobot />
            </div>
            <h3 className="empty-state-title">Botがまだ登録されていません</h3>
            <p className="empty-state-description">
              「新規追加」ボタンから最初のBotを追加してください。
            </p>
            <button className="btn btn-primary" onClick={openAddModal}>
              <FaPlus /> 最初のBotを追加
            </button>
          </div>
        ) : (
          <div className="bot-grid">
            {botAccounts.map((bot) => {
              console.log('Rendering bot:', bot);
              return (
                <div key={bot.id} className="bot-card">
                  <div className="bot-header">
                    <div className="bot-info">
                      <h3 className="bot-name">{bot.account_name || 'Unknown'}</h3>
                      <div className="bot-username">
                        <FaTwitter className="twitter-icon" />
                        {bot.account_name || 'unknown'}
                      </div>
                    </div>
                    <div className="bot-status">
                      <div className={`api-badge ${getApiTypeBadge(bot.api_type).class}`}>
                        {getApiTypeBadge(bot.api_type).text}
                      </div>
                      <div className={`status-badge ${bot.status || 'inactive'}`}>
                        <div className="status-indicator"></div>
                        {(bot.status === 'active') ? '稼働中' : '停止中'}
                      </div>
                    </div>
                  </div>

                  <div className="bot-stats">
                    <div className="stat">
                      <span className="stat-label">API種類:</span>
                      <span className="stat-value">{bot.api_type}</span>
                    </div>
                    <div className="stat">
                      <span className="stat-label">ステータス:</span>
                      <span className="stat-value">
                        {bot.status === 'active' ? '稼働中' : '停止中'}
                      </span>
                    </div>
                  </div>

                  <div className="bot-actions">
                    <button
                      className={`btn ${bot.status === 'active' ? 'btn-secondary' : 'btn-success'}`}
                      onClick={() => toggleBotStatus(bot)}
                      title={bot.status === 'active' ? '停止' : '開始'}
                    >
                      {bot.status === 'active' ? <FaPause /> : <FaPlay />}
                      {bot.status === 'active' ? '停止' : '開始'}
                    </button>
                    
                    <button
                      className="btn btn-primary"
                      onClick={() => handleTestTweet(bot.id, bot.account_name)}
                      disabled={testingBotId === bot.id}
                      title="テスト投稿"
                    >
                      {testingBotId === bot.id ? (
                        <>⏳ 投稿中...</>
                      ) : (
                        <>
                          <FaPaperPlane />
                          テスト投稿
                        </>
                      )}
                    </button>
                    
                    <button
                      className="btn btn-secondary"
                      onClick={() => openConfigModal(bot.id)}
                      title="設定"
                    >
                      <FaCog />
                    </button>
                    
                    <button
                      className="btn btn-secondary"
                      onClick={() => openEditModal(bot)}
                      title="編集"
                    >
                      <FaEdit />
                    </button>
                    
                    <button
                      className="btn btn-danger"
                      onClick={() => handleDeleteBot(bot.id)}
                      title="削除"
                    >
                      <FaTrash />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bot追加/編集モーダル */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2 className="modal-title">
                {isEditing ? 'Bot編集' : 'Bot追加'}
              </h2>
            </div>
            
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">アカウント名</label>
                <input
                  type="text"
                  name="account_name"
                  className="form-input"
                  value={currentBot.account_name}
                  onChange={handleInputChange}
                  placeholder="例: my_twitter_bot"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">API種類</label>
                <select
                  name="api_type"
                  className="form-select"
                  value={currentBot.api_type}
                  onChange={handleInputChange}
                >
                  <option value="Free">新API(無料 | Free)</option>
                  <option value="Basic">Basic</option>
                  <option value="Pro">Pro</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">
                  <FaKey /> API Key
                </label>
                <input
                  type="text"
                  name="api_key"
                  className="form-input"
                  value={currentBot.api_key}
                  onChange={handleInputChange}
                  placeholder="Twitter API Key"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  <FaKey /> API Key Secret
                </label>
                <input
                  type="password"
                  name="api_key_secret"
                  className="form-input"
                  value={currentBot.api_key_secret}
                  onChange={handleInputChange}
                  placeholder="Twitter API Key Secret"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  <FaKey /> Access Token
                </label>
                <input
                  type="text"
                  name="access_token"
                  className="form-input"
                  value={currentBot.access_token}
                  onChange={handleInputChange}
                  placeholder="Twitter Access Token"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  <FaKey /> Access Token Secret
                </label>
                <input
                  type="password"
                  name="access_token_secret"
                  className="form-input"
                  value={currentBot.access_token_secret}
                  onChange={handleInputChange}
                  placeholder="Twitter Access Token Secret"
                  required
                />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={closeModal}>
                  キャンセル
                </button>
                <button type="submit" className="btn btn-primary">
                  {isEditing ? '更新' : '追加'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bot設定モーダル */}
      {isConfigModalOpen && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2 className="modal-title">Bot設定</h2>
            </div>
            
            <form onSubmit={handleConfigSubmit}>
              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    name="is_enabled"
                    checked={currentConfig.is_enabled}
                    onChange={handleConfigChange}
                  />
                  Botを有効にする
                </label>
              </div>

              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    name="auto_tweet_enabled"
                    checked={currentConfig.auto_tweet_enabled}
                    onChange={handleConfigChange}
                  />
                  自動投稿を有効にする
                </label>
              </div>

              <div className="form-group">
                <label className="form-label">投稿間隔（分）</label>
                <input
                  type="number"
                  name="tweet_interval_minutes"
                  className="form-input"
                  value={currentConfig.tweet_interval_minutes}
                  onChange={handleConfigChange}
                  min="15"
                  max="1440"
                />
              </div>

              <div className="form-group">
                <label className="form-label">投稿テンプレート（1行に1つ）</label>
                <textarea
                  name="tweet_templates"
                  className="form-textarea"
                  value={currentConfig.tweet_templates}
                  onChange={handleConfigChange}
                  placeholder="今日も一日頑張ろう！&#10;おはようございます！&#10;お疲れ様でした！"
                  rows={4}
                />
              </div>

              <div className="form-group">
                <label className="form-label">ハッシュタグ（カンマ区切り）</label>
                <input
                  type="text"
                  name="hashtags"
                  className="form-input"
                  value={currentConfig.hashtags}
                  onChange={handleConfigChange}
                  placeholder="#bot,#自動投稿,#Twitter"
                />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={closeModal}>
                  キャンセル
                </button>
                <button type="submit" className="btn btn-primary">
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default BotManagement;