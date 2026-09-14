import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rooms: { data: [] as unknown[], isLoading: false, isPending: false, error: null as unknown },
  roomTypes: { data: [] as unknown[], isLoading: false, isPending: false, error: null as unknown },
}));

const emptyMutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

vi.mock('../../../hooks/useCurrency', () => ({
  useCurrency: () => ({ format: (n: number) => `RM${n}`, symbol: 'RM', currency: 'MYR' }),
}));

vi.mock('../hooks/useRoomQueries', () => ({
  useRooms: () => mocks.rooms,
  useAllRoomTypes: () => mocks.roomTypes,
  useCreateRoom: () => emptyMutation,
  useUpdateRoom: () => emptyMutation,
  useDeleteRoom: () => emptyMutation,
  useCreateRoomType: () => emptyMutation,
  useUpdateRoomType: () => emptyMutation,
  useDeleteRoomType: () => emptyMutation,
  useUploadRoomTypeImage: () => emptyMutation,
}));

import RoomConfigurationPage from './RoomConfigurationPage';
import { expectNoCriticalAxeViolations } from '../../../test/axe';

describe('RoomConfigurationPage', () => {
  beforeEach(() => {
    mocks.rooms = { data: [], isLoading: false, isPending: false, error: null };
    mocks.roomTypes = { data: [], isLoading: false, isPending: false, error: null };
  });

  afterEach(cleanup);

  it('renders the room configuration workspace', () => {
    render(<RoomConfigurationPage />);
    expect(document.body.textContent?.length).toBeGreaterThan(0);
  });

  it('reports no critical axe violations', async () => {
    const { container } = render(<RoomConfigurationPage />);
    await expectNoCriticalAxeViolations(container);
  });
});
