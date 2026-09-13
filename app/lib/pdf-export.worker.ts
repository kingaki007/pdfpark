/// <reference lib="webworker" />
import { assemblePdf } from "./pdf-export";
import type { EditorPage } from "./editor-model";
self.onmessage = async (
  event: MessageEvent<{
    pages: EditorPage[];
    sources: Record<string, Uint8Array>;
    overlays: Record<string, Uint8Array | null>;
  }>,
) => {
  const { pages, sources, overlays } = event.data;
  try {
    const bytes = await assemblePdf(
      pages,
      (id) => sources[id],
      async (page) => overlays[page.id],
    );
    self.postMessage({ bytes }, { transfer: [bytes.buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "PDF export failed." });
  }
};
