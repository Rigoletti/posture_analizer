import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Webcam from 'react-webcam';
import * as poseDetection from '@tensorflow-models/pose-detection';
import * as tf from '@tensorflow/tfjs';
import PostureNotification from '../ui/PostureNotification';
import { VoiceIndicator } from '../ui/VoiceIndicator';
import { useVoiceAssistant, type VoiceCommand } from '../../hooks/useVoiceAssistant';
import { useGlobalVoice } from '../../context/GlobalVoiceContext';
import { sessionsApi } from '../../api/sessions';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Grid,
  Paper,
  Typography,
  Alert,
  Chip,
  Container,
  Stack,
  alpha,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Snackbar,
  LinearProgress,
} from '@mui/material';
import {
  Refresh,
  CheckCircle,
  History,
  PlayArrow,
  Stop,
  FitnessCenter,
  GraphicEq,
  Mic,
} from '@mui/icons-material';
import { useSessionManager } from '../../hooks/useSessionManager';

const VIDEO_SIZE = 480;
const DETECTION_INTERVAL = 300;
const NOTIFICATION_COOLDOWN = 5000;
const HISTORY_SIZE = 5;

const KEYPOINT_INDICES = {
  NOSE: 0,
  LEFT_EYE: 1,
  RIGHT_EYE: 2,
  LEFT_EAR: 3,
  RIGHT_EAR: 4,
  LEFT_SHOULDER: 5,
  RIGHT_SHOULDER: 6,
  LEFT_ELBOW: 7,
  RIGHT_ELBOW: 8,
  LEFT_WRIST: 9,
  RIGHT_WRIST: 10,
  LEFT_HIP: 11,
  RIGHT_HIP: 12,
} as const;

const POSTURE_THRESHOLDS = {
  CONFIDENCE_THRESHOLD: 0.3,
  DEVIATION_THRESHOLD: 0.1,
};

const UPPER_BODY_INDICES = [
  KEYPOINT_INDICES.NOSE,
  KEYPOINT_INDICES.LEFT_EYE,
  KEYPOINT_INDICES.RIGHT_EYE,
  KEYPOINT_INDICES.LEFT_EAR,
  KEYPOINT_INDICES.RIGHT_EAR,
  KEYPOINT_INDICES.LEFT_SHOULDER,
  KEYPOINT_INDICES.RIGHT_SHOULDER,
  KEYPOINT_INDICES.LEFT_ELBOW,
  KEYPOINT_INDICES.RIGHT_ELBOW,
  KEYPOINT_INDICES.LEFT_WRIST,
  KEYPOINT_INDICES.RIGHT_WRIST,
];

const POSTURE_ANALYSIS_INDICES = [
  KEYPOINT_INDICES.LEFT_SHOULDER,
  KEYPOINT_INDICES.RIGHT_SHOULDER,
  KEYPOINT_INDICES.NOSE,
  KEYPOINT_INDICES.LEFT_EAR,
  KEYPOINT_INDICES.RIGHT_EAR,
];

const calculateDistance = (x1: number, y1: number, x2: number, y2: number): number => {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
};

const mirrorKeypoints = (keypoints: poseDetection.Keypoint[], canvasWidth: number): poseDetection.Keypoint[] => {
  return keypoints.map(kp => ({
    ...kp,
    x: canvasWidth - kp.x
  }));
};

const normalizePoints = (keypoints: poseDetection.Keypoint[]) => {
  const leftShoulder = keypoints[KEYPOINT_INDICES.LEFT_SHOULDER];
  const rightShoulder = keypoints[KEYPOINT_INDICES.RIGHT_SHOULDER];
  
  if (!leftShoulder || !rightShoulder || 
      leftShoulder.score < POSTURE_THRESHOLDS.CONFIDENCE_THRESHOLD ||
      rightShoulder.score < POSTURE_THRESHOLDS.CONFIDENCE_THRESHOLD) {
    return null;
  }
  
  const shoulderWidth = calculateDistance(
    leftShoulder.x, leftShoulder.y,
    rightShoulder.x, rightShoulder.y
  );
  
  if (shoulderWidth < 10) return null;
  
  return keypoints.map(kp => ({
    ...kp,
    x: kp.x / shoulderWidth,
    y: kp.y / shoulderWidth
  }));
};

const WebcamFeed: React.FC = () => {
  const navigate = useNavigate();
  const webcamRef = useRef<Webcam>(null);
  const animationFrameRef = useRef<number>();
  const lastDetectionTimeRef = useRef(0);
  const lastNotificationTimeRef = useRef(0);
  const lastAlertRef = useRef<string>('');
  const detectorRef = useRef<poseDetection.PoseDetector | null>(null);

  // Состояния
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [referenceNormalized, setReferenceNormalized] = useState<poseDetection.Keypoint[] | null>(null);
  const [isModelReady, setIsModelReady] = useState(false);
  const [postureHistory, setPostureHistory] = useState<string[]>([]);
  const [calibrationInProgress, setCalibrationInProgress] = useState<boolean>(false);
  const [trackingQuality, setTrackingQuality] = useState<number>(0);
  const [isCalibrated, setIsCalibrated] = useState<boolean>(false);
  const [currentPoseStatus, setCurrentPoseStatus] = useState<string>('Ожидание анализа...');
  const [postureSeverity, setPostureSeverity] = useState<'success' | 'warning' | 'error' | 'info'>('info');
  const [currentIssues, setCurrentIssues] = useState<string[]>([]);
  const [lastSpokenIssues, setLastSpokenIssues] = useState<string[]>([]);
  
  const [showNotification, setShowNotification] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');
  const [notificationType, setNotificationType] = useState<'shoulders' | 'head'>('shoulders');

  const [sessionDuration, setSessionDuration] = useState(0);
  const [showSessionEndDialog, setShowSessionEndDialog] = useState(false);
  const [voiceAssistantError, setVoiceAssistantError] = useState<string | null>(null);

  const {
    currentSession,
    isSessionActive,
    startSession,
    endSession,
    updateMetrics,
    addKeyMoment,
    sessionStats,
    getPostureScore,
  } = useSessionManager({
    onSessionStarted: () => {
      setCurrentPoseStatus('Сеанс начат');
    },
    onSessionEnded: () => {
      setCurrentPoseStatus('Сеанс завершен');
    }
  });

  // Глобальный голосовой ассистент
  const { registerPageCommands, speak: globalSpeak } = useGlobalVoice();

  // Загрузка модели
  const loadModel = useCallback(async () => {
    if (detectorRef.current || isModelReady || isModelLoading) return;
    
    setIsModelLoading(true);
    setError(null);
    
    try {
      await tf.ready();
      
      const detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.MoveNet,
        { 
          modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
          enableSmoothing: true
        }
      );
      
      detectorRef.current = detector;
      setIsModelReady(true);
      console.log('Model loaded successfully');
    } catch (err) {
      console.error('Model loading error:', err);
      setError('Ошибка загрузки модели AI');
    } finally {
      setIsModelLoading(false);
    }
  }, [isModelReady, isModelLoading]);

  // Калибровка
  const calibrate = useCallback(async () => {
    if (!detectorRef.current && !isModelReady) {
      await loadModel();
    }
    
    const webcamVideo = webcamRef.current?.video;
    if (!webcamVideo || !detectorRef.current || calibrationInProgress) return;
    
    setCalibrationInProgress(true);
    
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      const poses = await detectorRef.current.estimatePoses(webcamVideo, { 
        maxPoses: 1, 
        flipHorizontal: false 
      });
      
      if (poses.length > 0) {
        const kp = poses[0].keypoints;
        const hasRequiredPoints = 
          kp[KEYPOINT_INDICES.LEFT_SHOULDER]?.score > POSTURE_THRESHOLDS.CONFIDENCE_THRESHOLD &&
          kp[KEYPOINT_INDICES.RIGHT_SHOULDER]?.score > POSTURE_THRESHOLDS.CONFIDENCE_THRESHOLD &&
          kp[KEYPOINT_INDICES.NOSE]?.score > POSTURE_THRESHOLDS.CONFIDENCE_THRESHOLD;
        
        if (hasRequiredPoints) {
          const mirroredPoints = mirrorKeypoints(kp, VIDEO_SIZE);
          const normalized = normalizePoints(mirroredPoints);
          if (normalized) {
            setReferenceNormalized(normalized);
            setIsCalibrated(true);
            setCurrentPoseStatus('Калибровано');
            setPostureHistory([]);
            setPostureSeverity('success');
            setShowNotification(false);
            lastAlertRef.current = '';
            lastNotificationTimeRef.current = 0;
            console.log('✅ Calibration SUCCESS');
            // Озвучиваем через voiceAssistant после инициализации
            if (voiceAssistantRef.current) {
              voiceAssistantRef.current.speak('Калибровка успешно завершена. Теперь можно начинать анализ.');
            }
          } else {
            setError('Не удалось нормализовать позу');
          }
        } else {
          setError('Не удалось распознать плечи и голову. Встаньте прямо перед камерой.');
        }
      } else {
        setError('Поза не обнаружена');
      }
    } catch (err) {
      console.error('Calibration error:', err);
      setError('Ошибка калибровки');
    } finally {
      setCalibrationInProgress(false);
    }
  }, [calibrationInProgress, loadModel, isModelReady]);

  const resetCalibration = () => {
    setReferenceNormalized(null);
    setIsCalibrated(false);
    setCurrentPoseStatus('Ожидание анализа...');
    setPostureSeverity('info');
    setPostureHistory([]);
    setShowNotification(false);
    lastAlertRef.current = '';
    lastNotificationTimeRef.current = 0;
    setLastSpokenIssues([]);
    console.log('Calibration reset');
  };

  const handleStartSession = useCallback(async () => {
    if (!detectorRef.current && !isModelReady) {
      await loadModel();
    }
    
    if (!isCalibrated) {
      setError('Сначала выполните калибровку');
      return;
    }
    
    try {
      await startSession({
        confidenceThreshold: POSTURE_THRESHOLDS.CONFIDENCE_THRESHOLD,
        deviationThreshold: POSTURE_THRESHOLDS.DEVIATION_THRESHOLD,
        notificationEnabled: true
      });
      setCurrentPoseStatus('Анализ начат');
      console.log('Session started');
    } catch (err) {
      console.error('Failed to start session:', err);
      setError('Не удалось начать сеанс');
    }
  }, [startSession, isCalibrated, loadModel, isModelReady]);

  const handleEndSession = useCallback(async () => {
    try {
      await endSession();
      setShowSessionEndDialog(true);
      setCurrentPoseStatus('Сеанс завершен');
      lastAlertRef.current = '';
      console.log('Session ended');
    } catch (err) {
      console.error('Failed to end session:', err);
      setError('Не удалось завершить сеанс');
    }
  }, [endSession]);

  // Реф для доступа к voiceAssistant из замыканий
  const voiceAssistantRef = useRef<any>(null);

  // Голосовой ассистент - объявляем ПОСЛЕ всех функций, но через ref
  const voiceAssistant = useVoiceAssistant({
    onCommand: async (command: VoiceCommand, details?: string) => {
      console.log('🎤 Voice command received:', command, 'isCalibrated:', isCalibrated);
      
      switch (command) {
        case 'check_posture':
          if (currentIssues.length > 0) {
            voiceAssistantRef.current?.speak(`Ваша осанка имеет нарушения: ${currentIssues.join(', ')}. Общая оценка ${getPostureScore()} процентов.`);
          } else {
            const score = getPostureScore();
            if (score >= 80) {
              voiceAssistantRef.current?.speak(`Отлично! Ваша осанка в норме. Оценка ${score} процентов.`);
            } else {
              voiceAssistantRef.current?.speak(`Ваша осанка в порядке, но есть куда расти. Оценка ${score} процентов.`);
            }
          }
          break;

        case 'start_analysis':
          if (!isCalibrated) {
            voiceAssistantRef.current?.speak('Сначала выполните калибровку. Скажите калибровка.');
          } else if (!isSessionActive) {
            await handleStartSession();
            voiceAssistantRef.current?.speak('Анализ осанки запущен. Я буду следить за вашей позой.');
          } else {
            voiceAssistantRef.current?.speak('Анализ уже запущен.');
          }
          break;

        case 'stop_analysis':
          if (isSessionActive) {
            await handleEndSession();
            voiceAssistantRef.current?.speak('Анализ осанки остановлен. Сеанс завершен.');
          } else {
            voiceAssistantRef.current?.speak('Анализ не запущен.');
          }
          break;

        case 'show_stats':
          try {
            voiceAssistantRef.current?.speak('Получаю статистику ваших сеансов...');
            
            const response = await sessionsApi.getSessionsHistory(1, 100);
            
            if (response.success && response.data && response.data.statistics) {
              const stats = response.data.statistics;
              const totalSessions = stats.totalSessions || 0;
              
              if (totalSessions === 0) {
                voiceAssistantRef.current?.speak('У вас пока нет завершенных сеансов. Пройдите анализ осанки, чтобы получить статистику.');
              } else {
                const avgScore = Math.round(stats.avgScore || 0);
                const bestScore = stats.bestScore || 0;
                const totalDuration = Math.round((stats.totalDuration || 0) / 60);
                const avgDuration = Math.round((stats.avgDuration || 0) / 60);
                
                voiceAssistantRef.current?.speak(
                  `У вас ${totalSessions} завершенных сеансов. ` +
                  `Средняя оценка осанки: ${avgScore} процентов. ` +
                  `Лучший результат: ${bestScore} процентов. ` +
                  `Общая длительность: ${totalDuration} минут. ` +
                  `Средняя длительность сеанса: ${avgDuration} минут.`
                );
              }
            } else {
              voiceAssistantRef.current?.speak('Не удалось получить статистику. Попробуйте позже.');
            }
          } catch (err) {
            console.error('Failed to get stats:', err);
            voiceAssistantRef.current?.speak('Ошибка при получении статистики.');
          }
          break;

        case 'calibrate':
          if (!calibrationInProgress) {
            voiceAssistantRef.current?.speak('Запускаю калибровку. Встаньте прямо перед камерой.');
            await calibrate();
          } else {
            voiceAssistantRef.current?.speak('Калибровка уже выполняется.');
          }
          break;

        case 'reset_calibration':
          resetCalibration();
          voiceAssistantRef.current?.speak('Калибровка сброшена.');
          break;

        case 'set_reminder':
          if (details) {
            const minutes = parseInt(details);
            voiceAssistantRef.current?.setReminder(minutes, 'Пора проверить осанку! Сделайте перерыв и выпрямите спину.');
            voiceAssistantRef.current?.speak(`Напоминание установлено на ${minutes} минут.`);
          } else {
            voiceAssistantRef.current?.speak('Пожалуйста, укажите время в минутах. Например: напомни через 5 минут.');
          }
          break;

        case 'recommend_exercises':
          voiceAssistantRef.current?.speak('Рекомендую упражнения для укрепления спины: сведение лопаток, упражнение кошка-корова, планка, мостик. Подробнее смотрите в разделе Упражнения.');
          break;

        case 'help':
          voiceAssistantRef.current?.speak('Доступные команды: осанка, начать анализ, закончить анализ, статистика, калибровка, сброс, напомни через N минут, упражнения, помощь, выключи.');
          break;
          
        case 'turn_off':
          console.log('Voice assistant turning off');
          break;
      }
    },
    onPostureAlert: (message: string) => {
      setVoiceAssistantError(message);
      setTimeout(() => setVoiceAssistantError(null), 5000);
    },
    isSessionActive,
    isCalibrated,
    sessionId: currentSession?.sessionId
  });

  // Сохраняем ссылку на voiceAssistant
  useEffect(() => {
    voiceAssistantRef.current = voiceAssistant;
  }, [voiceAssistant]);

  // Регистрируем команды для глобального ассистента
  useEffect(() => {
    const unregister = registerPageCommands({
      onCommand: async (command: VoiceCommand, details?: string) => {
        console.log('🌍 Global command received on page:', command);
        
        switch (command) {
          case 'check_posture':
            if (currentIssues.length > 0) {
              globalSpeak(`Нарушения: ${currentIssues.join(', ')}. Оценка ${getPostureScore()}%`);
            } else {
              globalSpeak(`Осанка в норме. Оценка ${getPostureScore()}%`);
            }
            break;
          case 'start_analysis':
            if (!isCalibrated) {
              globalSpeak('Сначала выполните калибровку');
            } else if (!isSessionActive) {
              await handleStartSession();
              globalSpeak('Анализ запущен');
            } else {
              globalSpeak('Анализ уже запущен');
            }
            break;
          case 'stop_analysis':
            if (isSessionActive) {
              await handleEndSession();
              globalSpeak('Анализ остановлен');
            } else {
              globalSpeak('Анализ не запущен');
            }
            break;
          case 'calibrate':
            if (!calibrationInProgress) {
              globalSpeak('Запускаю калибровку');
              await calibrate();
            } else {
              globalSpeak('Калибровка уже выполняется');
            }
            break;
          case 'reset_calibration':
            resetCalibration();
            globalSpeak('Калибровка сброшена');
            break;
          case 'show_stats':
            globalSpeak('Открываю статистику');
            navigate('/sessions');
            break;
          case 'set_reminder':
            if (details) {
              const minutes = parseInt(details);
              setTimeout(() => {
                globalSpeak('Пора проверить осанку! Сделайте перерыв');
              }, minutes * 60 * 1000);
              globalSpeak(`Напомню через ${minutes} минут`);
            } else {
              globalSpeak('Скажите время в минутах');
            }
            break;
          case 'recommend_exercises':
            globalSpeak('Рекомендую упражнения для спины: сведение лопаток, кошка-корова, планка');
            navigate('/exercises');
            break;
          case 'help':
            globalSpeak('Команды: калибровка, осанка, начать анализ, стоп анализ, статистика, сброс, напомни, упражнения, помощь');
            break;
          case 'turn_off':
            globalSpeak('До свидания');
            break;
        }
      },
      isActive: true,
    });
    
    return unregister;
  }, [isCalibrated, isSessionActive, currentIssues, calibrationInProgress, getPostureScore, handleStartSession, handleEndSession, calibrate, resetCalibration, navigate, registerPageCommands, globalSpeak]);

  // Отслеживаем изменение калибровки
  useEffect(() => {
    console.log('🔔 isCalibrated changed to:', isCalibrated);
  }, [isCalibrated]);

  const showPostureNotification = useCallback(async (type: 'shoulders' | 'head', message: string) => {
    if (!isSessionActive) return;
    
    const now = Date.now();
    if (now - lastNotificationTimeRef.current < NOTIFICATION_COOLDOWN) return;
    
    lastNotificationTimeRef.current = now;
    setNotificationType(type);
    setNotificationMessage(message);
    setShowNotification(true);
    
    voiceAssistant.speakPostureAlert(type);
    
    if (currentSession) {
      await addKeyMoment('notification', message, { type });
    }
    
    setTimeout(() => setShowNotification(false), 5000);
  }, [isSessionActive, currentSession, addKeyMoment, voiceAssistant]);

  const analyzePosture = useCallback((currentNormalized: poseDetection.Keypoint[]) => {
    if (!referenceNormalized) return;

    const issues: string[] = [];

    for (const index of POSTURE_ANALYSIS_INDICES) {
      const currentPoint = currentNormalized[index];
      const referencePoint = referenceNormalized[index];

      if (currentPoint?.score && currentPoint.score > POSTURE_THRESHOLDS.CONFIDENCE_THRESHOLD && 
          referencePoint?.score && referencePoint.score > POSTURE_THRESHOLDS.CONFIDENCE_THRESHOLD) {
        
        const deviation = calculateDistance(
          currentPoint.x, currentPoint.y,
          referencePoint.x, referencePoint.y
        );
        
        if (deviation > POSTURE_THRESHOLDS.DEVIATION_THRESHOLD) {
          if (index === KEYPOINT_INDICES.LEFT_SHOULDER || index === KEYPOINT_INDICES.RIGHT_SHOULDER) {
            if (!issues.includes('Плечи')) {
              issues.push('Плечи');
            }
          } else if (index === KEYPOINT_INDICES.NOSE || index === KEYPOINT_INDICES.LEFT_EAR || index === KEYPOINT_INDICES.RIGHT_EAR) {
            if (!issues.includes('Голова')) {
              issues.push('Голова');
            }
          }
        }
      }
    }

    const status = issues.length > 0 ? `Нарушена: ${issues.join(', ')}` : 'Хорошая осанка';
    const severity = issues.length > 0 ? 'warning' : 'success';

    if (issues.length > 0 && lastAlertRef.current !== status && isSessionActive) {
      const issuesKey = issues.sort().join(',');
      const lastIssuesKey = lastSpokenIssues.sort().join(',');
      
      if (issuesKey !== lastIssuesKey) {
        voiceAssistant.announcePostureIssue(issues);
        setLastSpokenIssues(issues);
      }
    }

    lastAlertRef.current = status;

    setCurrentIssues(issues);
    setPostureHistory(prev => {
      const newHistory = [...prev, status];
      return newHistory.slice(-HISTORY_SIZE);
    });
    setCurrentPoseStatus(status);
    setPostureSeverity(severity);
    
    if (isSessionActive && currentSession) {
      updateMetrics(
        {
          normalizedPoints: currentNormalized.map((kp, index) => ({
            x: kp.x,
            y: kp.y,
            score: kp.score || 0,
            name: Object.keys(KEYPOINT_INDICES).find(key => 
              KEYPOINT_INDICES[key as keyof typeof KEYPOINT_INDICES] === index
            )
          }))
        },
        status,
        issues
      );
    }
  }, [referenceNormalized, isSessionActive, currentSession, updateMetrics, voiceAssistant, lastSpokenIssues]);

  // Цикл детекции
  useEffect(() => {
    if (!isModelReady || !referenceNormalized || !isSessionActive) return;
    
    let isActive = true;
    
    const detectLoop = async () => {
      if (!isActive) return;
      
      const webcamVideo = webcamRef.current?.video;
      if (!webcamVideo || webcamVideo.readyState < 2) {
        animationFrameRef.current = requestAnimationFrame(detectLoop);
        return;
      }
      
      const now = Date.now();
      if (now - lastDetectionTimeRef.current < DETECTION_INTERVAL) {
        animationFrameRef.current = requestAnimationFrame(detectLoop);
        return;
      }
      
      lastDetectionTimeRef.current = now;
      
      try {
        const poses = await detectorRef.current!.estimatePoses(webcamVideo, {
          maxPoses: 1,
          flipHorizontal: false
        });
        
        if (poses.length > 0) {
          const validPointsCount = poses[0].keypoints.filter((kp, idx) => 
            UPPER_BODY_INDICES.includes(idx) && kp.score > POSTURE_THRESHOLDS.CONFIDENCE_THRESHOLD
          ).length;
          
          const quality = Math.round((validPointsCount / UPPER_BODY_INDICES.length) * 100);
          setTrackingQuality(quality);
          
          if (quality >= 40) {
            const mirroredPoints = mirrorKeypoints(poses[0].keypoints, VIDEO_SIZE);
            const normalized = normalizePoints(mirroredPoints);
            if (normalized) {
              analyzePosture(normalized);
            }
          }
        }
      } catch (err) {
        console.warn('Detection error:', err);
      }
      
      animationFrameRef.current = requestAnimationFrame(detectLoop);
    };
    
    detectLoop();
    
    return () => {
      isActive = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isModelReady, referenceNormalized, isSessionActive, analyzePosture]);

  // Таймер сеанса
  useEffect(() => {
    if (!isSessionActive) {
      setSessionDuration(0);
      return;
    }
    
    const interval = setInterval(() => {
      setSessionDuration(prev => prev + 1);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [isSessionActive]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const calculatePostureScore = () => {
    return getPostureScore();
  };

  const handleCloseDialog = () => setShowSessionEndDialog(false);
  const handleViewHistory = () => {
    setShowSessionEndDialog(false);
    navigate('/sessions');
  };

  const closeNotification = () => setShowNotification(false);
  const closeVoiceAssistantError = () => setVoiceAssistantError(null);

  return (
    <Box sx={{ 
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
      py: 4
    }}>
      <Container maxWidth="xl">
        {/* Голосовой индикатор в правом верхнем углу */}
        <Box sx={{ position: 'fixed', top: 80, right: 24, zIndex: 1000 }}>
          <VoiceIndicator
            isListening={voiceAssistant.isListening}
            isSpeaking={voiceAssistant.isSpeaking}
            isProcessing={voiceAssistant.isProcessing}
            onToggle={voiceAssistant.toggleListening}
            error={voiceAssistant.error}
          />
        </Box>

        <PostureNotification
          isVisible={showNotification}
          message={notificationMessage}
          postureType={notificationType}
          severity="warning"
          onClose={closeNotification}
        />

        {/* Snackbar для голосовых подсказок */}
        <Snackbar
          open={!!voiceAssistantError}
          autoHideDuration={5000}
          onClose={closeVoiceAssistantError}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert 
            onClose={closeVoiceAssistantError} 
            severity="info" 
            sx={{ 
              width: '100%',
              bgcolor: '#1e293b',
              color: 'white',
              '& .MuiAlert-icon': { color: '#3b82f6' }
            }}
            icon={<GraphicEq />}
          >
            {voiceAssistantError}
          </Alert>
        </Snackbar>

        <Dialog open={showSessionEndDialog} onClose={handleCloseDialog}>
          <DialogTitle>Сеанс завершен</DialogTitle>
          <DialogContent>
            <Typography>Сеанс анализа успешно завершен.</Typography>
            {currentSession && (
              <Box sx={{ mt: 2 }}>
                <Typography>Длительность: {formatTime(sessionDuration)}</Typography>
                <Typography>Оценка: {calculatePostureScore()}%</Typography>
                <Typography>Кадров: {sessionStats.totalFrames}</Typography>
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseDialog}>Закрыть</Button>
            <Button onClick={handleViewHistory} variant="contained">История</Button>
          </DialogActions>
        </Dialog>

        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Card sx={{ borderRadius: 3 }}>
              <Box sx={{ position: 'relative', bgcolor: 'black', borderRadius: '12px 12px 0 0', overflow: 'hidden' }}>
                <Webcam
                  ref={webcamRef}
                  width={VIDEO_SIZE}
                  height={VIDEO_SIZE}
                  videoConstraints={{ 
                    width: VIDEO_SIZE, 
                    height: VIDEO_SIZE,
                    facingMode: 'user'
                  }}
                  mirrored={true}
                  style={{ width: '100%', height: 'auto' }}
                  onUserMedia={() => setError(null)}
                  onUserMediaError={() => setError('Не удалось получить доступ к вебкамере')}
                />

                {isModelLoading && (
                  <Box sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                    gap: 2,
                    bgcolor: 'rgba(0,0,0,0.8)'
                  }}>
                    <CircularProgress />
                    <Typography sx={{ color: 'white' }}>Загрузка AI модели...</Typography>
                  </Box>
                )}

                {error && (
                  <Box sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: 'rgba(0,0,0,0.8)',
                    p: 3
                  }}>
                    <Alert severity="error">{error}</Alert>
                  </Box>
                )}

                {isCalibrated && !isModelLoading && !error && (
                  <Chip
                    label="Эталон задан"
                    color="success"
                    size="small"
                    sx={{ position: 'absolute', top: 10, left: 10 }}
                  />
                )}

                {/* Индикатор речи на видео */}
                {voiceAssistant.isSpeaking && (
                  <Box sx={{
                    position: 'absolute',
                    bottom: 10,
                    left: 10,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    bgcolor: alpha('#000', 0.6),
                    borderRadius: 2,
                    px: 1.5,
                    py: 0.5,
                  }}>
                    <GraphicEq sx={{ color: '#3b82f6', fontSize: 20 }} />
                    <Typography variant="caption" sx={{ color: 'white' }}>Говорит...</Typography>
                  </Box>
                )}
              </Box>

              <CardContent>
                <Stack spacing={2}>
                  <Stack direction="row" spacing={2}>
                    <Button
                      fullWidth
                      variant="contained"
                      onClick={calibrate}
                      disabled={calibrationInProgress}
                      startIcon={calibrationInProgress ? <CircularProgress size={20} /> : <CheckCircle />}
                      sx={{ textTransform: 'none', borderRadius: 2 }}
                    >
                      {calibrationInProgress ? 'Калибровка...' : 'Задать эталон'}
                    </Button>
                    
                    {isCalibrated && (
                      <Button
                        variant="outlined"
                        color="error"
                        onClick={resetCalibration}
                        startIcon={<Refresh />}
                        sx={{ textTransform: 'none', borderRadius: 2 }}
                      >
                        Сброс
                      </Button>
                    )}
                  </Stack>

                  {!isSessionActive ? (
                    <Button
                      fullWidth
                      variant="contained"
                      color="success"
                      size="large"
                      onClick={handleStartSession}
                      disabled={!isCalibrated}
                      startIcon={<PlayArrow />}
                      sx={{ textTransform: 'none', borderRadius: 2, py: 1.5 }}
                    >
                      Начать анализ
                    </Button>
                  ) : (
                    <Button
                      fullWidth
                      variant="outlined"
                      color="error"
                      onClick={handleEndSession}
                      startIcon={<Stop />}
                      sx={{ textTransform: 'none', borderRadius: 2, py: 1.5 }}
                    >
                      Завершить анализ
                    </Button>
                  )}

                  <Stack direction="row" spacing={1}>
                    <Button
                      fullWidth
                      startIcon={<History />}
                      onClick={() => navigate('/sessions')}
                      variant="outlined"
                      sx={{ textTransform: 'none', borderRadius: 2 }}
                    >
                      История
                    </Button>
                    
                    <Button
                      fullWidth
                      startIcon={<FitnessCenter />}
                      onClick={() => navigate('/exercises')}
                      variant="outlined"
                      sx={{ textTransform: 'none', borderRadius: 2 }}
                    >
                      Упражнения
                    </Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Stack spacing={3}>
              <Card sx={{ borderRadius: 3 }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: '#1e293b' }}>Статус системы</Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={6}>
                      <Paper sx={{ p: 2, textAlign: 'center', borderRadius: 2 }}>
                        <Typography variant="h4" color={trackingQuality > 70 ? '#10b981' : '#f59e0b'} sx={{ fontWeight: 700 }}>
                          {trackingQuality}%
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#64748b' }}>Качество</Typography>
                      </Paper>
                    </Grid>
                    <Grid item xs={6}>
                      <Paper sx={{ p: 2, textAlign: 'center', borderRadius: 2 }}>
                        <Typography variant="h4" color={isCalibrated ? '#10b981' : '#ef4444'} sx={{ fontWeight: 700 }}>
                          {isCalibrated ? '✓' : '!'}
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#64748b' }}>Калибровка</Typography>
                      </Paper>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>

              {/* Состояние голосового ассистента */}
              <Card sx={{ borderRadius: 3, bgcolor: voiceAssistant.isListening ? alpha('#10b981', 0.05) : 'white' }}>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="h6" sx={{ fontWeight: 600, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Mic sx={{ color: voiceAssistant.isListening ? '#10b981' : '#94a3b8' }} />
                      Голосовой ассистент
                    </Typography>
                    <Chip
                      label={voiceAssistant.isListening ? 'Активен' : 'Неактивен'}
                      size="small"
                      color={voiceAssistant.isListening ? 'success' : 'default'}
                    />
                  </Box>
                  
                  <Typography variant="body2" sx={{ color: '#64748b', mb: 1 }}>
                    {voiceAssistant.isListening 
                      ? 'Скажите команду. Например: калибровка, начать анализ, осанка' 
                      : 'Включите ассистента для голосового управления'}
                  </Typography>
                  
                  {voiceAssistant.isProcessing && (
                    <LinearProgress sx={{ mt: 1, borderRadius: 1 }} />
                  )}
                </CardContent>
              </Card>

              <Card sx={{ borderRadius: 3 }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: '#1e293b' }}>Текущий статус</Typography>
                  <Alert severity={postureSeverity} sx={{ mb: 2, borderRadius: 2 }}>
                    {currentPoseStatus}
                  </Alert>
                  
                  {currentIssues.length > 0 && (
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      {currentIssues.map((issue, i) => (
                        <Chip key={i} label={issue} color="warning" size="small" />
                      ))}
                    </Stack>
                  )}
                </CardContent>
              </Card>

              {isSessionActive && (
                <Card sx={{ borderRadius: 3 }}>
                  <CardContent>
                    <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: '#1e293b' }}>Статистика</Typography>
                    <Grid container spacing={2}>
                      <Grid item xs={6}>
                        <Typography variant="body2" sx={{ color: '#64748b' }}>Кадров</Typography>
                        <Typography variant="h6" sx={{ fontWeight: 600 }}>{sessionStats.totalFrames}</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" sx={{ color: '#64748b' }}>Оценка</Typography>
                        <Typography variant="h6" sx={{ fontWeight: 600, color: '#3B82F6' }}>{calculatePostureScore()}%</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" sx={{ color: '#64748b' }}>Хорошая осанка</Typography>
                        <Typography variant="h6" sx={{ fontWeight: 600, color: '#10b981' }}>{sessionStats.goodPostureFrames}</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" sx={{ color: '#64748b' }}>Нарушений</Typography>
                        <Typography variant="h6" sx={{ fontWeight: 600, color: '#f59e0b' }}>{sessionStats.warningFrames}</Typography>
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              )}

              {postureHistory.length > 0 && (
                <Card sx={{ borderRadius: 3 }}>
                  <CardContent>
                    <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: '#1e293b' }}>Последние измерения</Typography>
                    <Stack spacing={1}>
                      {postureHistory.map((status, i) => (
                        <Paper key={i} sx={{ p: 1, bgcolor: alpha('#3B82F6', 0.1), borderRadius: 2 }}>
                          <Typography variant="body2" sx={{ color: '#1e293b' }}>{status}</Typography>
                        </Paper>
                      ))}
                    </Stack>
                  </CardContent>
                </Card>
              )}
            </Stack>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
};

export default WebcamFeed;