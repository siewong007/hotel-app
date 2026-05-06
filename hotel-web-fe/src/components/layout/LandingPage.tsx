import React, { useEffect, useState } from 'react';
import { Box, Button, Container, Typography, Fade, Slide } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { keyframes } from '@mui/system';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import BedIcon from '@mui/icons-material/Bed';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import SpaIcon from '@mui/icons-material/Spa';
import PoolIcon from '@mui/icons-material/Pool';
import { getHotelSettings } from '../../utils/hotelSettings';

// Smooth scroll reveal animation
const fadeInUp = keyframes`
  from {
    opacity: 0;
    transform: translateY(40px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

// Parallax background animation
const parallaxFloat = keyframes`
  0%, 100% {
    transform: translateY(0px);
  }
  50% {
    transform: translateY(-20px);
  }
`;

// Shimmer effect for modern feel
const shimmer = keyframes`
  0% {
    background-position: -1000px 0;
  }
  100% {
    background-position: 1000px 0;
  }
`;

const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const hotelSettings = getHotelSettings();
  const [scrolled, setScrolled] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(true);

    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const amenities = [
    { icon: <BedIcon sx={{ fontSize: 48 }} />, title: 'Luxury Suites', desc: 'Premium comfort' },
    { icon: <RestaurantIcon sx={{ fontSize: 48 }} />, title: 'Fine Dining', desc: 'Culinary excellence' },
    { icon: <SpaIcon sx={{ fontSize: 48 }} />, title: 'Wellness Spa', desc: 'Total relaxation' },
    { icon: <PoolIcon sx={{ fontSize: 48 }} />, title: 'Infinity Pool', desc: 'Scenic views' },
  ];

  return (
    <Box
      sx={{
        minHeight: '100vh',
        width: '100%',
        overflow: 'hidden',
        background: 'var(--hotel-page-bg)',
        position: 'relative',
        color: 'var(--hotel-text-primary)',
      }}
    >
      {/* Animated background overlay */}
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'var(--hotel-soft-glow)',
          animation: `${parallaxFloat} 20s ease-in-out infinite`,
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* Navigation Bar */}
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1000,
          transition: 'all 0.5s cubic-bezier(0.65, 0.05, 0, 1)',
          backgroundColor: scrolled ? 'var(--hotel-panel-bg)' : 'transparent',
          backdropFilter: scrolled ? 'blur(20px)' : 'none',
          borderBottom: scrolled ? '1px solid var(--hotel-divider)' : 'none',
          boxShadow: scrolled ? '0 4px 20px var(--hotel-shadow-color)' : 'none',
          py: 2,
        }}
      >
        <Container maxWidth="xl">
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {/* Unified Logo */}
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
              <Typography
                variant="h3"
                sx={{
                  fontWeight: 900,
                  letterSpacing: '-0.02em',
                  background: 'var(--hotel-action-gradient)',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  textTransform: 'uppercase',
                }}
              >
                HOTEL
              </Typography>
              <Typography
                variant="body1"
                sx={{
                  fontWeight: 600,
                  color: 'var(--hotel-accent-text)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  fontSize: '0.9rem',
                }}
              >
                {hotelSettings.hotel_name}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                variant="outlined"
                onClick={() => navigate('/login')}
                sx={{
                  borderColor: 'var(--hotel-primary)',
                  color: 'var(--hotel-primary)',
                  fontWeight: 600,
                  px: 3,
                  py: 1,
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    borderColor: 'var(--hotel-primary-dark)',
                    backgroundColor: 'var(--hotel-muted-bg)',
                    transform: 'translateY(-2px)',
                  },
                }}
              >
                Sign In
              </Button>
              <Button
                variant="contained"
                onClick={() => navigate('/register')}
                sx={{
                  background: 'var(--hotel-action-gradient)',
                  color: 'var(--hotel-on-accent)',
                  fontWeight: 700,
                  px: 3,
                  py: 1,
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    background: 'var(--hotel-action-gradient-hover)',
                    transform: 'translateY(-2px)',
                    boxShadow: '0 8px 24px var(--hotel-shadow-color)',
                  },
                }}
              >
                Book Now
              </Button>
            </Box>
          </Box>
        </Container>
      </Box>

      {/* Hero Section */}
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <Container maxWidth="lg">
          <Fade in={loaded} timeout={1000}>
            <Box sx={{ textAlign: 'center' }}>
              {/* Subtitle */}
              <Slide direction="down" in={loaded} timeout={800}>
                <Typography
                  variant="overline"
                  sx={{
                    color: 'var(--hotel-accent-text)',
                    fontSize: '1.2rem',
                    fontWeight: 600,
                    letterSpacing: '0.3em',
                    textTransform: 'uppercase',
                    mb: 3,
                    display: 'block',
                    animation: `${fadeInUp} 1s ease-out`,
                  }}
                >
                  Where Luxury Meets Hospitality
                </Typography>
              </Slide>

              {/* Main Heading */}
              <Typography
                variant="h1"
                sx={{
                  fontSize: { xs: '3.5rem', sm: '5rem', md: '7rem', lg: '8.5rem' },
                  fontWeight: 900,
                  lineHeight: 1.1,
                  mb: 4,
                  background: 'linear-gradient(135deg, var(--hotel-primary) 0%, var(--hotel-secondary) 50%, var(--hotel-primary) 100%)',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundSize: '200% auto',
                  animation: `${shimmer} 4s linear infinite, ${fadeInUp} 1.2s ease-out`,
                  letterSpacing: '-0.02em',
                }}
              >
                {hotelSettings.hotel_name.toUpperCase()}
              </Typography>

              {/* Tagline */}
              <Typography
                variant="h4"
                sx={{
                  color: 'var(--hotel-accent-text)',
                  fontSize: { xs: '1.5rem', sm: '2rem', md: '2.5rem' },
                  fontWeight: 400,
                  mb: 6,
                  maxWidth: '800px',
                  mx: 'auto',
                  animation: `${fadeInUp} 1.4s ease-out`,
                  letterSpacing: '0.05em',
                }}
              >
                Redefining Excellence in Every Stay
              </Typography>

              {/* CTA Buttons */}
              <Box
                sx={{
                  display: 'flex',
                  gap: 3,
                  justifyContent: 'center',
                  flexWrap: 'wrap',
                  animation: `${fadeInUp} 1.6s ease-out`,
                }}
              >
                <Button
                  variant="contained"
                  size="large"
                  endIcon={<ArrowForwardIcon />}
                  onClick={() => navigate('/register')}
                  sx={{
                    background: 'var(--hotel-action-gradient)',
                    color: 'var(--hotel-on-accent)',
                    fontSize: '1.1rem',
                    fontWeight: 700,
                    px: 5,
                    py: 2,
                    borderRadius: 2,
                    transition: 'all 0.4s cubic-bezier(0.65, 0.05, 0, 1)',
                    '&:hover': {
                      background: 'var(--hotel-action-gradient-hover)',
                      transform: 'translateY(-4px) scale(1.05)',
                      boxShadow: '0 12px 32px var(--hotel-shadow-color)',
                    },
                  }}
                >
                  Reserve Your Suite
                </Button>
                <Button
                  variant="outlined"
                  size="large"
                  onClick={() => navigate('/login')}
                  sx={{
                    borderColor: 'var(--hotel-secondary)',
                    color: 'var(--hotel-secondary)',
                    fontSize: '1.1rem',
                    fontWeight: 600,
                    px: 5,
                    py: 2,
                    borderRadius: 2,
                    borderWidth: 2,
                    transition: 'all 0.4s cubic-bezier(0.65, 0.05, 0, 1)',
                    '&:hover': {
                      borderColor: 'var(--hotel-secondary-dark)',
                      backgroundColor: 'var(--hotel-muted-bg)',
                      transform: 'translateY(-4px)',
                      borderWidth: 2,
                    },
                  }}
                >
                  Explore Amenities
                </Button>
              </Box>

              {/* Scroll indicator */}
              <Box
                sx={{
                  position: 'absolute',
                  bottom: 40,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  animation: `${parallaxFloat} 3s ease-in-out infinite`,
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    color: 'var(--hotel-accent-text)',
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase',
                    display: 'block',
                    mb: 1,
                    fontWeight: 600,
                  }}
                >
                  Scroll to Discover
                </Typography>
                <Box
                  sx={{
                    width: 2,
                    height: 40,
                    background: 'linear-gradient(to bottom, var(--hotel-primary), transparent)',
                    mx: 'auto',
                  }}
                />
              </Box>
            </Box>
          </Fade>
        </Container>
      </Box>

      {/* Amenities Section */}
      <Box
        sx={{
          py: 15,
          position: 'relative',
          zIndex: 1,
          borderTop: '1px solid var(--hotel-divider)',
          backgroundColor: 'var(--hotel-panel-bg)',
        }}
      >
        <Container maxWidth="xl">
          <Typography
            variant="h2"
            sx={{
              textAlign: 'center',
              fontSize: { xs: '2.5rem', md: '4rem' },
              fontWeight: 700,
              mb: 8,
              background: 'var(--hotel-action-gradient)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: '-0.02em',
            }}
          >
            Premium Amenities
          </Typography>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' },
              gap: 4,
            }}
          >
            {amenities.map((amenity, index) => (
              <Box
                key={index}
                sx={{
                  textAlign: 'center',
                  p: 4,
                  borderRadius: 3,
                  background: 'var(--hotel-muted-bg)',
                  border: '1px solid var(--hotel-divider)',
                  transition: 'all 0.4s cubic-bezier(0.65, 0.05, 0, 1)',
                  cursor: 'pointer',
                  '&:hover': {
                    transform: 'translateY(-12px)',
                    background: 'var(--hotel-subtle-bg)',
                    border: '1px solid var(--hotel-primary)',
                    boxShadow: '0 16px 48px var(--hotel-shadow-color)',
                  },
                }}
              >
                <Box sx={{ color: 'var(--hotel-primary)', mb: 2 }}>{amenity.icon}</Box>
                <Typography
                  variant="h5"
                  sx={{
                    fontWeight: 700,
                    color: 'var(--hotel-accent-text)',
                    mb: 1,
                  }}
                >
                  {amenity.title}
                </Typography>
                <Typography
                  variant="body1"
                  sx={{
                    color: 'var(--hotel-text-secondary)',
                  }}
                >
                  {amenity.desc}
                </Typography>
              </Box>
            ))}
          </Box>
        </Container>
      </Box>

      {/* Final CTA Section */}
      <Box
        sx={{
          py: 15,
          position: 'relative',
          zIndex: 1,
          borderTop: '1px solid var(--hotel-divider)',
        }}
      >
        <Container maxWidth="md">
          <Box sx={{ textAlign: 'center' }}>
            <Typography
              variant="h2"
              sx={{
                fontSize: { xs: '2.5rem', md: '4.5rem' },
                fontWeight: 700,
                mb: 3,
                background: 'var(--hotel-action-gradient)',
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                letterSpacing: '-0.02em',
              }}
            >
              Begin Your Journey
            </Typography>
            <Typography
              variant="h5"
              sx={{
                color: 'var(--hotel-accent-text)',
                mb: 6,
                fontWeight: 400,
              }}
            >
              Experience unparalleled luxury and service at {hotelSettings.hotel_name}
            </Typography>
            <Button
              variant="contained"
              size="large"
              endIcon={<ArrowForwardIcon />}
              onClick={() => navigate('/register')}
              sx={{
                background: 'var(--hotel-action-gradient)',
                color: 'var(--hotel-on-accent)',
                fontSize: '1.2rem',
                fontWeight: 700,
                px: 6,
                py: 2.5,
                borderRadius: 2,
                transition: 'all 0.4s cubic-bezier(0.65, 0.05, 0, 1)',
                '&:hover': {
                  background: 'var(--hotel-action-gradient-hover)',
                  transform: 'translateY(-4px) scale(1.05)',
                  boxShadow: '0 16px 48px var(--hotel-shadow-color)',
                },
              }}
            >
              Book Your Stay Now
            </Button>
          </Box>
        </Container>
      </Box>

      {/* Footer */}
      <Box
        sx={{
          py: 6,
          borderTop: '1px solid var(--hotel-divider)',
          position: 'relative',
          zIndex: 1,
          backgroundColor: 'var(--hotel-panel-bg)',
        }}
      >
        <Container maxWidth="xl">
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 3,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5 }}>
              <Typography
                variant="h5"
                sx={{
                  fontWeight: 900,
                  letterSpacing: '-0.02em',
                  background: 'var(--hotel-action-gradient)',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  textTransform: 'uppercase',
                }}
              >
                HOTEL
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 600,
                  color: 'var(--hotel-accent-text)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                }}
              >
                {hotelSettings.hotel_name}
              </Typography>
            </Box>
            <Typography variant="body2" sx={{ color: 'var(--hotel-text-secondary)' }}>
              © 2025 {hotelSettings.hotel_name}. All rights reserved. | Crafted with excellence
            </Typography>
          </Box>
        </Container>
      </Box>
    </Box>
  );
};

export default LandingPage;
