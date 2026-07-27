import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getEkycStatus: vi.fn(),
  uploadEkycDocument: vi.fn(),
  submitEkycVerification: vi.fn(),
}));

vi.mock('../../api/guestPortalDashboard.service', () => ({
  GuestPortalDashboardService: {
    getEkycStatus: (...args: unknown[]) => mocks.getEkycStatus(...args),
    uploadEkycDocument: (...args: unknown[]) => mocks.uploadEkycDocument(...args),
    submitEkycVerification: (...args: unknown[]) => mocks.submitEkycVerification(...args),
  },
}));

import { IdentitySection } from './IdentitySection';

describe('IdentitySection', () => {
  beforeEach(() => {
    mocks.getEkycStatus.mockReset();
    mocks.uploadEkycDocument.mockReset();
    mocks.submitEkycVerification.mockReset();
  });

  afterEach(cleanup);

  it('shows the capture form when the guest has never submitted', async () => {
    mocks.getEkycStatus.mockResolvedValue(null);

    render(<IdentitySection token="guest-token" />);

    expect(await screen.findByRole('button', { name: /Submit for verification/ })).toBeTruthy();
    expect(mocks.getEkycStatus).toHaveBeenCalledWith('guest-token');
  });

  it('hides the form while a submission is still under review, because a second one would be rejected', async () => {
    mocks.getEkycStatus.mockResolvedValue({
      id: 1,
      status: 'pending_manual_review',
      submitted_at: '2026-07-20T08:00:00Z',
    });

    render(<IdentitySection token="guest-token" />);

    expect(await screen.findByText('Under review')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Submit for verification/ })).toBeNull();
  });

  it('shows the verified state without a form', async () => {
    mocks.getEkycStatus.mockResolvedValue({ id: 2, status: 'approved' });

    render(<IdentitySection token="guest-token" />);

    expect(await screen.findByText('Verified')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Submit for verification/ })).toBeNull();
  });

  it('lets the guest resubmit when more information is required, and surfaces the reviewer note', async () => {
    mocks.getEkycStatus.mockResolvedValue({
      id: 3,
      status: 'additional_information_required',
      customer_message: 'The photo of your passport was too blurry to read.',
    });

    render(<IdentitySection token="guest-token" />);

    expect(await screen.findByText('More information needed')).toBeTruthy();
    expect(screen.getByText('The photo of your passport was too blurry to read.')).toBeTruthy();
    // The whole point of this status is that the guest can act on it.
    expect(screen.getByRole('button', { name: /Submit for verification/ })).toBeTruthy();
  });

  // exists_open_for_guest excludes 'rejected', so the API accepts a fresh
  // submission. The UI must not be stricter than the endpoint behind it.
  it('lets the guest try again after a rejection, matching what the API allows', async () => {
    mocks.getEkycStatus.mockResolvedValue({ id: 4, status: 'rejected' });

    render(<IdentitySection token="guest-token" />);

    expect(await screen.findByText('Not accepted')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Submit for verification/ })).toBeTruthy();
  });

  it('does not demand an ID back photo when the ID type is a passport', async () => {
    mocks.getEkycStatus.mockResolvedValue(null);

    render(<IdentitySection token="guest-token" />);

    // Passport is the default: submitting surfaces the missing fields, but the
    // ID-back photo must not be among them.
    fireEvent.click(await screen.findByRole('button', { name: /Submit for verification/ }));
    await waitFor(() => {
      expect(screen.getByText('Please complete the highlighted fields before submitting.')).toBeTruthy();
    });
    expect(screen.queryByText('ID back photo is required.')).toBeNull();
    expect(mocks.submitEkycVerification).not.toHaveBeenCalled();
  });

  it('uploads a document as soon as it is picked and marks the slot', async () => {
    mocks.getEkycStatus.mockResolvedValue(null);
    mocks.uploadEkycDocument.mockResolvedValue({
      success: true,
      file_path: 'private_uploads/ekyc/42_id_front_x.jpg',
      filename: 'private_uploads/ekyc/42_id_front_x.jpg',
      document_type: 'id_front',
    });

    render(<IdentitySection token="guest-token" />);
    await screen.findByRole('button', { name: /Submit for verification/ });

    const file = new File(['bytes'], 'front.jpg', { type: 'image/jpeg' });
    const inputs = document.querySelectorAll('input[type="file"]');
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { files: [file] } });

    await waitFor(() => {
      expect(mocks.uploadEkycDocument).toHaveBeenCalledWith(file, 'id_front', 'guest-token');
    });
    expect(await screen.findByText('Uploaded')).toBeTruthy();
  });

  // A 429 from the guest_portal_ekyc limiter and a 403 from a deactivated
  // account both land in the upload catch. Telling the guest to "try a
  // different photo" would be wrong and unactionable for both.
  it('surfaces the server message when an upload is refused', async () => {
    mocks.getEkycStatus.mockResolvedValue(null);
    mocks.uploadEkycDocument.mockRejectedValue(
      new Error('Too many verification attempts. Please try again in 540 seconds.'),
    );

    render(<IdentitySection token="guest-token" />);
    await screen.findByRole('button', { name: /Submit for verification/ });

    const inputs = document.querySelectorAll('input[type="file"]');
    fireEvent.change(inputs[0] as HTMLInputElement, {
      target: { files: [new File(['b'], 'f.jpg', { type: 'image/jpeg' })] },
    });

    expect(
      await screen.findByText('Too many verification attempts. Please try again in 540 seconds.'),
    ).toBeTruthy();
    expect(screen.queryByText(/try a different photo/)).toBeNull();
  });

  it('offers a retry when the status cannot be loaded', async () => {
    mocks.getEkycStatus.mockRejectedValue(new Error('network down'));

    render(<IdentitySection token="guest-token" />);

    expect(await screen.findByText('Unable to load your verification status right now.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
