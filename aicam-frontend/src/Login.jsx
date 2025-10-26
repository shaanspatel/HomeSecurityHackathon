import React, { useState, useEffect } from 'react';
import { signIn, confirmSignIn, signUp, confirmSignUp, resendSignUpCode } from 'aws-amplify/auth';
import './Login.css';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const [needsNewPassword, setNeedsNewPassword] = useState(false);
  const [needsEmailVerification, setNeedsEmailVerification] = useState(false);
  const [verificationStep, setVerificationStep] = useState('');
  const [isSignUpMode, setIsSignUpMode] = useState(false);
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

  const handleSignUpSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validate passwords match
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    // Validate password requirements
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (!/[a-z]/.test(password)) {
      setError('Password must contain a lowercase letter');
      return;
    }
    if (!/[A-Z]/.test(password)) {
      setError('Password must contain an uppercase letter');
      return;
    }
    if (!/[0-9]/.test(password)) {
      setError('Password must contain a number');
      return;
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
      setError('Password must contain a special character');
      return;
    }

    // Validate email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setIsLoading(true);

    try {
      const { isSignUpComplete, userId, nextStep } = await signUp({
        username,
        password,
        options: {
          userAttributes: {
            email,
          },
        },
      });

      console.log('Sign up response:', { isSignUpComplete, userId, nextStep });

      if (nextStep.signUpStep === 'CONFIRM_SIGN_UP') {
        setNeedsEmailVerification(true);
        setSuccess('Account created! Please check your email for a verification code.');
      } else if (isSignUpComplete) {
        setSuccess('Account created successfully! Please sign in.');
        setTimeout(() => {
          setIsSignUpMode(false);
          setPassword('');
          setConfirmPassword('');
          setEmail('');
        }, 2000);
      }
    } catch (err) {
      console.error('Sign up error:', err);

      switch (err.name) {
        case 'UsernameExistsException':
          setError('Username already exists');
          break;
        case 'InvalidPasswordException':
          setError('Password does not meet requirements');
          break;
        case 'InvalidParameterException':
          setError('Invalid email or username format');
          break;
        default:
          setError(`Sign up failed: ${err.message || 'Please try again'}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailVerificationSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const { isSignUpComplete } = await confirmSignUp({
        username,
        confirmationCode: verificationCode,
      });

      if (isSignUpComplete) {
        setSuccess('Email verified! You can now sign in.');
        setTimeout(() => {
          setNeedsEmailVerification(false);
          setIsSignUpMode(false);
          setVerificationCode('');
          setPassword('');
          setConfirmPassword('');
          setEmail('');
        }, 2000);
      }
    } catch (err) {
      console.error('Verification error:', err);
      setError(`Verification failed: ${err.message || 'Please try again'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    setError('');
    setIsLoading(true);

    try {
      await resendSignUpCode({ username });
      setSuccess('Verification code resent! Check your email.');
    } catch (err) {
      setError(`Failed to resend code: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsLoading(true);

    try {
      const { isSignedIn, nextStep } = await signIn({
        username,
        password,
      });

      console.log('Sign in response:', { isSignedIn, nextStep });

      if (isSignedIn) {
        localStorage.setItem('aicam_authenticated', 'true');
        localStorage.setItem('aicam_username', username);
        onLogin();
      } else {
        switch (nextStep.signInStep) {
          case 'CONFIRM_SIGN_UP':
            setError('Please confirm your email first. Check your inbox for a verification code.');
            setNeedsEmailVerification(true);
            break;
          case 'RESET_PASSWORD':
            setError('Password reset required. Please reset your password.');
            break;
          case 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED':
            setNeedsNewPassword(true);
            setError('');
            break;
          case 'CONFIRM_SIGN_IN_WITH_TOTP_CODE':
          case 'CONFIRM_SIGN_IN_WITH_SMS_CODE':
          case 'CONFIRM_SIGN_IN_WITH_CUSTOM_CHALLENGE':
            setNeedsVerification(true);
            setVerificationStep(nextStep.signInStep);
            setError('');
            break;
          default:
            console.error('Unexpected sign-in step:', nextStep);
            setError(`Verification required: ${nextStep.signInStep}`);
        }
      }
    } catch (err) {
      console.error('Login error:', err);
      
      switch (err.name) {
        case 'NotAuthorizedException':
          setError('Incorrect username or password');
          break;
        case 'UserNotFoundException':
          setError('User not found');
          break;
        case 'UserNotConfirmedException':
          setError('Please verify your email first');
          setNeedsEmailVerification(true);
          break;
        case 'TooManyRequestsException':
          setError('Too many attempts. Please try again later');
          break;
        default:
          setError(`Login failed: ${err.message || 'Please try again'}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewPasswordSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (!/[a-z]/.test(newPassword)) {
      setError('Password must contain a lowercase letter');
      return;
    }
    if (!/[A-Z]/.test(newPassword)) {
      setError('Password must contain an uppercase letter');
      return;
    }
    if (!/[0-9]/.test(newPassword)) {
      setError('Password must contain a number');
      return;
    }
    if (!/[^A-Za-z0-9]/.test(newPassword)) {
      setError('Password must contain a special character');
      return;
    }

    setIsLoading(true);

    try {
      const { isSignedIn } = await confirmSignIn({
        challengeResponse: newPassword,
      });

      if (isSignedIn) {
        localStorage.setItem('aicam_authenticated', 'true');
        localStorage.setItem('aicam_username', username);
        onLogin();
      }
    } catch (err) {
      console.error('New password error:', err);
      setError(`Failed to set new password: ${err.message || 'Please try again'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerificationSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const { isSignedIn } = await confirmSignIn({
        challengeResponse: verificationCode,
      });

      if (isSignedIn) {
        localStorage.setItem('aicam_authenticated', 'true');
        localStorage.setItem('aicam_username', username);
        onLogin();
      }
    } catch (err) {
      console.error('Verification error:', err);
      setError(`Verification failed: ${err.message || 'Please try again'}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Email verification form (for sign up)
  if (needsEmailVerification) {
    return (
      <div className={`login-page ${isDarkMode ? 'dark-mode' : ''}`}>
        <div className="login-container">
          <div className="login-card">
            <div className="login-header">
              <h1 className="login-logo">SafeVision</h1>
              <p className="login-tagline">Verify your email</p>
            </div>

            <form onSubmit={handleEmailVerificationSubmit} className="login-form">
              <div className="input-group">
                <label htmlFor="code">Verification Code</label>
                <input
                  id="code"
                  type="text"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                  placeholder="Enter verification code from email"
                  className="login-input"
                  required
                />
              </div>

              {error && <div className="login-error">{error}</div>}
              {success && <div className="login-success">{success}</div>}

              <button 
                type="submit" 
                className="login-btn"
                disabled={isLoading}
              >
                {isLoading ? 'Verifying...' : 'Verify Email'}
              </button>

              <button
                type="button"
                onClick={handleResendCode}
                className="login-btn"
                style={{ background: '#888', marginTop: '8px' }}
                disabled={isLoading}
              >
                Resend Code
              </button>

              <button
                type="button"
                onClick={() => {
                  setNeedsEmailVerification(false);
                  setVerificationCode('');
                  setError('');
                  setSuccess('');
                }}
                className="login-btn"
                style={{ background: '#666', marginTop: '8px' }}
              >
                Back
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // New password form
  if (needsNewPassword) {
    return (
      <div className={`login-page ${isDarkMode ? 'dark-mode' : ''}`}>
        <div className="login-container">
          <div className="login-card">
            <div className="login-header">
              <h1 className="login-logo">SafeVision</h1>
              <p className="login-tagline">Set your new password</p>
            </div>

            <form onSubmit={handleNewPasswordSubmit} className="login-form">
              <div className="input-group">
                <label htmlFor="newPassword">New Password</label>
                <input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="login-input"
                  autoComplete="new-password"
                  required
                />
              </div>

              <div className="input-group">
                <label htmlFor="confirmPassword">Confirm Password</label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className="login-input"
                  autoComplete="new-password"
                  required
                />
              </div>

              <div style={{ fontSize: '12px', color: '#666', marginTop: '-8px' }}>
                Password must be at least 8 characters with uppercase, lowercase, number, and special character.
              </div>

              {error && <div className="login-error">{error}</div>}

              <button 
                type="submit" 
                className="login-btn"
                disabled={isLoading}
              >
                {isLoading ? 'Setting Password...' : 'Set Password'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setNeedsNewPassword(false);
                  setNewPassword('');
                  setConfirmPassword('');
                  setError('');
                }}
                className="login-btn"
                style={{ background: '#666', marginTop: '8px' }}
              >
                Back to Login
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Verification code form
  if (needsVerification) {
    return (
      <div className={`login-page ${isDarkMode ? 'dark-mode' : ''}`}>
        <div className="login-container">
          <div className="login-card">
            <div className="login-header">
              <h1 className="login-logo">SafeVision</h1>
              <p className="login-tagline">Enter verification code</p>
            </div>

            <form onSubmit={handleVerificationSubmit} className="login-form">
              <div className="input-group">
                <label htmlFor="code">Verification Code</label>
                <input
                  id="code"
                  type="text"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                  placeholder="Enter verification code"
                  className="login-input"
                  required
                />
              </div>

              {error && <div className="login-error">{error}</div>}

              <button 
                type="submit" 
                className="login-btn"
                disabled={isLoading}
              >
                {isLoading ? 'Verifying...' : 'Verify'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setNeedsVerification(false);
                  setVerificationCode('');
                  setError('');
                }}
                className="login-btn"
                style={{ background: '#666', marginTop: '8px' }}
              >
                Back to Login
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Sign up form
  if (isSignUpMode) {
    return (
      <div className={`login-page ${isDarkMode ? 'dark-mode' : ''}`}>
        <div className="login-container">
          <div className="login-card">
            <div className="login-header">
              <h1 className="login-logo">SafeVision</h1>
              <p className="login-tagline">Create your account</p>
            </div>

            <form onSubmit={handleSignUpSubmit} className="login-form">
              <div className="input-group">
                <label htmlFor="username">Username</label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Choose a username"
                  className="login-input"
                  autoComplete="username"
                  required
                />
              </div>

              <div className="input-group">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="login-input"
                  autoComplete="email"
                  required
                />
              </div>

              <div className="input-group">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a password"
                  className="login-input"
                  autoComplete="new-password"
                  required
                />
              </div>

              <div className="input-group">
                <label htmlFor="confirmPassword">Confirm Password</label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your password"
                  className="login-input"
                  autoComplete="new-password"
                  required
                />
              </div>

              <div style={{ fontSize: '12px', color: '#666', marginTop: '-8px' }}>
                Password must be at least 8 characters with uppercase, lowercase, number, and special character.
              </div>

              {error && <div className="login-error">{error}</div>}
              {success && <div className="login-success">{success}</div>}

              <button 
                type="submit" 
                className="login-btn"
                disabled={isLoading}
              >
                {isLoading ? 'Creating Account...' : 'Sign Up'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsSignUpMode(false);
                  setUsername('');
                  setEmail('');
                  setPassword('');
                  setConfirmPassword('');
                  setError('');
                  setSuccess('');
                }}
                className="login-btn"
                style={{ background: '#666', marginTop: '8px' }}
              >
                Back to Login
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Login form
  return (
    <div className={`login-page ${isDarkMode ? 'dark-mode' : ''}`}>
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <h1 className="login-logo">SafeVision</h1>
            <p className="login-tagline">Peace of mind delivered in real time</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form">
            <div className="input-group">
              <label htmlFor="username">Username or Email</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username or email"
                className="login-input"
                autoComplete="username"
                required
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
                required
              />
            </div>

            {error && <div className="login-error">{error}</div>}
            {success && <div className="login-success">{success}</div>}

            <button 
              type="submit" 
              className="login-btn"
              disabled={isLoading}
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>

            <button
              type="button"
              onClick={() => setIsSignUpMode(true)}
              className="login-btn"
              style={{ background: '#888', marginTop: '8px' }}
            >
              Create Account
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