import React, { useState, useEffect } from 'react';
import './Login.css';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('aicam_dark_mode');
    return saved ? JSON.parse(saved) : false;
  });

  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
  }, [isDarkMode]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));

    try {
      // Simple validation - replace with your backend later
      if (username && password) {
        localStorage.setItem('aicam_authenticated', 'true');
        localStorage.setItem('aicam_username', username);
        onLogin();
      } else {
        setError('Please enter both username and password');
      }
    } catch (err) {
      setError('Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`login-page ${isDarkMode ? 'dark-mode' : ''}`}>
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <h1 className="login-logo">SafeVision</h1>
            <p className="login-tagline">Protecting what matters most</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form">
            <div className="input-group">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                className="login-input"
                autoComplete="username"
              />
            </div>

            <div className="input-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="login-input"
                autoComplete="current-password"
              />
            </div>

            {error && <div className="login-error">{error}</div>}

            <button 
              type="submit" 
              className="login-btn"
              disabled={isLoading}
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="login-footer-text">
            Your home security starts here
          </div>
        </div>
      </div>
    </div>
  );
}