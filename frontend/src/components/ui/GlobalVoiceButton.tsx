// frontend/components/ui/GlobalVoiceButton.tsx
import React, { memo } from 'react';
import { Box, Fab, Tooltip, Badge, alpha } from '@mui/material';
import { Mic, MicOff, GraphicEq } from '@mui/icons-material';
import { useGlobalVoice } from '../../context/GlobalVoiceContext';
import { useAuthStore } from '../../store/auth';

export const GlobalVoiceButton: React.FC = memo(() => {
  const { isListening, isSpeaking, toggleListening } = useGlobalVoice();
  const { isAuthenticated } = useAuthStore();
  
  if (!isAuthenticated) return null;
  
  return (
    <Box sx={{ position: 'fixed', bottom: 24, right: 24, zIndex: 2000 }}>
      <Tooltip title={isListening ? 'Выключить ассистента' : 'Включить ассистента'}>
        <Fab
          size="medium"
          onClick={toggleListening}
          sx={{
            bgcolor: isListening ? '#10b981' : '#3b82f6',
            color: 'white',
            '&:hover': {
              bgcolor: isListening ? '#059669' : '#2563eb',
            },
            animation: isSpeaking ? 'pulse 1s ease infinite' : 'none',
            '@keyframes pulse': {
              '0%': { boxShadow: '0 0 0 0 rgba(59,130,246,0.7)' },
              '70%': { boxShadow: '0 0 0 15px rgba(59,130,246,0)' },
              '100%': { boxShadow: '0 0 0 0 rgba(59,130,246,0)' },
            },
          }}
        >
          {isListening ? (
            <Badge variant="dot" color="success" overlap="circular" anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
              <Mic />
            </Badge>
          ) : isSpeaking ? (
            <GraphicEq />
          ) : (
            <MicOff />
          )}
        </Fab>
      </Tooltip>
    </Box>
  );
});

GlobalVoiceButton.displayName = 'GlobalVoiceButton';