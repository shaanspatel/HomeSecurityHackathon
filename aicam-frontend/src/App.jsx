import React, { useEffect, useRef, useState } from 'react';
import './App.css';


const API_BASE = import.meta.env.VITE_API_BASE || '';

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
  const videoRef = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const cutIntervalRef = useRef(null);
  const secondIntervalRef = useRef(null);
  const chunksRef = useRef([]);

  const [deviceId, setDeviceId] = useState('');
  const [status, setStatus] = useState('idle'); // idle | previewing | recording | uploading | error
  const [isRecording, setIsRecording] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const [lastUploadAt, setLastUploadAt] = useState(null);
  const [log, setLog] = useState([]);
  const [offlineMode, setOfflineMode] = useState(false);
  const [localClips, setLocalClips] = useState([]); // {url, name, size}
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('aicam_dark_mode');
    return saved ? JSON.parse(saved) : false;
  });
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const pushLog = (msg) => {
    setLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 300));
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

  // Init device id + cookie
  useEffect(() => {
    let id = localStorage.getItem('aicam_device_id');
    if (!id) { id = uuid4Like(); localStorage.setItem('aicam_device_id', id); }
    setDeviceId(id);
    setCookie('aicam_session', id);

    //mark offline if whoami fails
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/whoami`, { credentials: 'include' });
        if (!res.ok) throw new Error('not ok');
        const data = await res.json();
        pushLog('whoami: ' + JSON.stringify(data));
        setOfflineMode(false);
      } catch (e) {
        pushLog('Backend not detected — offline fallback enabled');
        setOfflineMode(true);
      }
    })();

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

  function stopAll() {
    stopRecording();
    stopPreview();
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

  function stopPreview() {
    if (isRecording) return; // keep stream during recording
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    if (secondIntervalRef.current) { clearInterval(secondIntervalRef.current); secondIntervalRef.current = null; }
    setIsPreviewing(false);
    if (!isRecording) setStatus('idle');
    pushLog('Camera is taking a break');
  }

  async function startRecording() {
    if (isRecording) return;
    if (!isPreviewing) await startPreview(); // ensure stream exists

    try {
      // Choose a supported mime
      const mimeCandidates = [
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4;codecs=avc1.42E01E', // may not be supported in all browsers
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

      // Seconds countdown (UI only)
      setCountdown(10);
      if (secondIntervalRef.current) clearInterval(secondIntervalRef.current);
      secondIntervalRef.current = setInterval(() => {
        setCountdown(prev => (prev > 1 ? prev - 1 : 10));
      }, 1000);

      // Every 10 seconds, make a cut and restart recorder
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
    setStatus(isPreviewing ? 'previewing' : 'idle');
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

    // If user forced offline or API call fails → fallback to local link
    const performFallback = () => {
      const url = URL.createObjectURL(blob);
      const name = `clip-${Date.now()}.${mimeType.includes('webm') ? 'webm' : 'mp4'}`;
      setLocalClips(prev => [{ url, name, size: blob.size }, ...prev].slice(0, 50));
      setStatus('recording');
      pushLog('Saved locally for you: ' + name);
    };

    if (offlineMode) { performFallback(); return; }

    try {
      const form = new FormData();
      form.append('clip', blob, `clip-${Date.now()}.${mimeType.includes('webm') ? 'webm' : 'mp4'}`);
      form.append('device_id', deviceId || getCookie('aicam_session') || 'unknown');

      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 12_000); // 12s safety timeout
      const res = await fetch(`${API_BASE}/api/upload-clip`, { method: 'POST', body: form, credentials: 'include', signal: ctrl.signal });
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

  // Status mapping for UI
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
          title: 'Everything Looks Great! ✨', 
          subtitle: 'Your camera is watching over your space',
        };
      case 'recording':
        return { 
          type: 'warning', 
          title: 'Keeping Watch', 
          subtitle: 'Recording and analyzing everything for your safety',
        };
      case 'uploading':
        return { 
          type: 'warning', 
          title: 'Sending Updates', 
          subtitle: 'Sharing what I see with the system',
        };
      case 'error':
        return { 
          type: 'danger', 
          title: 'Oops! Something\'s Up', 
          subtitle: 'Let me help you fix this camera issue',
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
              U
            </button>
            {isDropdownOpen && (
              <div className="dropdown-menu">
                <button className="dropdown-item" onClick={toggleDarkMode}>
                  <span className="dropdown-icon">{isDarkMode ? '☀️' : '🌙'}</span>
                  <span className="dropdown-text">{isDarkMode ? 'Light Mode' : 'Dark Mode'}</span>
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
            {!isPreviewing ? (
              <button onClick={startPreview} className="btn-primary">Live View</button>
            ) : (
              <button onClick={stopPreview} className="btn-danger" disabled={isRecording}>Stop</button>
            )}

            {!isRecording ? (
              <button onClick={startRecording} className="btn-success"> Start Protecting</button>
            ) : (
              <button onClick={stopRecording} className="btn-danger"> Stop</button>
            )}

            <button onClick={manualCut} className="btn-warning" disabled={!isRecording}>Start recording & Upload</button>
          </div>

          {/* Offline Mode Toggle */}
          <div style={{ marginTop: '20px' }}>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', fontSize: '14px', color: 'var(--text-secondary)', fontWeight: '500' }}>
              <input 
                type="checkbox" 
                checked={offlineMode} 
                onChange={(e) => setOfflineMode(e.target.checked)}
                style={{ accentColor: 'var(--primary-blue)', transform: 'scale(1.2)' }}
              />
              Offline mode
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

        {/* History Log */}
        <div className="history-section">
          <h3 className="history-title">What's Been Happening</h3>
          <div className="history-log">
            {log.map((entry, i) => (
              <div key={i} className="history-item">{entry}</div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="footer">
          Your home is being watched over – updates every 10 seconds
        </div>
      </main>
    </div>
  );
}