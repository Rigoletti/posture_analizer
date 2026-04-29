import React, { createContext, useContext, ReactNode, useRef, useEffect } from 'react';
import { useVoiceAssistant, type VoiceCommand } from '../hooks/useVoiceAssistant';

// Расширяем тип VoiceCommand для навигации
type ExtendedVoiceCommand = VoiceCommand | 'go_to_analysis' | 'go_to_exercises' | 'go_to_sessions' | 'go_to_reviews' | 'go_to_profile';

interface GlobalVoiceContextValue {
  isListening: boolean;
  isSpeaking: boolean;
  isProcessing: boolean;
  error: string | null;
  toggleListening: () => void;
  speak: (text: string) => void;
  registerPageCommands: (commands: {
    onCommand: (command: ExtendedVoiceCommand, details?: string) => void;
    isActive: boolean;
  }) => () => void;
}

const GlobalVoiceContext = createContext<GlobalVoiceContextValue | null>(null);

export const useGlobalVoice = () => {
  const context = useContext(GlobalVoiceContext);
  if (!context) {
    throw new Error('useGlobalVoice must be used within GlobalVoiceProvider');
  }
  return context;
};

interface GlobalVoiceProviderProps {
  children: ReactNode;
}

export const GlobalVoiceProvider: React.FC<GlobalVoiceProviderProps> = ({ children }) => {
  const pageHandlersRef = useRef<Map<string, (command: ExtendedVoiceCommand, details?: string) => void>>(new Map());
  const currentPageRef = useRef<string>('home');
  const isSessionActiveRef = useRef(false);
  const isCalibratedRef = useRef(false);

  const handleGlobalCommand = (command: VoiceCommand, details?: string) => {
    console.log('🌐 Global command:', command, 'current page:', currentPageRef.current);
    
    // Навигационные команды - работают глобально
    const navCommand = command as ExtendedVoiceCommand;
    switch (navCommand) {
      case 'go_to_analysis':
        window.location.href = '/';
        return;
      case 'go_to_exercises':
        window.location.href = '/exercises';
        return;
      case 'go_to_sessions':
        window.location.href = '/sessions';
        return;
      case 'go_to_reviews':
        window.location.href = '/reviews';
        return;
      case 'go_to_profile':
        window.location.href = '/profile';
        return;
    }
    
    // Отправляем команду текущей странице
    const handler = pageHandlersRef.current.get(currentPageRef.current);
    if (handler) {
      handler(command, details);
    }
  };

  const voiceAssistant = useVoiceAssistant({
    onCommand: handleGlobalCommand,
    onPostureAlert: (msg) => console.log('Alert:', msg),
    isSessionActive: isSessionActiveRef.current,
    isCalibrated: isCalibratedRef.current,
  });

  const registerPageCommands = (commands: {
    onCommand: (command: ExtendedVoiceCommand, details?: string) => void;
    isActive: boolean;
  }) => {
    const pageId = Math.random().toString();
    pageHandlersRef.current.set(pageId, commands.onCommand);
    
    return () => {
      pageHandlersRef.current.delete(pageId);
    };
  };

  const value: GlobalVoiceContextValue = {
    isListening: voiceAssistant.isListening,
    isSpeaking: voiceAssistant.isSpeaking,
    isProcessing: voiceAssistant.isProcessing,
    error: voiceAssistant.error,
    toggleListening: voiceAssistant.toggleListening,
    speak: voiceAssistant.speak,
    registerPageCommands,
  };

  return (
    <GlobalVoiceContext.Provider value={value}>
      {children}
    </GlobalVoiceContext.Provider>
  );
};