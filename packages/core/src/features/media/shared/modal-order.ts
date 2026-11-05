export const topMediaModal = (doc: Document) =>
  [...doc.querySelectorAll<HTMLElement>(".semlo-editor-gallery-lightbox")].at(-1) ??
  [...doc.querySelectorAll<HTMLElement>(".semlo-editor-gallery-dialog-overlay")].at(-1);
