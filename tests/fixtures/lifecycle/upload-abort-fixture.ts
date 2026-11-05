import { createDatabaseData } from "../../../packages/core/src/features/database/model";
import { uploadAttachments } from "../../../packages/core/src/features/media/attachment/uploads";
import { createGalleryUploads } from "../../../packages/core/src/features/media/gallery/uploads";
import { uploadImages } from "../../../packages/core/src/features/media/image/uploads";
import { createEditor } from "../../../packages/core/src/index";
import type { EditorController } from "../../../packages/core/src/types";

type Request = {
  name: string;
  signal: AbortSignal | undefined;
  resolve: (url: string) => void;
  reject: (error: unknown) => void;
};
type Fixture = {
  first: EditorController;
  second: EditorController;
  database: EditorController;
  galleryEditor: EditorController;
  requests: Request[];
  errors: string[];
  start(kind: "image" | "attachment", editor: "first" | "second", names: string[]): void;
  startGallery(name: string): () => void;
  destroyGallery(): void;
};
declare global {
  interface Window {
    mountUploadAbort?: () => void;
    uploadAbortFixture?: Fixture;
  }
}

window.mountUploadAbort = () => {
  const firstHost = document.createElement("div");
  const secondHost = document.createElement("div");
  const databaseHost = document.createElement("div");
  const galleryHost = document.createElement("div");
  databaseHost.id = "database-upload-abort";
  galleryHost.id = "gallery-upload-abort";
  document.body.replaceChildren(firstHost, secondHost, databaseHost, galleryHost);
  const first = createEditor({ element: firstHost, content: "<p>first</p>" });
  const second = createEditor({ element: secondHost, content: "<p>second</p>" });
  const requests: Request[] = [];
  const errors: string[] = [];
  const upload = (file: File, context?: { signal: AbortSignal }) =>
    new Promise<string>((resolve, reject) =>
      requests.push({ name: file.name, signal: context?.signal, resolve, reject }),
    );
  const report = (error: unknown) => errors.push(String(error));
  const gallery = createGalleryUploads({ getUpload: () => upload, onSuccess: () => {}, onError: report });
  const database = createEditor({
    element: databaseHost,
    content: {
      type: "doc",
      content: [{ type: "semloEditorDatabase", attrs: { data: createDatabaseData() } }, { type: "paragraph" }],
    },
    uploadImage: upload,
    uploadAttachment: upload,
    onError: report,
  });
  const galleryEditor = createEditor({
    element: galleryHost,
    content: {
      type: "doc",
      content: [
        {
          type: "semloEditorGallery",
          attrs: {
            data: {
              id: "gallery1",
              layout: "carousel",
              images: [{ id: "image1", src: "/first.png", title: "first", href: "" }],
            },
          },
        },
        { type: "paragraph" },
      ],
    },
    uploadImage: upload,
    onError: report,
  });
  window.uploadAbortFixture = {
    first,
    second,
    database,
    galleryEditor,
    requests,
    errors,
    start(kind, which, names) {
      const editor = which === "first" ? first.editor : second.editor;
      const files = names.map(
        (name) => new File(["content"], name, { type: kind === "image" ? "image/png" : "application/pdf" }),
      );
      if (kind === "image") uploadImages(editor, files, 1, upload, report);
      else uploadAttachments(editor, files, 1, upload, report);
    },
    startGallery(name) {
      return gallery.add([new File(["content"], name, { type: "image/png" })]);
    },
    destroyGallery() {
      gallery.destroy();
    },
  };
};
