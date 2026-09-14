import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isPhone: false }));
vi.mock('@mui/material', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mui/material')>();
  return { ...actual, useMediaQuery: () => mocks.isPhone };
});
import { CollapsibleSection } from './CollapsibleSection';

describe('CollapsibleSection', () => {
  beforeEach(() => { mocks.isPhone = false; });
  afterEach(cleanup);

  it('starts expanded by default: children render and the header button is aria-expanded', () => {
    render(
      <CollapsibleSection title="Details">
        <div>Body content</div>
      </CollapsibleSection>,
    );
    const header = screen.getByRole('button', { name: 'Details' });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Body content')).toBeTruthy();
  });

  it('collapseOnPhone on a phone starts collapsed with an Expand chevron', () => {
    mocks.isPhone = true;
    render(
      <CollapsibleSection title="Details" collapseOnPhone>
        <div>Body content</div>
      </CollapsibleSection>,
    );
    expect(screen.queryByText('Body content')).toBeNull();
    const chevron = screen.getByRole('button', { name: 'Expand' });
    expect(chevron.getAttribute('aria-expanded')).toBe('false');
  });

  it('collapseOnPhone on desktop still starts expanded', () => {
    render(
      <CollapsibleSection title="Details" collapseOnPhone>
        <div>Body content</div>
      </CollapsibleSection>,
    );
    expect(screen.getByText('Body content')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Details' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('toggles when the header is clicked', async () => {
    render(
      <CollapsibleSection title="Details">
        <div>Body content</div>
      </CollapsibleSection>,
    );
    const header = screen.getByRole('button', { name: 'Details' });
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(screen.queryByText('Body content')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(screen.getByText('Body content')).toBeTruthy();
    expect(header.getAttribute('aria-expanded')).toBe('true');
  });

  it('does not toggle when header actions are clicked', () => {
    const onAction = vi.fn();
    render(
      <CollapsibleSection
        title="Details"
        actions={<button type="button" onClick={onAction}>Act</button>}
      >
        <div>Body content</div>
      </CollapsibleSection>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Act' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Details' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Body content')).toBeTruthy();
  });
});
