// Small line icons for the main toolbar. Keep their size independent of the
// host page's font so they retain the same geometry inside the overflow panel.
const svg = (body: string) =>
  `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export function toolbarAlignmentIcon(value: string): string {
  const short = value === "center" ? 'x1="4" x2="12"' : value === "right" ? 'x1="6" x2="14"' : 'x1="2" x2="10"';
  const second = value === "justify" ? 'x1="2" x2="14"' : short;
  return svg(`<path d="M2 3h12M2 9h12"/><line ${second} y1="6" y2="6"/><line ${second} y1="12" y2="12"/>`);
}

export const toolbarIndentIcon = svg('<path d="M2 3h12M7 6h7M7 9h7M2 12h12M2 6l2.5 1.5L2 9z"/>');

export const toolbarLineHeightIcon = svg(
  '<path d="M7 3h7M7 6.3h7M7 9.7h7M7 13h7M3.5 2.5v11M2 4l1.5-1.5L5 4M2 12l1.5 1.5L5 12"/>',
);

export const toolbarTranslationIcon = `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><text x="0" y="11" font-size="10">文</text><text x="8" y="14" font-size="9">A</text></svg>`;

export const toolbarWritingIcon = svg(
  '<path d="m6 2 1.3 3.7L11 7l-3.7 1.3L6 12 4.7 8.3 1 7l3.7-1.3zM12.5 1v4M10.5 3h4M11 10h3M9 13h5"/>',
);
