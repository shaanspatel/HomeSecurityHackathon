import React, { useEffect, useRef, useState } from 'react';

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

  const pushLog = (msg) => {
    setLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 300));
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
      pushLog('Live preview started.');
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
    pushLog('Live preview stopped.');
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
      pushLog('Recording started with mimeType: ' + recorder.mimeType);

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
    pushLog('Recording stopped.');
  }

  async function manualCut() {
    if (!recorderRef.current) return;
    try {
      recorderRef.current.requestData();
      recorderRef.current.stop();
      recorderRef.current.start();
      setCountdown(10);
      pushLog('Manual cut requested.');
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
      pushLog('Saved locally (offline fallback): ' + name);
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
      pushLog('Uploaded 10s clip ✓ ' + JSON.stringify(json));
    } catch (e) {
      pushLog('Upload error, falling back local: ' + e.message);
      performFallback();
    }
  }

  return (
    <div className="min-h-screen w-full flex flex-col items-center gap-4 p-4" style={{ fontFamily: 'Inter, system-ui, Arial, sans-serif' }}>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {!isPreviewing ? (
          <button onClick={startPreview} style={btn('neutral')}>Show Live</button>
        ) : (
          <button onClick={stopPreview} style={btn('danger')} disabled={isRecording}>Hide Live</button>
        )}

        {!isRecording ? (
          <button onClick={startRecording} style={btn('primary')}>Start (10s clips)</button>
        ) : (
          <button onClick={stopRecording} style={btn('danger')}>Stop</button>
        )}

        <button onClick={manualCut} style={btn('info')} disabled={!isRecording}>Cut & Upload Now</button>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input type="checkbox" checked={offlineMode} onChange={(e) => setOfflineMode(e.target.checked)} />
          Offline mode (save locally)
        </label>
      </div>

      <div style={{ fontSize: 14, color: '#555' }}>
        <div>Status: <b>{status}</b>{lastUploadAt ? ` — last upload: ${lastUploadAt.toLocaleTimeString()}` : ''}</div>
        {/*<div>Device ID: <code>{deviceId}</code></div>
        <div>Cookie: <code>{getCookie('aicam_session') || '(not set)'}</code></div>*/}
      </div>

      <div style={{ width: 640 }}>
        <video ref={videoRef} playsInline muted autoPlay style={{ width: '100%', height: 360, background: '#000', borderRadius: 8 }} />
        {/* Countdown bar & label */}
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <div style={{ width: 520, height: 8, background: '#e5e7eb', borderRadius: 9999, overflow: 'hidden' }}>
            <div style={{ width: `${((10 - countdown) / 10) * 100}%`, height: '100%', background: '#16a34a', transition: 'width 0.25s linear' }} />
          </div>
          <div style={{ minWidth: 110, textAlign: 'right' }}>next send: <b>{countdown}s</b></div>
        </div>
      </div>

      {/* Local fallback clips list */}
      {localClips.length > 0 && (
        <section style={{ width: 640 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginTop: 12 }}>Local clips (offline fallback)</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {localClips.map((c, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 8, border: '1px solid #e5e7eb', borderRadius: 8 }}>
                <div style={{ fontSize: 12 }}>
                  <div><b>{c.name}</b></div>
                  <div style={{ color: '#6b7280' }}>{(c.size / (1024 * 1024)).toFixed(2)} MB</div>
                </div>
                <a href={c.url} download={c.name} style={{ ...btn('primary'), textDecoration: 'none', padding: '6px 10px' }}>Download</a>
              </div>
            ))}
          </div>
        </section>
      )}

      <section style={{ width: 640 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginTop: 12 }}>Logs</h3>
        <div style={{ height: 200, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: '#fafafa' }}>
          {log.map((l, i) => (
            <div key={i} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}>{l}</div>
          ))}
        </div>
      </section>

      {/*<footer style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
        This demo uses MediaRecorder (WebM/VP8) and falls back to local downloads if the backend is unavailable.
      </footer>*/}
    </div>
  );
}

function btn(tone) {
  const base = {
    color: 'white', border: 'none', padding: '10px 14px', borderRadius: 10,
    cursor: 'pointer', fontWeight: 600
  };
  if (tone === 'primary') return { ...base, background: '#16a34a' };
  if (tone === 'danger') return { ...base, background: '#b91c1c' };
  if (tone === 'info') return { ...base, background: '#0ea5e9' };
  return { ...base, background: '#6b7280' };
}
