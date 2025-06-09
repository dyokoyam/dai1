// components/ExecutionLogs.jsx
import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FaFilter, FaTwitter, FaExclamationTriangle, FaInfoCircle, FaCheckCircle, FaSearch, FaList } from 'react-icons/fa';
import './ExecutionLogs.css';

function ExecutionLogs() {
  const [logs, setLogs] = useState([]);
  const [botAccounts, setBotAccounts] = useState([]);
  const [filteredLogs, setFilteredLogs] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [selectedLogLevel, setSelectedLogLevel] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [logsPerPage] = useState(50);

  useEffect(() => {
    console.log('ExecutionLogs component mounted');
    fetchData();
    
    // 30秒ごとにログを更新
    const interval = setInterval(fetchLogs, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    applyFilters();
  }, [logs, selectedAccount, selectedLogLevel, searchTerm]);

  const fetchData = async () => {
    await Promise.all([fetchLogs(), fetchBotAccounts()]);
  };

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      console.log('Fetching execution logs...');
      const logData = await invoke('get_execution_logs', { 
        accountId: null, 
        limit: 500 
      });
      console.log('Logs fetched:', logData);
      setLogs(logData || []);
    } catch (error) {
      console.error('Failed to fetch logs:', error);
      setLogs([]); // エラー時は空配列
    } finally {
      setIsLoading(false);
    }
  };

  const fetchBotAccounts = async () => {
    try {
      console.log('Fetching bot accounts for filter...');
      const accounts = await invoke('get_bot_accounts');
      console.log('Bot accounts for filter:', accounts);
      setBotAccounts(accounts || []);
    } catch (error) {
      console.error('Failed to fetch bot accounts:', error);
      setBotAccounts([]); // エラー時は空配列
    }
  };

  const applyFilters = () => {
    let filtered = logs;

    // アカウントフィルター
    if (selectedAccount) {
      filtered = filtered.filter(log => log.account_id === parseInt(selectedAccount));
    }

    // ログレベルフィルター
    if (selectedLogLevel) {
      filtered = filtered.filter(log => log.status === selectedLogLevel);
    }

    // 検索フィルター
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(log => 
        log.message.toLowerCase().includes(term) ||
        (log.tweet_content && log.tweet_content.toLowerCase().includes(term))
      );
    }

    setFilteredLogs(filtered);
    setCurrentPage(1);
  };

  const getAccountName = (accountId) => {
    const account = botAccounts.find(acc => acc.id === accountId);
    return account ? account.api_name : `Account ${accountId}`;
  };

  const getAccountTwitterId = (accountId) => {
    const account = botAccounts.find(acc => acc.id === accountId);
    return account ? account.twitter_username : '';
  };

  const formatDateTime = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getLogIcon = (logType, status) => {
    if (status === 'error') return <FaExclamationTriangle className="log-icon error" />;
    if (status === 'success') return <FaCheckCircle className="log-icon success" />;
    if (logType === 'tweet') return <FaTwitter className="log-icon tweet" />;
    return <FaInfoCircle className="log-icon info" />;
  };

  const getLogTypeText = (logType) => {
    const types = {
      'tweet': 'ツイート',
      'error': 'エラー',
      'info': '情報',
      'warning': '警告'
    };
    return types[logType] || logType;
  };

  const openTweet = (tweetId, twitterUsername) => {
    if (tweetId && twitterUsername) {
      const url = `https://twitter.com/${twitterUsername}/status/${tweetId}`;
      console.log('Opening tweet URL (simple version):', url);
      // シンプル版：window.openを使用
      window.open(url, '_blank');
    }
  };

  // ページネーション
  const indexOfLastLog = currentPage * logsPerPage;
  const indexOfFirstLog = indexOfLastLog - logsPerPage;
  const currentLogs = filteredLogs.slice(indexOfFirstLog, indexOfLastLog);
  const totalPages = Math.ceil(filteredLogs.length / logsPerPage);

  const paginate = (pageNumber) => setCurrentPage(pageNumber);

  console.log('ExecutionLogs render state:', {
    isLoading,
    logsCount: logs.length,
    filteredLogsCount: filteredLogs.length,
    botAccountsCount: botAccounts.length
  });

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Bot実行ログ</h1>
        <p className="page-subtitle">
          各Botの実行状況とエラー情報を確認できます
        </p>
      </div>

      {/* フィルターコントロール */}
      <div className="card">
        <div className="filter-controls">
          <div className="filter-group">
            <label className="filter-label">
              <FaFilter className="filter-icon" />
              対象アカウント:
            </label>
            <select
              className="form-select"
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
            >
              <option value="">全て</option>
              {botAccounts.map(account => (
                <option key={account.id} value={account.id}>
                  {account.api_name} (@{account.twitter_username})
                </option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label">ログレベル:</label>
            <select
              className="form-select"
              value={selectedLogLevel}
              onChange={(e) => setSelectedLogLevel(e.target.value)}
            >
              <option value="">全て</option>
              <option value="success">成功</option>
              <option value="error">エラー</option>
              <option value="warning">警告</option>
            </select>
          </div>

          <div className="filter-group search-group">
            <label className="filter-label">
              <FaSearch className="filter-icon" />
              検索:
            </label>
            <input
              type="text"
              className="form-input"
              placeholder="メッセージまたは投稿内容で検索..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <button className="btn btn-primary" onClick={fetchLogs}>
            更新
          </button>
        </div>
      </div>

      {/* ログ表示 */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            検索結果 ({indexOfFirstLog + 1} ～ {Math.min(indexOfLastLog, filteredLogs.length)} / {filteredLogs.length}件中) 
            ※ 直近1ヶ月の記録のみ表示されます
          </h2>
        </div>

        {isLoading ? (
          <div className="loading">
            <div className="spinner"></div>
            読み込み中...
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <FaList />
            </div>
            <h3 className="empty-state-title">ログが見つかりません</h3>
            <p className="empty-state-description">
              {logs.length === 0 
                ? 'まだ実行ログがありません。Botを追加して実行してください。'
                : '指定した条件に一致するログがありません。'
              }
            </p>
          </div>
        ) : (
          <>
            {/* ページネーション（上部） */}
            {totalPages > 1 && (
              <div className="pagination-container">
                <div className="pagination">
                  <button
                    className="pagination-btn"
                    onClick={() => paginate(currentPage - 1)}
                    disabled={currentPage === 1}
                  >
                    前へ
                  </button>
                  
                  {Array.from({ length: Math.min(5, totalPages) }, (_, index) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = index + 1;
                    } else if (currentPage <= 3) {
                      pageNum = index + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + index;
                    } else {
                      pageNum = currentPage - 2 + index;
                    }
                    
                    return (
                      <button
                        key={pageNum}
                        className={`pagination-btn ${currentPage === pageNum ? 'active' : ''}`}
                        onClick={() => paginate(pageNum)}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  
                  <button
                    className="pagination-btn"
                    onClick={() => paginate(currentPage + 1)}
                    disabled={currentPage === totalPages}
                  >
                    次へ
                  </button>
                </div>
              </div>
            )}

            {/* ログリスト */}
            <div className="logs-list">
              {currentLogs.map((log) => (
                <div key={log.id} className={`log-item ${log.status}`}>
                  <div className="log-header">
                    <div className="log-meta">
                      <span className="log-time">
                        {formatDateTime(log.created_at)}
                      </span>
                      <span className="log-account">
                        [{getAccountName(log.account_id)}]
                      </span>
                      <span className={`log-type ${log.log_type}`}>
                        {getLogTypeText(log.log_type)}
                      </span>
                    </div>
                    <div className="log-status">
                      {getLogIcon(log.log_type, log.status)}
                    </div>
                  </div>
                  
                  <div className="log-content">
                    <div className="log-message">
                      {log.message}
                    </div>
                    
                    {log.tweet_content && (
                      <div className="tweet-content">
                        <strong>投稿内容:</strong> {log.tweet_content}
                      </div>
                    )}
                    
                    {log.tweet_id && (
                      <div className="log-actions">
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => openTweet(log.tweet_id, getAccountTwitterId(log.account_id))}
                        >
                          <FaTwitter /> ツイートを表示
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* ページネーション（下部） */}
            {totalPages > 1 && (
              <div className="pagination-container">
                <div className="pagination">
                  <button
                    className="pagination-btn"
                    onClick={() => paginate(currentPage - 1)}
                    disabled={currentPage === 1}
                  >
                    前へ
                  </button>
                  
                  {Array.from({ length: Math.min(5, totalPages) }, (_, index) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = index + 1;
                    } else if (currentPage <= 3) {
                      pageNum = index + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + index;
                    } else {
                      pageNum = currentPage - 2 + index;
                    }
                    
                    return (
                      <button
                        key={pageNum}
                        className={`pagination-btn ${currentPage === pageNum ? 'active' : ''}`}
                        onClick={() => paginate(pageNum)}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  
                  <button
                    className="pagination-btn"
                    onClick={() => paginate(currentPage + 1)}
                    disabled={currentPage === totalPages}
                  >
                    次へ
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default ExecutionLogs;