import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GuestFaq } from './GuestFaq';
import { SALIM_INN_MAPS_URL } from '../salimInnPlace';

describe('GuestFaq', () => {
  it('lists the published stay answers and opens the entrance in Google Maps', async () => {
    render(<GuestFaq />);
    expect(screen.getByRole('heading', { name: 'Good to know' })).toBeTruthy();
    expect(screen.getByText('What time are check-in and check-out?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'How do I confirm my identity?' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Where is Salim Inn located?' }));
    const maps = await screen.findByRole('link', { name: 'Open in Google Maps' });
    expect(maps.getAttribute('href')).toBe(SALIM_INN_MAPS_URL);
    expect(maps.getAttribute('target')).toBe('_blank');

    fireEvent.click(screen.getByRole('button', { name: 'How do I confirm my identity?' }));
    const identity = await screen.findByRole('link', { name: 'Open Identity' });
    expect(identity.getAttribute('href')).toBe('/guest-portal?section=identity');
  });
});
