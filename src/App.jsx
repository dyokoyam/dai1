import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { HashRouter as Router, Routes, Route, NavLink } from 'react-router-dom';
import { FaUser, FaRobot, FaList, FaCog, FaTwitter } from 'react-icons/fa';
import './App.css';

// 外部コンポーネントをインポート
import MyPage from './components/MyPage.jsx';
import BotManagement from './components/BotManagement.jsx';
import ExecutionLogs from './components/ExecutionLogs.jsx';
import Settings from './components/Settings.jsx';

function App() {
  const [dashboardStats, setDashboardStats] = useState({
    total_accounts: 0,
    active_accounts: 0,
    today_tweets: 0,
    total_tweets: 0,
    error_count: 0
  });
  const [userSettings, setUserSettings] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    console.log('App useEffect triggered');
    fetchDashboardData();
    
    // 30秒ごとに統計情報を更新
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchDashboardData = async () => {
    try {
      setError(null);
      console.log('Fetching dashboard data...');
      
      const [stats, settings] = await Promise.all([
        invoke('get_dashboard_stats'),
        invoke('get_user_settings')
      ]);
      
      console.log('Dashboard stats:', stats);
      console.log('User settings:', settings);
      
      setDashboardStats(stats);
      setUserSettings(settings);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
      setError(error.toString());
      
      // エラー時のデフォルト値設定
      if (!userSettings) {
        setUserSettings({
          plan_type: 'starter',
          max_accounts: 1
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  console.log('App render - isLoading:', isLoading, 'error:', error, 'userSettings:', userSettings);

  if (isLoading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh', 
        backgroundColor: '#F9FAFB' 
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '50px',
            height: '50px',
            border: '4px solid #E5E7EB',
            borderTop: '4px solid #4F46E5',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px'
          }}></div>
          <p style={{ color: '#6B7280' }}>読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error && !userSettings) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh', 
        backgroundColor: '#F9FAFB' 
      }}>
        <div style={{ 
          textAlign: 'center', 
          padding: '32px',
          backgroundColor: 'white',
          borderRadius: '12px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
          maxWidth: '400px'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <h2 style={{ marginBottom: '16px', color: '#EF4444' }}>初期化エラー</h2>
          <p style={{ marginBottom: '24px', color: '#6B7280' }}>
            データベースの初期化に失敗しました。<br />
            アプリケーションを再起動してください。
          </p>
          <p style={{ fontSize: '12px', color: '#9CA3AF' }}>
            エラー詳細: {error}
          </p>
          <button 
            onClick={fetchDashboardData}
            style={{
              marginTop: '16px',
              padding: '8px 16px',
              backgroundColor: '#4F46E5',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            再試行
          </button>
        </div>
      </div>
    );
  }

  return (
    <Router>
      <div className="app-container">
        <nav className="sidebar">
          <div className="sidebar-header">
            <div className="logo">
              <FaTwitter className="logo-icon" />
              <h1>Auto Manager</h1>
            </div>
            <div className="plan-badge">
              {userSettings?.plan_type === 'starter' && (
                <span className="badge starter">スタータープラン</span>
              )}
              {userSettings?.plan_type === 'basic' && (
                <span className="badge basic">ベーシックプラン</span>
              )}
              {userSettings?.plan_type === 'pro' && (
                <span className="badge pro">プロプラン</span>
              )}
            </div>
          </div>
          
          <ul className="nav-menu">
            <li>
              <NavLink
                to="/"
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              >
                <FaUser className="nav-icon" />
                <span>マイページ</span>
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/bot-management"
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              >
                <FaRobot className="nav-icon" />
                <span>Bot管理</span>
                <span className="nav-badge">{dashboardStats.total_accounts}</span>
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/execution-logs"
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              >
                <FaList className="nav-icon" />
                <span>Bot実行ログ</span>
                {dashboardStats.error_count > 0 && (
                  <span className="nav-badge error">{dashboardStats.error_count}</span>
                )}
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/settings"
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              >
                <FaCog className="nav-icon" />
                <span>設定</span>
              </NavLink>
            </li>
          </ul>
          
          <div className="sidebar-footer">
            <div className="quick-stats">
              <div className="stat-item">
                <span className="stat-label">稼働中</span>
                <span className="stat-value">{dashboardStats.active_accounts}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">今日の投稿</span>
                <span className="stat-value">{dashboardStats.today_tweets}</span>
              </div>
            </div>
            <div className="app-version">v0.1.0</div>
          </div>
        </nav>
        
        <main className="main-content">
          <Routes>
            <Route 
              path="/" 
              element={
                <MyPage 
                  stats={dashboardStats} 
                  userSettings={userSettings}
                  onStatsUpdate={fetchDashboardData}
                />
              } 
            />
            <Route 
              path="/bot-management" 
              element={
                <BotManagement 
                  onUpdate={fetchDashboardData}
                  userSettings={userSettings}
                />
              } 
            />
            <Route 
              path="/execution-logs" 
              element={<ExecutionLogs />} 
            />
            <Route 
              path="/settings" 
              element={
                <Settings 
                  userSettings={userSettings}
                  onSettingsUpdate={fetchDashboardData}
                />
              } 
            />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;