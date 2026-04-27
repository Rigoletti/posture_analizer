import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const execAsync = promisify(exec);

// Доступные русские голоса Silero (качество отличное)
export const SILERO_VOICES = {
  xenia: 'xenia',           // Женский, самый естественный (рекомендую)
  aidar: 'aidar',           // Мужской, спокойный
  baya: 'baya',             // Женский, энергичный
  kseniya: 'kseniya',       // Женский, взрослый голос
  random: 'random'          // Случайный голос
};

export class SileroTTSService {
  constructor() {
    this.tempDir = join(process.cwd(), 'temp');
    this.isInitialized = false;
    
    // Создаем временную директорию
    if (!existsSync(this.tempDir)) {
      mkdirSync(this.tempDir, { recursive: true });
    }
    
    // Инициализируем Python окружение
    this.initPython();
  }

  async initPython() {
    try {
      // Проверяем наличие Python
      await execAsync('python --version');
      
      // Проверяем наличие необходимых модулей
      const checkCmd = 'python -c "import torch, torchaudio; print(1)"';
      const { stdout } = await execAsync(checkCmd);
      
      if (stdout.trim() === '1') {
        this.isInitialized = true;
        console.log('✅ Silero TTS initialized successfully');
        
        // Предзагрузка модели (первый раз займет время)
        await this.preloadModel();
      } else {
        console.error('❌ PyTorch or torchaudio not installed');
      }
    } catch (error) {
      console.error('❌ Silero TTS init error:', error.message);
      console.log('💡 Run: pip install torch torchaudio silero-tts');
    }
  }

  async preloadModel() {
    const preloadScript = `
import torch
import torchaudio
# Preload model
model, _ = torch.hub.load(repo_or_dir='snakers4/silero-models',
                          model='silero_tts',
                          language='ru',
                          speaker='v3_1_ru')
model.to('cpu')
print("MODEL_LOADED")
    `;
    
    const scriptPath = join(this.tempDir, `preload_${randomUUID()}.py`);
    
    try {
      writeFileSync(scriptPath, preloadScript);
      await execAsync(`python "${scriptPath}"`);
      console.log('✅ Silero model preloaded');
    } catch (error) {
      console.warn('⚠️ Model preload warning:', error.message);
    } finally {
      try { unlinkSync(scriptPath); } catch(e) {}
    }
  }

  async synthesize(text, voice = SILERO_VOICES.xenia) {
    if (!this.isInitialized) {
      console.log('⏳ Waiting for Silero initialization...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (!this.isInitialized) {
        return { success: false, error: 'Silero not initialized' };
      }
    }

    const fileName = `${randomUUID()}.wav`;
    const filePath = join(this.tempDir, fileName);
    const scriptPath = join(this.tempDir, `script_${randomUUID()}.py`);

    // Экранируем текст для Python
    const escapedText = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');

    // Python скрипт для генерации речи
    const pythonScript = `# -*- coding: utf-8 -*-
import sys
import torch
import torchaudio

try:
    # Загрузка модели
    model, _ = torch.hub.load(repo_or_dir='snakers4/silero-models',
                              model='silero_tts',
                              language='ru',
                              speaker='v3_1_ru')
    model.to('cpu')
    
    # Генерация речи
    text = """${escapedText}"""
    speaker = '${voice}'
    
    audio = model.apply_tts(text=text,
                            speaker=speaker,
                            sample_rate=48000)
    
    # Сохранение
    torchaudio.save('${filePath}', audio.unsqueeze(0), 48000)
    print("SUCCESS")
    
except Exception as e:
    print(f"ERROR: {str(e)}")
    sys.exit(1)
`;

    try {
      // Записываем скрипт
      writeFileSync(scriptPath, pythonScript, 'utf8');
      
      // Запускаем Python
      const { stdout, stderr } = await execAsync(`python "${scriptPath}"`, {
        timeout: 30000,
        maxBuffer: 50 * 1024 * 1024
      });
      
      if (stdout.includes('SUCCESS')) {
        // Читаем сгенерированный аудиофайл
        const audioBuffer = readFileSync(filePath);
        const base64Audio = audioBuffer.toString('base64');
        
        // Очистка
        try {
          unlinkSync(scriptPath);
          unlinkSync(filePath);
        } catch(e) {}
        
        return {
          success: true,
          audioData: base64Audio,
          text: text,
          voice: voice,
          format: 'wav'
        };
      } else {
        throw new Error(stderr || 'Generation failed');
      }
      
    } catch (error) {
      console.error('Silero TTS error:', error.message);
      
      // Очистка
      try {
        if (existsSync(scriptPath)) unlinkSync(scriptPath);
        if (existsSync(filePath)) unlinkSync(filePath);
      } catch(e) {}
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Альтернативный метод через API (если Python не работает)
  async synthesizeViaApi(text, voice = 'xenia') {
    try {
      // Используем бесплатный Silero API как fallback
      const response = await fetch('https://silero-tts.vercel.app/api/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice, language: 'ru' })
      });
      
      const audioBuffer = await response.arrayBuffer();
      const base64Audio = Buffer.from(audioBuffer).toString('base64');
      
      return {
        success: true,
        audioData: base64Audio,
        text: text
      };
      
    } catch (error) {
      console.error('Silero API error:', error);
      return { success: false, error: error.message };
    }
  }

  // Тестирование
  async test() {
    const testText = 'Привет. Проверка голосового движка.';
    return await this.synthesize(testText, SILERO_VOICES.xenia);
  }
}

export const sileroTTSService = new SileroTTSService();