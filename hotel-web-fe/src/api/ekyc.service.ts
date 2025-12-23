import { HTTPError } from 'ky';
import { api, APIError } from './client';

export class EkycService {
  static async getEkycStatus(): Promise<{ status: string; submitted_at?: string } | null> {
    return await api.get('ekyc/status').json();
  }

  static async submitEkycVerification(data: any): Promise<void> {
    try {
      await api.post('ekyc/submit', { json: data });
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'eKYC submission failed',
          error.response.status,
          errorData
        );
      }
      throw new APIError('eKYC submission failed');
    }
  }

  static async getEkycVerificationDetails(): Promise<any> {
    return await api.get('ekyc/my-verification').json();
  }

  static async getAllEkycVerifications(): Promise<any[]> {
    return await api.get('ekyc/verifications').json();
  }

  static async updateEkycVerification(verificationId: number, updates: any): Promise<void> {
    await api.patch(`ekyc/verifications/${verificationId}`, { json: updates });
  }

  static async approveEkycVerification(verificationId: number): Promise<void> {
    await api.post(`ekyc/verifications/${verificationId}/approve`);
  }

  static async rejectEkycVerification(verificationId: number, reason: string): Promise<void> {
    await api.post(`ekyc/verifications/${verificationId}/reject`, { json: { reason } });
  }

  static async uploadEkycDocument(file: File, documentType: string): Promise<{ filename: string }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('document_type', documentType);

    try {
      const response = await api.post('ekyc/upload-document', { body: formData });
      return await response.json();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Document upload failed',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Document upload failed');
    }
  }
}
