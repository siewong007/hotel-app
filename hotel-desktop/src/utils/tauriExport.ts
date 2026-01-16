/**
 * File export utilities for Tauri desktop app
 * Uses Tauri invoke command for native save dialog
 */

// Check if running in Tauri
const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

interface SaveFileOptions {
  filename: string;
  content: string | Blob;
  mimeType?: string;
}

/**
 * Convert content to Uint8Array for Tauri command
 */
async function contentToBytes(content: string | Blob): Promise<number[]> {
  if (content instanceof Blob) {
    const arrayBuffer = await content.arrayBuffer();
    return Array.from(new Uint8Array(arrayBuffer));
  } else {
    // Convert string to UTF-8 bytes
    const encoder = new TextEncoder();
    return Array.from(encoder.encode(content));
  }
}

/**
 * Save content to a file using Tauri or browser download
 */
export async function saveFile({ filename, content, mimeType }: SaveFileOptions): Promise<boolean> {
  console.log('saveFile called:', { filename, mimeType, isTauri });
  alert(`saveFile called - isTauri: ${isTauri}, filename: ${filename}`);

  if (isTauri) {
    try {
      console.log('Using Tauri save_file_direct command...');
      alert('Attempting Tauri save...');

      // Dynamic import of Tauri invoke
      const { invoke } = await import('@tauri-apps/api/core');
      console.log('Tauri invoke imported successfully');

      // Convert content to bytes
      const contentBytes = await contentToBytes(content);
      console.log('Content bytes length:', contentBytes.length);
      alert(`Content prepared: ${contentBytes.length} bytes`);

      // Call Tauri command to save directly to Downloads
      const result = await invoke<string>('save_file_direct', {
        filename,
        content: contentBytes,
      });

      console.log('File saved to:', result);
      alert(`File saved successfully to:\n${result}`);
      return true;
    } catch (error: any) {
      console.error('Tauri save error:', error);
      alert(`Tauri save error: ${JSON.stringify(error)}`);
      // Fall back to browser download
      return browserDownload({ filename, content, mimeType });
    }
  } else {
    console.log('Not in Tauri, using browser download');
    return browserDownload({ filename, content, mimeType });
  }
}

/**
 * Browser-based file download fallback
 */
function browserDownload({ filename, content, mimeType }: SaveFileOptions): boolean {
  try {
    console.log('Browser download:', filename);
    const blob = content instanceof Blob
      ? content
      : new Blob([content], { type: mimeType || 'text/plain' });

    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    }, 100);

    console.log('Browser download initiated');
    return true;
  } catch (error) {
    console.error('Browser download error:', error);
    alert(`Download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return false;
  }
}

/**
 * Export data as CSV file
 */
export async function exportToCsv(
  data: string[][],
  filename: string = 'export.csv'
): Promise<boolean> {
  const csv = data.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
  return saveFile({ filename, content: csv, mimeType: 'text/csv' });
}

/**
 * Export PDF blob
 */
export async function exportPdfBlob(
  pdfBlob: Blob,
  filename: string = 'export.pdf'
): Promise<boolean> {
  return saveFile({ filename, content: pdfBlob, mimeType: 'application/pdf' });
}
