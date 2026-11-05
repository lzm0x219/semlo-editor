import { createEditor } from "../../../packages/core/src/index";
import type { EditorController } from "../../../packages/core/src/types";

type Mode = "report" | "destroy" | "integrations" | "document" | "throw";
type Request = { signal: AbortSignal; resolve: (value: string) => void; reject: (error: unknown) => void };
type Fixture = {
  controller: EditorController;
  other: EditorController;
  requests: Request[];
  errors: Error[];
  failure: Error;
  handlerFailure: Error;
  thrownErrors: Error[];
  unhandled: string[];
  begin(): void;
};
declare global {
  interface Window {
    mountTranslationFailure?: (mode: Mode) => void;
    translationFailureFixture?: Fixture;
  }
}

window.mountTranslationFailure = (mode) => {
  const host = document.createElement("div");
  const otherHost = document.createElement("div");
  host.id = "translation-failure";
  document.body.replaceChildren(host, otherHost);
  const requests: Request[] = [];
  const errors: Error[] = [];
  const unhandled: string[] = [];
  const failure = new Error("translation service failure");
  const handlerFailure = new Error("onError handler failed");
  const thrownErrors: Error[] = [];
  window.addEventListener("unhandledrejection", (event) => unhandled.push(String(event.reason)));
  window.addEventListener("error", (event) => {
    if (event.error === handlerFailure) {
      thrownErrors.push(event.error);
      event.preventDefault();
    }
  });
  const translate = ({ signal }: { signal: AbortSignal }) =>
    new Promise<string>((resolve, reject) => requests.push({ signal, resolve, reject }));
  const newerTranslate = ({ signal }: { signal: AbortSignal }) =>
    new Promise<string>((resolve, reject) => requests.push({ signal, resolve, reject }));
  let controller: EditorController;
  controller = createEditor({
    element: host,
    content: "<p>original text</p>",
    translate,
    onError: (error) => {
      errors.push(error);
      if (mode === "throw") throw handlerFailure;
      if (mode === "destroy") controller.destroy();
      if (mode === "integrations") {
        controller.setIntegrations({ translate: newerTranslate });
        host.querySelector<HTMLButtonElement>('button[aria-label="翻译"]')!.click();
      }
      if (mode === "document") {
        controller.setContent("<p>replacement text</p>");
        controller.editor.commands.setTextSelection({ from: 1, to: 12 });
      }
    },
  });
  const other = createEditor({ element: otherHost, content: "<p>other</p>" });
  window.translationFailureFixture = {
    controller,
    other,
    requests,
    errors,
    failure,
    handlerFailure,
    thrownErrors,
    unhandled,
    begin() {
      controller.editor.commands.setTextSelection({ from: 1, to: 9 });
      host.querySelector<HTMLButtonElement>('button[aria-label="翻译"]')!.click();
    },
  };
};
