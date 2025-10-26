import React, { useEffect, useRef, useState } from 'react';
import { getCurrentUser, signOut } from 'aws-amplify/auth';
import './App.css';
import Login from './Login';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const EXPRESS_API_BASE = import.meta.env.VITE_EXPRESS_API_BASE || 'http://localhost:3000';

function uuid4Like() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 0xf) >>> 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function setCookie(name, value, days = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; Expires=${expires}; Path=/; SameSite=Lax`;
}

function getCookie(name) {
  const m = document.cookie.split('; ').find(row => row.startsWith(name + '='));
  return m ? m.split('=')[1] : undefined;
}

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    checkAuthState();
  }, []);

  async function checkAuthState() {
    try {
      await getCurrentUser();
      setIsLoggedIn(true);
      localStorage.setItem('aicam_authenticated', 'true');
    } catch {
      setIsLoggedIn(false);
      localStorage.removeItem('aicam_authenticated');
      localStorage.removeItem('aicam_username');
    } finally {
      setIsCheckingAuth(false);
    }
  }

  if (isCheckingAuth) {
    return <div className="loading">Loading...</div>;
  }

  if (!isLoggedIn) {
    return <Login onLogin={() => setIsLoggedIn(true)} />;
  }

  return <Dashboard />;
}

function Dashboard() {
  const videoRef = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const cutIntervalRef = useRef(null);
  const secondIntervalRef = useRef(null);
  const chunksRef = useRef([]);

  const [deviceId, setDeviceId] = useState('');
  const [status, setStatus] = useState('idle');
  const [isRecording, setIsRecording] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const [lastUploadAt, setLastUploadAt] = useState(null);
  const [log, setLog] = useState([]);
  const [serverLogs, setServerLogs] = useState([]);
  const [localClips, setLocalClips] = useState([]);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('aicam_dark_mode');
    return saved ? JSON.parse(saved) : false;
  });
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [testVideoFile, setTestVideoFile] = useState(null);

  const pushLog = (msg) => {
    setLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 300));
  };

  const handleTestVideoUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/')) {
      pushLog('Please select a video file');
      return;
    }

    setTestVideoFile(file);
    pushLog(`Test video selected: ${file.name}`);

    // Upload the test video
    await uploadTestVideo(file);
  };

  const uploadTestVideo = async (file) => {
    try {
      const form = new FormData();
      form.append('clip', file, `test-${file.name}`);
      form.append('device_id', deviceId || getCookie('aicam_session') || 'unknown');

      setStatus('uploading');
      pushLog('Uploading test video...');

      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 30_000);
      const res = await fetch(`${EXPRESS_API_BASE}/api/upload-clip`, { 
        method: 'POST', 
        body: form, 
        credentials: 'include', 
        signal: ctrl.signal 
      });
      clearTimeout(timeout);

      if (!res.ok) throw new Error('upload failed: ' + res.status);
      const json = await res.json().catch(() => ({}));
      setStatus('idle');
      pushLog('Test video uploaded successfully! Logs should update shortly.');
    } catch (e) {
      setStatus('error');
      pushLog('Test video upload failed: ' + e.message);
    }
  };

  const toggleDarkMode = () => {
    const newMode = !isDarkMode;
    setIsDarkMode(newMode);
    localStorage.setItem('aicam_dark_mode', JSON.stringify(newMode));
    setIsDropdownOpen(false);
  };

  const toggleDropdown = () => {
    setIsDropdownOpen(!isDropdownOpen);
  };

  const handleLogout = async () => {
    try {
      await signOut();
      localStorage.removeItem('aicam_authenticated');
      localStorage.removeItem('aicam_username');
      setIsDropdownOpen(false);
      window.location.reload();
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // Init device id + cookie
  useEffect(() => {
    let id = localStorage.getItem('aicam_device_id');
    if (!id) { id = uuid4Like(); localStorage.setItem('aicam_device_id', id); }
    setDeviceId(id);
    setCookie('aicam_session', id);

    return () => stopAll();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isDropdownOpen && !event.target.closest('.user-menu')) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDropdownOpen]);

  // Apply dark mode to body
  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
  }, [isDarkMode]);

  // Fetch SecurityEventsLog for stream "general_watch"
  useEffect(() => {
    let stopped = false;

    const fetchLogs = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/logs?stream_id=general_watch`, { credentials: 'include' });
        if (!res.ok) throw new Error('logs fetch failed: ' + res.status);
        const data = await res.json();
        const items = Array.isArray(data.items) ? data.items : [];
        const lines = items.map((it) => {
          const ts = it.timestamp ? new Date(it.timestamp).toLocaleString() : '';
          const sev = (it.severity || 'log').toUpperCase();
          const type = it.threat_type || 'other';
          const summary = it.summary || '';
          return `[${ts}] ${sev} (${type}) ${summary}`;
        });
        if (!stopped) setServerLogs(lines);
      } catch (e) {
        
      }
    };

    fetchLogs();
    const t = setInterval(fetchLogs, 10000); // poll every 10s
    return () => { stopped = true; clearInterval(t); };
  }, []);

  function stopAll() {
    stopRecording();
    stopPreview(true);
    setStatus('idle');
  }

  function startAll() {
    startPreview();
    startRecording();
  }

  async function startPreview() {
    if (isPreviewing) return;
    setStatus('requesting-permission');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsPreviewing(true);
      setStatus('previewing');
      pushLog('Camera is now watching your space!');
    } catch (e) {
      setStatus('error');
      pushLog('getUserMedia failed: ' + e.message);
    }
  }

  function stopPreview(force = false) {
    if (isRecording && !force) return;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    if (secondIntervalRef.current) { clearInterval(secondIntervalRef.current); secondIntervalRef.current = null; }
    setIsPreviewing(false);
    pushLog('Camera is taking a break');
  }

  async function startRecording() {
    if (isRecording) return;
    if (!isPreviewing) await startPreview();

    try {
      const mimeCandidates = [
        'video/mp4;codecs=avc1.42E01E',
        'video/mp4',
        'video/webm;codecs=vp8',
        'video/webm',
      ];
      let recorder = null;
      for (const mt of mimeCandidates) {
        if (MediaRecorder.isTypeSupported(mt)) {
          recorder = new MediaRecorder(streamRef.current, { mimeType: mt, videoBitsPerSecond: 2500_000 });
          break;
        }
      }
      if (!recorder) {
        pushLog('No supported MediaRecorder mimeType found.');
        setStatus('error');
        return;
      }

      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        chunksRef.current = [];
        if (blob.size > 0) {
          await uploadClipWithFallback(blob, recorder.mimeType);
        }
      };

      recorder.start();
      recorderRef.current = recorder;
      setIsRecording(true);
      setStatus('recording');
      pushLog('Protection mode activated! Recording everything safely');

      setCountdown(10);
      if (secondIntervalRef.current) clearInterval(secondIntervalRef.current);
      secondIntervalRef.current = setInterval(() => {
        setCountdown(prev => (prev > 1 ? prev - 1 : 10));
      }, 1000);

      if (cutIntervalRef.current) clearInterval(cutIntervalRef.current);
      cutIntervalRef.current = setInterval(() => {
        setCountdown(10);
        try {
          recorderRef.current.requestData();
          recorderRef.current.stop();
          recorderRef.current.start();
        } catch (e) {
          pushLog('Cut error: ' + e.message);
        }
      }, 10_000);
    } catch (e) {
      setStatus('error');
      pushLog('startRecording error: ' + e.message);
    }
  }

  function stopRecording() {
    if (!isRecording) return;
    if (cutIntervalRef.current) { clearInterval(cutIntervalRef.current); cutIntervalRef.current = null; }
    if (secondIntervalRef.current) { clearInterval(secondIntervalRef.current); secondIntervalRef.current = null; }
    if (recorderRef.current) {
      try { if (recorderRef.current.state !== 'inactive') recorderRef.current.stop(); } catch {}
      recorderRef.current = null;
    }
    setIsRecording(false);
    pushLog('Protection mode stopped - your space is safe');
  }

  async function manualCut() {
    if (!recorderRef.current) return;
    try {
      recorderRef.current.requestData();
      recorderRef.current.stop();
      recorderRef.current.start();
      setCountdown(10);
      pushLog('Quick snapshot captured!');
    } catch (e) {
      pushLog('Manual cut failed: ' + e.message);
    }
  }

  async function uploadClipWithFallback(blob, mimeType) {
    setStatus('uploading');

    const performFallback = () => {
      const url = URL.createObjectURL(blob);
      const name = `clip-${Date.now()}.mp4`;
      setLocalClips(prev => [{ url, name, size: blob.size }, ...prev].slice(0, 50));
      setStatus('recording');
      pushLog('Saved locally for you: ' + name);
    };

    try {
      const form = new FormData();
      form.append('clip', blob, `clip-${Date.now()}.mp4`);
      form.append('device_id', deviceId || getCookie('aicam_session') || 'unknown');

      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 12_000);
      const res = await fetch(`${EXPRESS_API_BASE}/api/upload-clip`, { method: 'POST', body: form, credentials: 'include', signal: ctrl.signal });
      clearTimeout(timeout);

      if (!res.ok) throw new Error('upload failed: ' + res.status);
      const json = await res.json().catch(() => ({}));
      setLastUploadAt(new Date());
      setStatus('recording');
      pushLog('Successfully shared update with the system!');
    } catch (e) {
      pushLog('Upload error, falling back local: ' + e.message);
      performFallback();
    }
  }

  const getStatusInfo = () => {
    switch (status) {
      case 'idle':
        return { 
          type: 'idle', 
          title: 'Welcome Home!', 
        };
      case 'previewing':
        return { 
          type: 'safe', 
          title: 'Everything Looks Great!', 
        };
      case 'recording':
        return { 
          type: 'warning', 
          title: 'Keeping Watch', 
        };
      case 'uploading':
        return { 
          type: 'warning', 
          title: 'Sending Updates', 
        };
      case 'error':
        return { 
          type: 'danger', 
          title: 'Oops! Something\'s Up', 
        };
      default:
        return { 
          type: 'idle', 
          title: 'Welcome Home!', 
        };
    }
  };

  const statusInfo = getStatusInfo();

  return (
    <div className={`app ${isDarkMode ? 'dark-mode' : ''}`}>
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <a href="/" className="logo">SafeVision</a>
          <div className="user-menu">
            <button className="avatar" onClick={toggleDropdown} title="User menu">
              {localStorage.getItem('aicam_username')?.charAt(0).toUpperCase() || 'U'}
            </button>
            {isDropdownOpen && (
              <div className="dropdown-menu">
                <button className="dropdown-item" onClick={toggleDarkMode}>
                  <span className="dropdown-text">{isDarkMode ? 'Light' : 'Dark'}</span>
                </button>
                <button className="dropdown-item" onClick={handleLogout}>
                  <span className="dropdown-text">Logout</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Dashboard */}
      <main className="dashboard">
        {/* Status Card */}
        <div className="status-card">
          {status !== 'idle' && (
            <div className={`status-indicator ${statusInfo.type}`}>
              {statusInfo.icon}
            </div>
          )}
          <h1 className="status-title">{statusInfo.title}</h1>
          {statusInfo.subtitle && (
            <p className="status-subtitle">{statusInfo.subtitle}</p>
          )}
          
          {/* Control Buttons */}
          <div className="controls">
            {!isRecording ? (
              <button onClick={startAll} className="btn-success"> Start Protecting</button>
            ) : (
              <button onClick={stopAll} className="btn-danger"> Stop</button>
            )}

            <button onClick={manualCut} className="btn-warning" disabled={!isRecording}>Stop recording & Upload</button>
            
            {/* Test Video Upload */}
            <label className="btn-primary" style={{ cursor: 'pointer' }}>
              Upload Test Video
              <input 
                type="file" 
                accept="video/*" 
                onChange={handleTestVideoUpload}
                style={{ display: 'none' }}
              />
            </label>
          </div>
        </div>

        {/* Video Container */}
        {isPreviewing && (
          <div className="video-container">
            <video 
              ref={videoRef} 
              playsInline 
              muted 
              autoPlay 
              className="video"
            />
            {/* Progress Bar */}
            <div className="progress-container">
              <div className="progress-bar">
                <div 
                  className="progress-fill" 
                  style={{ width: `${((10 - countdown) / 10) * 100}%` }}
                />
              </div>
              <div className="progress-text">
                Next update in: <strong>{countdown}s</strong>
              </div>
            </div>
          </div>
        )}

        {/* History Log */}
        <div className="history-section">
          <h3 className="history-title">What's Been Happening</h3>
          <div className="history-log">
            {[...serverLogs, ...log].map((entry, i) => (
              <div key={i} className="history-item">{entry}</div>
            ))}
          </div>
        </div>
        
        {/* Local Clips */}
        {localClips.length > 0 && (
        <div className="local-clips">
          <h3 className="history-title">Your Saved Memories</h3>
            {localClips.map((clip, i) => (
              <div key={i} className="clip-item">
                <div className="clip-info">
                  <div className="clip-name">{clip.name}</div>
                  <div className="clip-size">{(clip.size / (1024 * 1024)).toFixed(2)} MB</div>
                </div>
                <a 
                  href={clip.url} 
                  download={clip.name} 
                  className="btn-primary"
                  style={{ textDecoration: 'none', padding: '8px 16px' }}
                >
                  Download
                </a>
              </div>
            ))}
        </div>
        )}

        {/* Footer */}
        <div className="footer">
          Your home is being watched over – updates every 10 seconds
        </div>
      </main>
    </div>
  );
}