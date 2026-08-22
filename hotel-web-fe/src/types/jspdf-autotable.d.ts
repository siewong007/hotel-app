// Module augmentation (NOT an ambient replacement): jspdf-autotable attaches
// `lastAutoTable` to the jsPDF instance at runtime, but the shipped jspdf
// types don't declare it. Interface-of-same-name merges onto the exported
// class's instance side.
//
// Kept in its own file because a top-level `import` makes this a module;
// putting it in vite-env.d.ts would turn that file's other global
// declarations into module-scoped ones and break them.
import 'jspdf';

declare module 'jspdf' {
  interface jsPDF {
    lastAutoTable: { finalY: number };
  }
}
