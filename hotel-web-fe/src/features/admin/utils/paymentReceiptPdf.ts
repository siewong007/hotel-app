const PDF_CONTENT_TYPE = 'application/pdf';
const PDF_MARGIN_MM = 12;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to convert the receipt image to a PDF.'));
    image.src = url;
  });
}

/**
 * Returns a PDF suitable for viewing in the browser. Existing PDF uploads are
 * returned untouched; supported image uploads are embedded in a single-page PDF.
 */
export async function receiptAsPdf(receipt: Blob): Promise<Blob> {
  if (receipt.type.toLowerCase().startsWith(PDF_CONTENT_TYPE)) {
    return receipt;
  }

  if (!receipt.type.toLowerCase().startsWith('image/')) {
    throw new Error('This receipt is not a PDF or supported image file.');
  }

  const imageUrl = URL.createObjectURL(receipt);
  try {
    const image = await loadImage(imageUrl);
    const { jsPDF } = await import('jspdf');
    const orientation = image.naturalWidth > image.naturalHeight ? 'landscape' : 'portrait';
    const document = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
    const pageWidth = document.internal.pageSize.getWidth();
    const pageHeight = document.internal.pageSize.getHeight();
    const maxWidth = pageWidth - PDF_MARGIN_MM * 2;
    const maxHeight = pageHeight - PDF_MARGIN_MM * 2;
    const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;

    document.addImage(
      image,
      'JPEG',
      (pageWidth - width) / 2,
      (pageHeight - height) / 2,
      width,
      height,
    );

    return document.output('blob');
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}
