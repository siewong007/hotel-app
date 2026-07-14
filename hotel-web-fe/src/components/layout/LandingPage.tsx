import type { FC } from 'react';

const LandingPage: FC = () => (
  <iframe
    src="/salim-inn/index.html"
    title="Salim Inn interactive homepage"
    style={{
      display: 'block',
      width: '100%',
      height: '100dvh',
      border: 0,
      background: '#06110e',
    }}
  />
);

export default LandingPage;
