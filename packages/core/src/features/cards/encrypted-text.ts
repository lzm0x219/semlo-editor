import { Node, type Editor, type Range } from "@tiptap/core";

/** Provider must perform authenticated encryption and return an opaque ciphertext string.
 * The editor cannot verify provider security; providers receive plaintext and passwords. */
export interface EncryptedTextProvider {
  encrypt(input: { plaintext: string; password: string; signal: AbortSignal }): Promise<string>;
  decrypt(input: { ciphertext: string; password: string; signal: AbortSignal }): Promise<string>;
}

type ProviderGetter = () => EncryptedTextProvider | null | undefined;
type Target = { kind: "selection"; range?: Range } | { kind: "below"; position: number };
const validCiphertext = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 1024 * 1024;

type ProviderSessions = { revision: number; listeners: Set<() => void> };
const providerSessions = new WeakMap<Editor, ProviderSessions>();

/** 先记录更换，阻止其他同步回调在旧会话完成清理前提交。 */
export function markEncryptedProviderChanged(editor: Editor): void {
  const sessions = providerSessions.get(editor);
  if (sessions) sessions.revision++;
}

/** 更换服务时只使当前编辑器的旧会话失效。 */
export function invalidateEncryptedProvider(editor: Editor): void {
  // 中止回调可能同步新增或移除会话，只处理开始替换时已存在的会话。
  const listeners = Array.from(providerSessions.get(editor)?.listeners ?? []);
  for (const invalidate of listeners) invalidate();
}

function openDialog(
  editor: Editor,
  getProvider: ProviderGetter,
  initial: string | null,
  save: (ciphertext: string) => boolean,
  canReveal: () => boolean = () => true,
) {
  const provider = getProvider();
  if (
    !provider ||
    typeof provider.encrypt !== "function" ||
    typeof provider.decrypt !== "function" ||
    (initial === null && !editor.isEditable)
  )
    return;
  const view = editor.view;
  const viewDom = view.dom;
  const doc = viewDom.ownerDocument;
  const sessions = providerSessions.get(editor) ?? { revision: 0, listeners: new Set<() => void>() };
  const openedRevision = sessions.revision;
  const previousFocus =
    doc.activeElement instanceof (doc.defaultView?.HTMLElement ?? HTMLElement) ? doc.activeElement : null;
  const dialog = doc.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", initial === null ? "新建加密文本" : "解锁加密文本");
  dialog.className = "semlo-editor-encrypted-dialog";
  const password = doc.createElement("input");
  password.type = "password";
  password.autocomplete = "off";
  password.setAttribute("aria-label", "密码");
  const text = doc.createElement("textarea");
  text.setAttribute("aria-label", "加密文本内容");
  text.hidden = initial !== null;
  const message = doc.createElement("p");
  message.setAttribute("role", "status");
  const submit = doc.createElement("button");
  submit.type = "button";
  submit.textContent = initial === null ? "加密并保存" : "解锁";
  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.textContent = "取消";
  const openedEditable = editor.isEditable;
  const abort = new AbortController();
  let closed = false;
  let invalidated = false;
  let unlocked = initial === null;
  let busy = false;
  const close = (restoreFocus = false) => {
    if (closed) return;
    closed = true;
    const shouldRestoreFocus = restoreFocus && dialog.contains(doc.activeElement);
    sessions.listeners.delete(providerChanged);
    if (!sessions.listeners.size && providerSessions.get(editor) === sessions) providerSessions.delete(editor);
    abort.abort();
    password.value = "";
    text.value = "";
    viewDom.removeEventListener("semlo-editor:editable", editableChanged);
    editor.off("unmount", dispose);
    editor.off("destroy", dispose);
    dialog.remove();
    if (shouldRestoreFocus && !editor.isDestroyed && !view.isDestroyed && viewDom.isConnected) {
      const target =
        previousFocus?.isConnected && previousFocus !== doc.body && previousFocus !== doc.documentElement
          ? previousFocus
          : null;
      const focusEditor = () => {
        if (editor.isDestroyed || view.isDestroyed || !viewDom.isConnected) return;
        view.focus();
        if (!view.isDestroyed && viewDom.isConnected && doc.activeElement !== viewDom) viewDom.focus();
      };
      if (target === viewDom) focusEditor();
      else target?.focus();
      if (!target || doc.activeElement !== target) focusEditor();
    }
  };
  const dispose = () => close();
  const providerChanged = () => {
    if (closed || invalidated || (sessions.revision === openedRevision && getProvider() === provider)) return;
    // 先标记失效，再中止请求：宿主的中止监听器可能同步重入或销毁编辑器。
    invalidated = true;
    abort.abort();
    if (closed) return;
    message.textContent = "加密服务已更换，当前草稿无法提交。";
    submit.disabled = true;
    password.disabled = false;
    text.disabled = false;
  };
  const editableChanged = () => {
    if (editor.isEditable !== openedEditable) close();
  };
  cancel.addEventListener("click", () => close(true));
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.isComposing) {
      event.preventDefault();
      close(true);
    }
  });
  submit.addEventListener("click", async () => {
    if (busy || closed || invalidated) return;
    if (sessions.revision !== openedRevision || getProvider() !== provider) {
      providerChanged();
      return;
    }
    busy = true;
    submit.disabled = true;
    password.disabled = true;
    text.disabled = true;
    message.textContent = "处理中…";
    try {
      if (!unlocked) {
        if (!canReveal()) {
          message.textContent = "文档已变化，无法解锁。";
          return;
        }
        const plaintext = await provider.decrypt({
          ciphertext: initial!,
          password: password.value,
          signal: abort.signal,
        });
        if (closed || invalidated) return;
        if (sessions.revision !== openedRevision || getProvider() !== provider) {
          providerChanged();
          return;
        }
        if (!canReveal()) {
          message.textContent = "文档已变化，无法解锁。";
          return;
        }
        if (typeof plaintext !== "string") throw new Error("Invalid plaintext");
        text.value = plaintext;
        text.hidden = false;
        unlocked = true;
        if (openedEditable) {
          submit.textContent = "加密并保存";
          dialog.setAttribute("aria-label", "编辑加密文本");
        } else {
          text.readOnly = true;
          submit.hidden = true;
          cancel.textContent = "关闭";
          dialog.setAttribute("aria-label", "查看加密文本");
        }
        message.textContent = "";
      } else {
        const ciphertext = await provider.encrypt({
          plaintext: text.value,
          password: password.value,
          signal: abort.signal,
        });
        if (closed || invalidated) return;
        if (sessions.revision !== openedRevision || getProvider() !== provider) {
          providerChanged();
          return;
        }
        if (!validCiphertext(ciphertext)) throw new Error("Invalid ciphertext");
        if (!save(ciphertext)) {
          message.textContent = "文档已变化，无法保存；请先复制草稿。";
          return;
        }
        close(true);
      }
    } catch {
      if (!closed && !invalidated)
        message.textContent = unlocked ? "加密失败，草稿仍保留，请重试。" : "解锁失败，请检查密码或密文。";
    } finally {
      if (!closed) {
        busy = false;
        submit.disabled = invalidated;
        password.disabled = false;
        text.disabled = false;
      }
    }
  });
  dialog.append(password, text, message, submit, cancel);
  doc.body.append(dialog);
  sessions.listeners.add(providerChanged);
  providerSessions.set(editor, sessions);
  viewDom.addEventListener("semlo-editor:editable", editableChanged);
  editor.on("unmount", dispose);
  editor.on("destroy", dispose);
  password.focus();
}

export function openEncryptedInsertion(editor: Editor, getProvider: ProviderGetter, target: Target) {
  if (editor.isDestroyed || !editor.isEditable) return;
  const originalDoc = editor.state.doc;
  const originalSelection = editor.state.selection;
  openDialog(editor, getProvider, null, (ciphertext) => {
    if (
      editor.isDestroyed ||
      !editor.isEditable ||
      editor.state.doc !== originalDoc ||
      !editor.state.selection.eq(originalSelection)
    )
      return false;
    const content = { type: "semloEditorEncryptedText", attrs: { ciphertext } };
    if (target.kind === "below") return editor.chain().focus().insertContentAt(target.position, content).run();
    let chain = editor.chain().focus();
    if (target.range) chain = chain.deleteRange(target.range);
    return chain.insertContent(content).run();
  });
}

export const EncryptedText = Node.create<{ getProvider: ProviderGetter }>({
  name: "semloEditorEncryptedText",
  group: "block",
  atom: true,
  selectable: true,
  addOptions() {
    return { getProvider: () => null };
  },
  addAttributes() {
    return {
      ciphertext: {
        default: "",
        rendered: false,
        parseHTML: (element) => element.getAttribute("data-ciphertext") ?? "",
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-semlo-editor-encrypted-text]" }];
  },
  renderText() {
    return "[加密文本]";
  },
  renderHTML({ node }) {
    return ["div", { "data-semlo-editor-encrypted-text": "", "data-ciphertext": node.attrs.ciphertext }, "[加密文本]"];
  },
  addNodeView() {
    return ({ editor, view, node, getPos }) => {
      let current = node;
      const dom = view.dom.ownerDocument.createElement("div");
      dom.contentEditable = "false";
      dom.className = "semlo-editor-encrypted-text";
      const button = view.dom.ownerDocument.createElement("button");
      button.type = "button";
      button.textContent = "解锁加密文本";
      dom.append(button);
      button.addEventListener("click", () => {
        const original = current;
        const originalDoc = editor.state.doc;
        const targetIsCurrent = () => {
          if (editor.isDestroyed || editor.state.doc !== originalDoc) return false;
          const pos = getPos();
          return typeof pos === "number" && editor.state.doc.nodeAt(pos) === original;
        };
        openDialog(
          editor,
          this.options.getProvider,
          String(original.attrs.ciphertext),
          (ciphertext) => {
            if (!editor.isEditable || !targetIsCurrent()) return false;
            const pos = getPos();
            if (typeof pos !== "number") return false;
            editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ciphertext }));
            return true;
          },
          targetIsCurrent,
        );
      });
      return {
        dom,
        update(next) {
          if (next.type !== current.type) return false;
          current = next;
          return true;
        },
        stopEvent: () => true,
        ignoreMutation: () => true,
      };
    };
  },
});
