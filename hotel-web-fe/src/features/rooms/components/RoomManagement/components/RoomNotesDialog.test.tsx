// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import RoomNotesDialog from './RoomNotesDialog';

describe('RoomNotesDialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the provided room notes in the controlled input', () => {
    render(
      <RoomNotesDialog
        open
        onClose={vi.fn()}
        roomNumber="101"
        notes="Existing test note"
        onNotesChange={vi.fn()}
        onSave={vi.fn()}
        saving={false}
      />,
    );

    expect((screen.getByPlaceholderText('Enter room notes...') as HTMLTextAreaElement).value).toBe('Existing test note');
    expect(screen.getByText('Room Notes - 101')).toBeDefined();
  });

  it('emits changes and allows blank-note saves', () => {
    const onNotesChange = vi.fn();
    const onSave = vi.fn();

    render(
      <RoomNotesDialog
        open
        onClose={vi.fn()}
        roomNumber="101"
        notes="Existing test note"
        onNotesChange={onNotesChange}
        onSave={onSave}
        saving={false}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Enter room notes...'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(onNotesChange).toHaveBeenCalledWith('');
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('disables saving while a save is already in progress', () => {
    render(
      <RoomNotesDialog
        open
        onClose={vi.fn()}
        roomNumber="101"
        notes="Existing test note"
        onNotesChange={vi.fn()}
        onSave={vi.fn()}
        saving
      />,
    );

    expect((screen.getByRole('button', { name: /saving/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
