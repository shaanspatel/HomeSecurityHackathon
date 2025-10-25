import express from 'express';
import multer from 'multer';
import { spawn } from 'child_process';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

console.log(`🔧 Starting Express server on port ${PORT}...`);

// Middleware
app.use(cors());
app.use(express.json());

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Upload endpoint that your React app calls
app.post('/api/upload-clip', upload.single('clip'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    const deviceId = req.body.device_id || 'unknown';
    const videoBuffer = req.file.buffer;

    // Call Python script with video data
    const pythonProcess = spawn('python3', [
      path.join(__dirname, '../backend/process_video.py'),
      deviceId
    ], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Send video data to Python process
    pythonProcess.stdin.write(videoBuffer);
    pythonProcess.stdin.end();

    let result = '';
    let error = '';

    pythonProcess.stdout.on('data', (data) => {
      result += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      const stderrData = data.toString();
      error += stderrData;
      console.log(`[PYTHON DEBUG] ${stderrData.trim()}`);
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ Video successfully sent to master.py for device: ${deviceId}`);
        console.log(`📊 Video size: ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);
        console.log(`📋 Python output: ${result}`);
        try {
          const parsedResult = JSON.parse(result);
          res.json({ status: 'success', message: 'Video sent to backend for analysis', result: parsedResult });
        } catch (e) {
          res.json({ status: 'success', message: 'Video sent to backend for analysis', result: result });
        }
      } else {
        console.error('❌ Python process error:', error);
        console.error('📋 Python stderr:', error);
        res.status(500).json({ error: 'Video processing failed', details: error, stderr: error });
      }
    });

    pythonProcess.on('error', (err) => {
      console.error('Failed to start Python process:', err);
      res.status(500).json({ error: 'Failed to start video processing' });
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});


app.get('/api/whoami', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Note: Logs are now served by FastAPI server on port 8000
// This Express server only handles video uploads

app.listen(PORT, () => {
  console.log(`🚀 Express server running on http://localhost:${PORT}`);
  console.log(`📡 Video upload endpoint available at http://localhost:${PORT}/api/upload-clip`);
  console.log(`📋 Logs are served by FastAPI server on http://localhost:8000/api/logs`);
});