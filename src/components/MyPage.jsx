// components/MyPage.jsx
import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FaUser, FaRobot, FaChartLine, FaExclamationTriangle, FaCrown, FaCalendarCheck } from 'react-icons/fa';
import './MyPage.css';

function MyPage({ stats, userSettings, onStatsUpdate }) {
  const [isUpdating, setIsUpdating] = useState(false);

  const handleUpdateSettings = async (newPlan) => {
    setIsUpdating(true);
    try {
      await invoke('update_user_settings', {
        settings: {
          ...userSettings,
          plan_type: newPlan,
          max_accounts: newPlan === 'starter' ? 1 : newPlan === 'basic' ? 5 : 10
        }
      });
      onStatsUpdate();
    } catch (error) {
      console.error('Failed to update settings:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  if (!userSettings) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        読み込み中...
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">マイページ</h1>
        <p className="page-subtitle">アカウント情報とBot運用状況をご確認いただけます</p>
      </div>

      {/* ユーザー情報カード */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">登録情報</h2>
        </div>
        
        <div className="grid grid-2">
          <div>
            <div className="form-group">
              <label className="form-label">会員ID</label>
              <div className="user-info-display">
                <span className="user-id">294755</span>
                <span className="referral-note">【紹介リンク経由での契約】</span>
              </div>
            </div>
            
            <div className="form-group">
              <label className="form-label">アカウント名</label>
              <div className="user-name">dikinman15</div>
            </div>
            
            <div className="form-group">
              <label className="form-label">登録メールアドレス</label>
              <div className="user-email">v.kdb.420@gmail.com</div>
            </div>
            
            <div className="form-group">
              <label>
                <input type="checkbox" className="form-checkbox" />
                ツールに関するお知らせメールを受け取る
              </label>
            </div>
            
            <button className="btn btn-primary" disabled={isUpdating}>
              {isUpdating ? '更新中...' : '更新'}
            </button>
          </div>
          
          <div>
            <div className="plan-info">
              <div className="current-plan">
                <div className="plan-header">
                  <FaCrown className="plan-icon" />
                  <div>
                    <h3>現在利用できる機能</h3>
                    <div className="plan-badge-large">
                      <span className={`badge ${userSettings.plan_type}`}>
                        {userSettings.plan_type === 'starter' && 'スタータープラン'}
                        {userSettings.plan_type === 'basic' && 'ベーシックプラン'}
                        {userSettings.plan_type === 'pro' && 'プロプラン'}
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="plan-details">
                  <div className="plan-expiry">
                    <FaCalendarCheck className="icon" />
                    <span>
                      {userSettings.plan_type === 'starter' 
                        ? `${formatDate(userSettings.created_at)}から有効` 
                        : `2025-06-23 まで有効`
                      }
                    </span>
                  </div>
                  
                  <div className="plan-limits">
                    <p><strong>最大Bot数:</strong> {userSettings.max_accounts}個</p>
                    <p><strong>1日の投稿上限:</strong> 各Bot 7投稿/日</p>
                    {userSettings.plan_type === 'starter' && (
                      <>
                        <p><strong>API制限:</strong> Twitter API Free tier</p>
                        <p><strong>サポート:</strong> コミュニティサポート</p>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ダッシュボード統計 */}
      <div className="grid grid-4">
        <div className="stat-card">
          <div className="stat-icon bot">
            <FaRobot />
          </div>
          <div className="stat-content">
            <div className="stat-number">{stats.total_accounts}</div>
            <div className="stat-label">登録Bot数</div>
            <div className="stat-sub">稼働中: {stats.active_accounts}個</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon tweets">
            <FaChartLine />
          </div>
          <div className="stat-content">
            <div className="stat-number">{stats.today_tweets}</div>
            <div className="stat-label">今日の投稿</div>
            <div className="stat-sub">総投稿: {stats.total_tweets}件</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon success">
            <FaUser />
          </div>
          <div className="stat-content">
            <div className="stat-number">{stats.total_accounts > 0 ? Math.round((stats.active_accounts / stats.total_accounts) * 100) : 0}%</div>
            <div className="stat-label">稼働率</div>
            <div className="stat-sub">過去24時間</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className={`stat-icon ${stats.error_count > 0 ? 'error' : 'success'}`}>
            <FaExclamationTriangle />
          </div>
          <div className="stat-content">
            <div className="stat-number">{stats.error_count}</div>
            <div className="stat-label">エラー件数</div>
            <div className="stat-sub">今日発生分</div>
          </div>
        </div>
      </div>

      {/* プラン管理 */}
      {userSettings.plan_type === 'starter' && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">プランアップグレード</h2>
          </div>
          
          <div className="upgrade-options">
            <div className="upgrade-option">
              <h3>ベーシックプラン</h3>
              <div className="price">¥980/月</div>
              <ul className="features">
                <li>Bot数: 最大5個</li>
                <li>API: Twitter API Basic</li>
                <li>優先サポート</li>
                <li>高度な分析機能</li>
              </ul>
              <button 
                className="btn btn-primary"
                onClick={() => handleUpdateSettings('basic')}
                disabled={isUpdating}
              >
                アップグレード
              </button>
            </div>
            
            <div className="upgrade-option featured">
              <div className="popular-badge">人気</div>
              <h3>プロプラン</h3>
              <div className="price">¥1,980/月</div>
              <ul className="features">
                <li>Bot数: 最大10個</li>
                <li>API: Twitter API Pro</li>
                <li>24時間サポート</li>
                <li>カスタム機能</li>
                <li>API分析レポート</li>
              </ul>
              <button 
                className="btn btn-primary"
                onClick={() => handleUpdateSettings('pro')}
                disabled={isUpdating}
              >
                アップグレード
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MyPage;