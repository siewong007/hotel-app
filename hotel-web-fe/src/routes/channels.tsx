import { createFileRoute } from '@tanstack/react-router';

import ChannelsPage from '../features/channels/pages/ChannelsPage';

export const Route = createFileRoute('/channels')({
  component: ChannelsPage,
});
