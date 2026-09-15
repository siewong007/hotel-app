import { useEffect, type FC } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { useTranslation } from '../../i18n';

const LandingPage: FC = () => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const { t } = useTranslation('common');
  const account = isAuthenticated
    ? user?.user_type === 'guest' ? 'guest' : 'admin'
    : undefined;
  const landingUrl = `/salim-inn/index.html${account ? `?account=${account}` : ''}`;

  useEffect(() => {
    if (isLoading) return;

    // The WebGL experience must own the top-level document. In an iframe it
    // can fail to initialise and leaves the homepage as an inert blank frame.
    window.location.replace(landingUrl);
  }, [isLoading, landingUrl]);

  // role="status" makes the aria-label legal (a bare div can't be named) and
  // announces the wait politely while the redirect resolves.
  return isLoading ? <div role="status" aria-label={t('aria.loadingPage')} /> : null;
};

export default LandingPage;
