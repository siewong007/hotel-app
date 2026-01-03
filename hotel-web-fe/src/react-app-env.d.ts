/// <reference types="react-scripts" />

declare module 'jspdf' {
  export class jsPDF {
    constructor(options?: {
      orientation?: 'portrait' | 'landscape';
      unit?: 'pt' | 'mm' | 'cm' | 'in';
      format?: string | [number, number];
    });
    text(text: string, x: number, y: number, options?: object): jsPDF;
    setFontSize(size: number): jsPDF;
    setFont(fontName: string, fontStyle?: string): jsPDF;
    save(filename: string): jsPDF;
    autoTable(options: object): jsPDF;
    lastAutoTable: { finalY: number };
  }
}

declare module 'jspdf-autotable' {
  export default function autoTable(doc: unknown, options: object): void;
}
