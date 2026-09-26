import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ childMatches: [] as unknown[] }));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  Outlet: () => <div>channel detail outlet</div>,
  useChildMatches: () => mocks.childMatches,
}));

vi.mock('./renderRouteFromRegistry', () => ({
  RouteById: ({ id }: { id: string }) => <div>registry page {id}</div>,
}));

import { ChannelsRouteComponent } from '../routes/channels';

describe('/channels route', () => {
  afterEach(() => {
    cleanup();
    mocks.childMatches = [];
  });

  it('renders the channel list when /channels is the leaf match', () => {
    render(<ChannelsRouteComponent />);
    expect(screen.getByText('registry page channels')).toBeTruthy();
    expect(screen.queryByText('channel detail outlet')).toBeNull();
  });

  it('hands the surface to /channels/$channelId through the Outlet', () => {
    mocks.childMatches = [{ routeId: '/channels/$channelId' }];
    render(<ChannelsRouteComponent />);
    expect(screen.getByText('channel detail outlet')).toBeTruthy();
    expect(screen.queryByText('registry page channels')).toBeNull();
  });
});
