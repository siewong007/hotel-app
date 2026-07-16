import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupportConversationSummary } from '../types';
import SupportConversationList from './SupportConversationList';

function buildConversation(overrides: Partial<SupportConversationSummary> = {}): SupportConversationSummary {
  return {
    id: 42,
    conversation_number: 'SUP-0042',
    guest_id: 8,
    guest_name: 'Aisha Rahman',
    booking_reference: 'BK-1008',
    room_number: '504',
    category: 'stay',
    status: 'waiting_for_staff',
    priority: 'high',
    queue: 'front_desk',
    assigned_to_user_id: 7,
    assigned_to_name: 'Mina Lee',
    escalation_level: 0,
    escalated_at: null,
    first_response_due_at: '2026-07-15T10:30:00Z',
    resolution_due_at: null,
    first_response_at: null,
    resolved_at: null,
    closed_at: null,
    last_message_preview: 'Could I have extra towels?',
    last_message_at: '2026-07-15T10:00:00Z',
    last_activity_at: '2026-07-15T10:00:00Z',
    unread_count: 2,
    is_sla_at_risk: true,
    is_sla_breached: false,
    version: 3,
    ...overrides,
  };
}

function renderList(overrides: Partial<React.ComponentProps<typeof SupportConversationList>> = {}) {
  const props: React.ComponentProps<typeof SupportConversationList> = {
    conversations: [buildConversation()],
    selectedConversationId: undefined,
    isLoading: false,
    isFetching: false,
    total: 21,
    page: 1,
    pageSize: 20,
    onSelect: vi.fn(),
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    ...overrides,
  };

  render(<SupportConversationList {...props} />);
  return props;
}

describe('SupportConversationList', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows operational context for a conversation and selects the clicked row', () => {
    const props = renderList();

    expect(screen.getByText('Aisha Rahman')).toBeDefined();
    expect(screen.getByText('SUP-0042 · Stay')).toBeDefined();
    expect(screen.getByText('Could I have extra towels?')).toBeDefined();
    expect(screen.getByText('SLA at risk')).toBeDefined();
    expect(screen.getByText('2 unread')).toBeDefined();
    expect(screen.getByText('Assigned to Mina Lee · Room 504')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /aisha rahman/i }));
    expect(props.onSelect).toHaveBeenCalledWith(42);
  });

  it('uses the server page number and lets staff change pages and page size', () => {
    const props = renderList({ page: 2, pageSize: 20, total: 41 });

    fireEvent.click(screen.getByRole('button', { name: /go to previous page/i }));
    fireEvent.click(screen.getByRole('button', { name: /go to next page/i }));
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /per page/i }));
    fireEvent.click(screen.getByRole('option', { name: '50' }));

    expect(props.onPageChange).toHaveBeenNthCalledWith(1, 1);
    expect(props.onPageChange).toHaveBeenNthCalledWith(2, 3);
    expect(props.onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it('handles loading, refreshing, and empty queues without presenting stale rows', () => {
    const loading = renderList({ conversations: [], isLoading: true, total: 0 });
    expect(screen.getByText('Loading conversations…')).toBeDefined();
    expect(screen.queryByText('No conversations found')).toBeNull();
    cleanup();

    renderList({ conversations: [], isLoading: false, isFetching: true, total: 0 });
    expect(screen.getByText('Refreshing…')).toBeDefined();
    expect(screen.getByText('No conversations found')).toBeDefined();
    expect(loading.onSelect).not.toHaveBeenCalled();
  });
});
