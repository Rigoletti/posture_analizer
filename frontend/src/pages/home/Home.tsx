import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Button,
  Grid,
  Stack,
  alpha,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  PlayArrow as PlayIcon,
  CheckCircle as CheckIcon,
  Speed as SpeedIcon,
  Timeline as TimelineIcon,
  NotificationsActive as NotificationsIcon,
} from '@mui/icons-material';
import { motion, AnimatePresence } from 'framer-motion';
import WebcamFeed from '../../components/home/WebcamFeed';
import ReviewCarousel from '../../components/reviews/ReviewCarousel';
import { useAuthStore } from '../../store/auth';

// Цветовая схема как у Vercel
const COLORS = {
  primary: '#000000',
  secondary: '#666666',
  accent: '#0070F3',
  bg: '#FFFFFF',
  bgSecondary: '#FAFAFA',
  text: '#000000',
  textLight: '#666666',
  border: '#E5E5E5',
};

const Home: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [analysisStarted, setAnalysisStarted] = useState(false);

  const handleStart = () => setAnalysisStarted(true);
  const handleBack = () => setAnalysisStarted(false);

  return (
    <Box sx={{ bgcolor: COLORS.bg, minHeight: '100vh' }}>
      <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
        <AnimatePresence mode="wait">
          {!analysisStarted ? (
            <motion.div
              key="home"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* Hero как у Vercel — центрированный, минималистичный */}
              <Box sx={{ textAlign: 'center', maxWidth: '800px', mx: 'auto', mb: 12 }}>
                {/* Eyebrow как у Linear */}
           

                <Typography
                  sx={{
                    fontSize: { xs: '2.5rem', md: '4rem' },
                    fontWeight: 700,
                    letterSpacing: '-0.02em',
                    color: COLORS.text,
                    mb: 2,
                  }}
                >
                  Осанка под контролем AI
                </Typography>

                <Typography
                  sx={{
                    fontSize: '1.125rem',
                    color: COLORS.textLight,
                    maxWidth: '600px',
                    mx: 'auto',
                    mb: 4,
                    lineHeight: 1.5,
                  }}
                >
                  Веб-камера + компьютерное зрение. Работайте, а AI позаботится о вашей спине.
                </Typography>

                <Stack direction="row" spacing={3} justifyContent="center" sx={{ mb: 6 }}>
                  <Button
                    variant="contained"
                    onClick={handleStart}
                    startIcon={<PlayIcon />}
                    sx={{
                      bgcolor: COLORS.primary,
                      px: 4,
                      py: 1.5,
                      borderRadius: 2,
                      textTransform: 'none',
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      '&:hover': { bgcolor: COLORS.text },
                    }}
                  >
                    Начать
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={() => navigate('/reviews')}
                    sx={{
                      borderColor: COLORS.border,
                      color: COLORS.text,
                      px: 4,
                      py: 1.5,
                      borderRadius: 2,
                      textTransform: 'none',
                      fontSize: '0.875rem',
                      '&:hover': { borderColor: COLORS.text, bgcolor: 'transparent' },
                    }}
                  >
                    Отзывы
                  </Button>
                </Stack>

                {/* Trust block — логотипы */}
              
              </Box>

              {/* Features — как в исследовании Evil Martians: понятные блоки с иконками [citation:6] */}
              <Grid container spacing={4} sx={{ mb: 12 }}>
                {[
                  { icon: <TimelineIcon />, title: '33 точки', desc: 'Ключевые точки тела с точностью до миллиметра' },
                  { icon: <SpeedIcon />, title: '<0.2c', desc: 'Задержка анализа' },
                  { icon: <NotificationsIcon />, title: '24/7', desc: 'Умные уведомления' },
                ].map((f, i) => (
                  <Grid item xs={4} key={i}>
                    <Box sx={{ textAlign: 'center' }}>
                      <Box sx={{ color: COLORS.text, mb: 1 }}>{f.icon}</Box>
                      <Typography sx={{ fontWeight: 600, mb: 0.5 }}>{f.title}</Typography>
                      <Typography variant="body2" sx={{ color: COLORS.textLight }}>{f.desc}</Typography>
                    </Box>
                  </Grid>
                ))}
              </Grid>

              {/* Отзывы — чистые карточки как у Vercel */}
              <Box>
                <Typography variant="h5" sx={{ fontWeight: 600, textAlign: 'center', mb: 1 }}>
                  Что говорят пользователи
                </Typography>
                <Typography sx={{ textAlign: 'center', color: COLORS.textLight, mb: 6 }}>
                  10 000+ довольных пользователей
                </Typography>

                <ReviewCarousel
                  limit={5}
                  autoPlay
                  showControls
                  onReviewClick={() => navigate('/reviews')}
                />

                <Stack direction="row" justifyContent="center" spacing={2} sx={{ mt: 4 }}>
                  <Button
                    variant="outlined"
                    onClick={() => navigate('/reviews')}
                    sx={{ borderColor: COLORS.border, color: COLORS.text, textTransform: 'none' }}
                  >
                    Все отзывы
                  </Button>
                  {user && (
                    <Button
                      variant="contained"
                      onClick={() => navigate('/reviews')}
                      sx={{ bgcolor: COLORS.primary, textTransform: 'none' }}
                    >
                      Оставить отзыв
                    </Button>
                  )}
                </Stack>
              </Box>
            </motion.div>
          ) : (
            <motion.div key="analysis" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 4 }}>
                <Button
                  startIcon={<ArrowBackIcon />}
                  onClick={handleBack}
                  sx={{ color: COLORS.textLight, textTransform: 'none' }}
                >
                  Назад
                </Button>
                <Box>
                  <Typography sx={{ fontSize: '1.5rem', fontWeight: 600 }}>Анализ осанки</Typography>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#10B981' }} />
                    <Typography variant="caption" sx={{ color: COLORS.textLight }}>Активный мониторинг</Typography>
                  </Stack>
                </Box>
              </Stack>

              <WebcamFeed />
            </motion.div>
          )}
        </AnimatePresence>
      </Container>
    </Box>
  );
};

export default Home;