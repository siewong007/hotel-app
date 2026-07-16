import { useEffect, type FC } from 'react';
import { useAuth } from '../../auth/AuthContext';

const LandingPage: FC = () => {
  const { isAuthenticated, user } = useAuth();
  const isGuest = isAuthenticated && user?.user_type === 'guest';
  const landingUrl = `/salim-inn/index.html${isGuest ? '?guest=1' : ''}`;

  useEffect(() => {
    // The WebGL experience must own the top-level document. In an iframe it
    // can fail to initialise and leaves the homepage as an inert blank frame.
    window.location.replace(landingUrl);
  }, [landingUrl]);

  return null;
};

export default LandingPage;
