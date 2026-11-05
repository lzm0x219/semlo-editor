let diagramId = 0;

/** Render Mermaid source locally without enabling navigation or external images. */
export async function renderPele(source: string): Promise<string> {
  const { renderAsync } = await import("pele/lazy");
  return (await renderAsync(source, { idPrefix: `semlo-editor-pele-${++diagramId}`, links: false, images: false })).svg;
}
