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
  | 'turn_off'
  | 'go_to_analysis'
  | 'go_to_exercises'
  | 'go_to_sessions'
  | 'go_to_reviews'
  | 'go_to_profile';

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
    
    const lowerCmd = cmd.toLowerCase();
    
    // НАВИГАЦИОННЫЕ КОМАНДЫ (работают всегда)
    if (lowerCmd.includes('перейти') || lowerCmd.includes('открыть') || lowerCmd.includes('покажи')) {
      if (lowerCmd.includes('анализ') || lowerCmd.includes('главная') || lowerCmd.includes('осанку')) {
        speakShort('Перехожу на страницу анализа');
        executeCommand('go_to_analysis');
        return;
      }
      else if (lowerCmd.includes('упражнени')) {
        speakShort('Перехожу к упражнениям');
        executeCommand('go_to_exercises');
        return;
      }
      else if (lowerCmd.includes('статистик') || lowerCmd.includes('сеанс') || lowerCmd.includes('история')) {
        speakShort('Перехожу к статистике');
        executeCommand('go_to_sessions');
        return;
      }
      else if (lowerCmd.includes('отзыв')) {
        speakShort('Перехожу к отзывам');
        executeCommand('go_to_reviews');
        return;
      }
      else if (lowerCmd.includes('профиль') || lowerCmd.includes('настройк')) {
        speakShort('Перехожу в профиль');
        executeCommand('go_to_profile');
        return;
      }
    }
    
    // ПРЯМЫЕ КОМАНДЫ ДЛЯ НАВИГАЦИИ
    if (lowerCmd === 'анализ' || lowerCmd === 'осанка' || lowerCmd === 'главная') {
      speakShort('Перехожу на страницу анализа');
      executeCommand('go_to_analysis');
      return;
    }
    else if (lowerCmd === 'упражнения') {
      speakShort('Перехожу к упражнениям');
      executeCommand('go_to_exercises');
      return;
    }
    else if (lowerCmd === 'статистика' || lowerCmd === 'сеансы' || lowerCmd === 'история') {
      speakShort('Перехожу к статистике');
      executeCommand('go_to_sessions');
      return;
    }
    else if (lowerCmd === 'отзывы') {
      speakShort('Перехожу к отзывам');
      executeCommand('go_to_reviews');
      return;
    }
    else if (lowerCmd === 'профиль' || lowerCmd === 'настройки') {
      speakShort('Перехожу в профиль');
      executeCommand('go_to_profile');
      return;
    }
    
    // КОМАНДЫ ДЛЯ АНАЛИЗА ОСАНКИ
    if (lowerCmd.includes('калибр')) {
      speakShort('Запускаю калибровку');
      executeCommand('calibrate');
    }
    else if (lowerCmd.includes('осанк') || lowerCmd.includes('поза') || lowerCmd.includes('как осанка')) {
      speakShort('Проверяю осанку');
      executeCommand('check_posture');
    }
    else if ((lowerCmd.includes('начать') || lowerCmd.includes('старт')) && (lowerCmd.includes('анализ') || lowerCmd.includes('осанки'))) {
      if (isCalibratedRef.current) {
        speakShort('Запускаю анализ');
        executeCommand('start_analysis');
      } else {
        speakShort('Сначала выполните калибровку');
      }
    }
    else if ((lowerCmd.includes('стоп') || lowerCmd.includes('закончи') || lowerCmd.includes('останови')) && (lowerCmd.includes('анализ') || lowerCmd.includes('осанки'))) {
      speakShort('Останавливаю анализ');
      executeCommand('stop_analysis');
    }
    else if (lowerCmd.includes('сброс') && (lowerCmd.includes('калибр') || lowerCmd.includes('осанки'))) {
      speakShort('Сбрасываю калибровку');
      executeCommand('reset_calibration');
    }
    else if (lowerCmd.includes('статистик') && (lowerCmd.includes('осанки') || lowerCmd.includes('результат'))) {
      speakShort('Показываю статистику');
      executeCommand('show_stats');
    }
    else if (lowerCmd.includes('напомни')) {
      const match = cmd.match(/(\d+)/);
      if (match) {
        speakShort(`Напомню через ${match[1]} минут`);
        executeCommand('set_reminder', match[1]);
      } else {
        speakShort('Скажите время в минутах');
      }
    }
    else if (lowerCmd.includes('упражнения') && (lowerCmd.includes('какие') || lowerCmd.includes('рекоменд'))) {
      speakShort('Рекомендую упражнения для спины');
      executeCommand('recommend_exercises');
    }
    else if (lowerCmd.includes('помощь') || lowerCmd.includes('команды') || lowerCmd.includes('что умеешь')) {
      speakShort('Команды: анализ, упражнения, статистика, отзывы, профиль, калибровка, осанка, начать анализ, стоп анализ, сброс, напомни, помощь, выключи');
    }
    else if (lowerCmd.includes('выключи') || lowerCmd.includes('отключи') || lowerCmd.includes('спасибо')) {
      speakShort('До свидания');
      executeCommand('turn_off');
      setTimeout(() => stopListening(), 500);
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
      console.log('🎤 Voice assistant listening...');
    };
    
    recognition.onresult = (event: any) => {
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText = event.results[i][0].transcript.toLowerCase();
        }
      }
      
      if (finalText && finalText !== lastProcessedText) {
        console.log('🎤 Heard:', finalText);
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
      console.error('Speech recognition error:', event.error);
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
      speakShort('Голосовой ассистент выключен');
    } else {
      startListening();
      speakShort('Скажите "Алиса" для активации');
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