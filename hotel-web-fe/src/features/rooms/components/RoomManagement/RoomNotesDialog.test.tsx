// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import RoomNotesDialog from './RoomNotesDialog';
import type { Room } from '../../../../types';

describe('RoomNotesDialog', () => {
  const mockOnClose = vi.fn();
  const mockOnSubmit = vi.fn();

  const mockRoom: Room = {
    id: '1',
    room_number: '101',
    room_type: 'Standard',
    status: 'available',
    notes: 'Existing test note',
  } as Room;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('opens with existing notes', () => {
    render(
      <RoomNotesDialog
        open={true}
        room={mockRoom}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const input = screen.getByTestId('notes-input') as HTMLTextAreaElement;
    expect(input.value).toBe('Existing test note');
  });

  it('allows blank-note submission policy', async () => {
    mockOnSubmit.mockResolvedValueOnce(undefined);

    render(
      <RoomNotesDialog
        open={true}
        room={mockRoom}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const input = screen.getByTestId('notes-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '' } });

    const saveButton = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith('');
    });
  });

  it('preserves entered text on submission failure', async () => {
    mockOnSubmit.mockRejectedValueOnce(new Error('Network error'));

    render(
      <RoomNotesDialog
        open={true}
        room={mockRoom}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const input = screen.getByTestId('notes-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'New text that should be preserved' } });

    const saveButton = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeDefined();
    });

    // The text should still be there
    expect(input.value).toBe('New text that should be preserved');
    // Dialog shouldn't close
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('prevents double-submit while saving', async () => {
    let resolvePromise: (value: void) => void;
    const slowPromise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    mockOnSubmit.mockReturnValueOnce(slowPromise);

    render(
      <RoomNotesDialog
        open={true}
        room={mockRoom}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const saveButton = screen.getByRole('button', { name: /save/i });
    
    // First click
    fireEvent.click(saveButton);
    
    expect(saveButton).toHaveProperty('disabled', true);
    
    // Attempt second click (though disabled prevents it in real browser, fireEvent doesn't strictly check disabled for button click always, but we check disabled prop)
    expect(saveButton.textContent).toBe('Saving...');

    // Resolve the promise to clean up
    resolvePromise!();
    
    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });
  });

  it('resets state when switching rooms', () => {
    const { rerender } = render(
      <RoomNotesDialog
        open={true}
        room={mockRoom}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const input = screen.getByTestId('notes-input') as HTMLTextAreaElement;
    expect(input.value).toBe('Existing test note');

    // Switch to a different room
    const newRoom = { ...mockRoom, id: '2', room_number: '102', notes: 'Different note' };
    
    rerender(
      <RoomNotesDialog
        open={true}
        room={newRoom}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    expect(input.value).toBe('Different note');
  });
});
