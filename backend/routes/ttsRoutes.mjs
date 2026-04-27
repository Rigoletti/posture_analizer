import express from 'express';
import axios from 'axios';
import { protect } from '../middleware/auth.mjs';

const router = express.Router();

router.use(protect);

// Python TTS сервер работает на порту 5001
const TTS_SERVER_URL = 'http://localhost:5001/synthesize';

router.post('/synthesize', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Text is required' });
    }

    console.log(`🎤 TTS request: "${text.substring(0, 50)}..."`);

    try {
      // Запрос к Python TTS серверу
      const response = await axios.post(TTS_SERVER_URL, {
        text: text,
        voice: 'xenia'
      }, {
        timeout: 10000
      });
      
      if (response.data && response.data.success) {
        return res.json({
          success: true,
          audioData: response.data.audioData,
          text: text
        });
      } else {
        throw new Error('TTS server error');
      }
    } catch (err) {
      console.error('Python TTS server not running, starting it...');
      
      // Запускаем Python сервер если не запущен
      const { spawn } = await import('child_process');
      const pythonProcess = spawn('python', ['tts_server.py'], {
        cwd: process.cwd(),
        detached: true,
        stdio: 'ignore'
      });
      pythonProcess.unref();
      
      // Ждем запуска и пробуем снова
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const retryResponse = await axios.post(TTS_SERVER_URL, {
        text: text,
        voice: 'xenia'
      }, { timeout: 10000 });
      
      if (retryResponse.data && retryResponse.data.success) {
        return res.json({
          success: true,
          audioData: retryResponse.data.audioData,
          text: text
        });
      }
      
      throw new Error('TTS service unavailable');
    }
    
  } catch (error) {
    console.error('TTS error:', error.message);
    res.json({ 
      success: false, 
      error: 'TTS service unavailable',
      useFallback: true,
      text: req.body?.text
    });
  }
});

router.get('/test', (req, res) => {
  res.json({ success: true, message: 'TTS route working' });
});

export default router;