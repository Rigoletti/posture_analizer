// frontend/hooks/useVoiceAssistant.ts
import { useState, useCallback, useEffect, useRef } from 'react';

export type VoiceCommand = 
  | 'check_posture'
  | 'start_analysis'
  | 'stop_analysis'
  | 'show_stats'
  | 'calibrate'
  | 'reset_calibration'
  | 'set_reminder'
  | 'recommend_exercises'
  | 'help'
  | 'turn_off';

interface UseVoiceAssistantProps {
  onCommand: (command: VoiceCommand, details?: string) => void;
  onPostureAlert?: (message: string) => void;
  isSessionActive: boolean;
  isCalibrated: boolean;
  sessionId?: string | null;
}

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export const useVoiceAssistant = ({
  onCommand,
  onPostureAlert,
  isSessionActive,
  isCalibrated,
  sessionId
}: UseVoiceAssistantProps) => {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const shouldKeepListeningRef = useRef<boolean>(true);
  const isProcessingRef = useRef<boolean>(false);
  const lastCommandTimeRef = useRef<number>(0);
  const processingTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const isCalibratedRef = useRef<boolean>(isCalibrated);
  const isSessionActiveRef = useRef<boolean>(isSessionActive);
  const onCommandRef = useRef(onCommand);
  const onPostureAlertRef = useRef(onPostureAlert);

  useEffect(() => {
    isCalibratedRef.current = isCalibrated;
  }, [isCalibrated]);

  useEffect(() => {
    isSessionActiveRef.current = isSessionActive;
  }, [isSessionActive]);

  useEffect(() => {
    onCommandRef.current = onCommand;
  }, [onCommand]);

  useEffect(() => {
    onPostureAlertRef.current = onPostureAlert;
  }, [onPostureAlert]);

  // Инициализация аудио
  useEffect(() => {
    audioRef.current = new Audio();
    audioRef.current.onplay = () => setIsSpeaking(true);
    audioRef.current.onended = () => setIsSpeaking(false);
    audioRef.current.onerror = () => setIsSpeaking(false);
    
    return () => {
      if (processingTimerRef.current) clearTimeout(processingTimerRef.current);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch(e) {}
      }
    };
  }, []);

  const speak = useCallback(async (text: string) => {
    if (!text) return;
    
    try {
      const response = await fetch('/api/tts/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      
      const data = await response.json();
      
      if (data.success && data.audioData) {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.src = '';
        }
        
        audioRef.current!.src = `data:audio/mpeg;base64,${data.audioData}`;
        await audioRef.current!.play();
      }
    } catch (error) {
      console.error('TTS error:', error);
    }
  }, []);

  const speakShort = useCallback((text: string) => {
    speak(text);
  }, [speak]);

  const speakPostureAlert = useCallback((alertType: 'shoulders' | 'head' | 'hips') => {
    if (!isSessionActiveRef.current) return;
    const shortAlerts = {
      shoulders: 'Плечи!',
      head: 'Голова!',
      hips: 'Выпрямись!'
    };
    speakShort(shortAlerts[alertType]);
    if (onPostureAlertRef.current) {
      onPostureAlertRef.current(shortAlerts[alertType]);
    }
  }, [speakShort]);

  const stopListening = useCallback(() => {
    shouldKeepListeningRef.current = false;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch(e) {}
      recognitionRef.current = null;
    }
    setIsListening(false);
    setIsProcessing(false);
    if (processingTimerRef.current) clearTimeout(processingTimerRef.current);
  }, []);

  const executeCommand = useCallback((command: VoiceCommand, details?: string) => {
    const now = Date.now();
    if (now - lastCommandTimeRef.current < 1500) {
      return;
    }
    lastCommandTimeRef.current = now;
    onCommandRef.current(command, details);
  }, []);

  const processCommand = useCallback((cmd: string) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    setIsProcessing(true);
    
    if (processingTimerRef.current) clearTimeout(processingTimerRef.current);
    processingTimerRef.current = setTimeout(() => {
      isProcessingRef.current = false;
      setIsProcessing(false);
    }, 1000);
    
    // Короткие ответы для скорости
    if (cmd.includes('калибр')) {
      speakShort('Ок');
      executeCommand('calibrate');
    }
    else if (cmd.includes('осанк') || cmd.includes('поза')) {
      speakShort('Проверяю');
      executeCommand('check_posture');
    }
    else if (cmd.includes('начать') || cmd.includes('старт')) {
      if (isCalibratedRef.current) {
        speakShort('Старт');
        executeCommand('start_analysis');
      } else {
        speakShort('Сначала калибровка');
      }
    }
    else if (cmd.includes('стоп') || cmd.includes('закончи')) {
      speakShort('Стоп');
      executeCommand('stop_analysis');
    }
    else if (cmd.includes('статистик')) {
      speakShort('Статистика');
      executeCommand('show_stats');
    }
    else if (cmd.includes('сброс')) {
      speakShort('Сброс');
      executeCommand('reset_calibration');
    }
    else if (cmd.includes('выключи') || cmd.includes('отключи')) {
      speakShort('До свидания');
      executeCommand('turn_off');
      setTimeout(() => stopListening(), 300);
    }
    else if (cmd.includes('напомни')) {
      const match = cmd.match(/(\d+)/);
      if (match) {
        speakShort(`Напомню через ${match[1]}`);
        executeCommand('set_reminder', match[1]);
      } else {
        speakShort('Время?');
      }
    }
    else if (cmd.includes('упражн')) {
      speakShort('Упражнения');
      executeCommand('recommend_exercises');
    }
    else if (cmd.includes('помощь')) {
      speakShort('Осанка, старт, стоп, статистика, калибровка, сброс, напомни, упражнения');
    }
    else {
      isProcessingRef.current = false;
      setIsProcessing(false);
    }
  }, [executeCommand, speakShort, stopListening]);

  const startListening = useCallback(() => {
    if (isListening) return;
    
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      speakShort('Микрофон не поддерживается');
      return;
    }
    
    shouldKeepListeningRef.current = true;
    
    const recognition = new SpeechRecognitionAPI();
    recognition.lang = 'ru-RU';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    
    let lastProcessedText = '';
    let processTimeout: NodeJS.Timeout | null = null;
    
    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
    };
    
    recognition.onresult = (event: any) => {
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText = event.results[i][0].transcript.toLowerCase();
        }
      }
      
      if (finalText && finalText !== lastProcessedText) {
        lastProcessedText = finalText;
        
        if (processTimeout) clearTimeout(processTimeout);
        processTimeout = setTimeout(() => {
          const cleanText = finalText.replace(/алиса|сэр|помощник|робот/gi, '').trim();
          if (cleanText.length > 0) {
            processCommand(cleanText);
          }
          lastProcessedText = '';
        }, 200);
      }
    };
    
    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') return;
      if (event.error === 'not-allowed') {
        setError('Нет доступа к микрофону');
        shouldKeepListeningRef.current = false;
      }
    };
    
    recognition.onend = () => {
      if (shouldKeepListeningRef.current) {
        setTimeout(() => {
          if (shouldKeepListeningRef.current && recognitionRef.current) {
            try { recognitionRef.current.start(); } catch(e) {}
          }
        }, 100);
      } else {
        setIsListening(false);
      }
    };
    
    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      console.error('Start error:', err);
    }
  }, [isListening, processCommand, speakShort]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
      speakShort('Пока');
    } else {
      startListening();
      speakShort('Слушаю');
    }
  }, [isListening, startListening, stopListening, speakShort]);

  const setReminder = useCallback((minutes: number, message: string) => {
    setTimeout(() => speakShort(`Напоминание: ${message}`), minutes * 60 * 1000);
  }, [speakShort]);

  const announcePostureIssue = useCallback((issues: string[]) => {
    if (!isSessionActiveRef.current) return;
    if (issues.includes('Плечи')) speakPostureAlert('shoulders');
    else if (issues.includes('Голова')) speakPostureAlert('head');
  }, [speakPostureAlert]);

  return {
    isListening,
    isSpeaking,
    isProcessing,
    error,
    lastCommand: null,
    reminderTime: null,
    startListening,
    stopListening,
    toggleListening,
    speak: speakShort,
    setReminder,
    announcePostureIssue,
    speakPostureAlert,
  };
};