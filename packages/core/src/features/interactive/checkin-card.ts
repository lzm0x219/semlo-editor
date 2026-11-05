import { Node } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

import {
  interactiveDeadline,
  splitInteractiveDeadline,
  formatInteractiveDeadline,
  interactiveDeadlineAttributes,
  readInteractiveDeadline,
  supportedInteractiveDeadline,
} from "./interactive-card-deadline";
import { restoresInteractiveActivity } from "./interactive-card-history";
import { stripCopiedActivityIds } from "./interactive-card-host";
import type { InteractiveCardConfig, InteractiveCardHostController } from "./interactive-card-host";

/** The host owns authentication, authorization, deadlines and durable check-in records. */
export interface CheckinService {
  getStatus(cardId: string, signal: AbortSignal): Promise<{ checkedIn: boolean }>;
  checkIn(cardId: string, signal: AbortSignal): Promise<{ checkedIn: boolean }>;
}

export interface CheckinCardOptions {
  host: InteractiveCardHostController | null;
}

const defaultTitle = "阅读后请点击打卡";
const defaultButton = "我已读";
const text = (value: unknown, fallback: string) => (typeof value === "string" ? value : fallback);
const date = interactiveDeadline;

/** A card ID must be allocated by the host and refer to a server-side activity. */
export const CheckinCard = Node.create<CheckinCardOptions>({
  name: "semloEditorCheckin",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addOptions() {
    return { host: null };
  },
  addAttributes() {
    return {
      cardId: {
        default: null,
        rendered: false,
        parseHTML: (element) => element.getAttribute("data-card-id")?.trim() || null,
      },
      title: {
        default: defaultTitle,
        rendered: false,
        parseHTML: (element) => element.getAttribute("data-title") ?? defaultTitle,
      },
      buttonLabel: {
        default: defaultButton,
        rendered: false,
        parseHTML: (element) => element.getAttribute("data-button-label") ?? defaultButton,
      },
      deadline: { default: null, rendered: false, parseHTML: (element) => readInteractiveDeadline(element) },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-semlo-editor-checkin]" }];
  },
  renderText({ node }) {
    return text(node.attrs.title, defaultTitle);
  },
  renderHTML({ node }) {
    const title = text(node.attrs.title, defaultTitle);
    const buttonLabel = text(node.attrs.buttonLabel, defaultButton);
    const deadline = date(node.attrs.deadline);
    const cardId = text(node.attrs.cardId, "").trim();
    return [
      "div",
      {
        "data-semlo-editor-checkin": "",
        ...(cardId ? { "data-card-id": cardId } : {}),
        "data-title": title,
        "data-button-label": buttonLabel,
        ...interactiveDeadlineAttributes(node.attrs.deadline),
      },
      ["strong", title],
      ["span", buttonLabel],
      ...(deadline ? [["time", { datetime: deadline }, deadline] as const] : []),
      ...(!supportedInteractiveDeadline(node.attrs.deadline)
        ? [["p", "截止日期格式不受支持，暂无法参与。"] as const]
        : []),
    ];
  },
  addProseMirrorPlugins() {
    return [new Plugin({ props: { transformPasted: stripCopiedActivityIds } })];
  },
  addNodeView() {
    return ({ editor, view, node: initial, getPos }) => {
      const doc = view.dom.ownerDocument;
      const dom = doc.createElement("div");
      dom.className = "semlo-editor-checkin-card";
      dom.contentEditable = "false";
      let current = initial;
      let disposed = false;
      let controller: AbortController | undefined;
      let revision = 0;
      let hostRevision = 0;
      let historyCandidate: { before: typeof initial; hostRevision: number } | undefined;
      let state: "unavailable" | "loading" | "ready" | "submitting" | "checked" | "error" | "syncerror" = "unavailable";
      let editing = false;
      let draft:
        | { title: string; buttonLabel: string; deadline: string; deadlineTime: string; deadlineEnabled: boolean }
        | undefined;
      const host = this.options.host;
      const supported = () => supportedInteractiveDeadline(current.attrs.deadline);
      const config = (): InteractiveCardConfig => ({
        kind: "checkin",
        title: text(current.attrs.title, defaultTitle),
        buttonLabel: text(current.attrs.buttonLabel, defaultButton),
        deadline: date(current.attrs.deadline),
      });
      let syncController: AbortController | undefined;
      const id = () => text(current.attrs.cardId, "").trim();
      const cancel = () => {
        const cancelledRevision = ++revision;
        const previous = controller;
        controller = undefined;
        previous?.abort();
        return cancelledRevision;
      };
      const request = async (submit: boolean) => {
        const requestId = cancel();
        if (disposed || requestId !== revision) return;
        if (!supported()) {
          state = "unavailable";
          paint();
          return;
        }
        const service = host?.getHost()?.checkin;
        if (!host || !service || !id()) {
          state = "unavailable";
          paint();
          return;
        }
        const cardId = id();
        controller = new AbortController();
        state = submit ? "submitting" : "loading";
        paint();
        try {
          if (host.isSyncing(cardId, "checkin") || !(await host.verify(cardId, config(), controller.signal))) {
            if (disposed || requestId !== revision) return;
            state = "syncerror";
            controller = undefined;
            paint();
            return;
          }
          if (disposed || requestId !== revision) return;
          const result = await (submit
            ? service.checkIn(cardId, controller.signal)
            : service.getStatus(cardId, controller.signal));
          if (disposed || requestId !== revision || id() !== cardId) return;
          if (typeof result?.checkedIn !== "boolean") throw new Error("Invalid check-in status");
          state = result.checkedIn ? "checked" : "ready";
        } catch {
          if (disposed || requestId !== revision || id() !== cardId) return;
          state = "error";
        }
        controller = undefined;
        paint();
      };
      const paint = () => {
        if (!supported()) {
          editing = false;
          draft = undefined;
          dom.style.background = "";
          const title = doc.createElement("strong");
          title.textContent = text(current.attrs.title, defaultTitle);
          const message = doc.createElement("p");
          message.setAttribute("role", "status");
          message.textContent = "打卡截止日期格式不受支持，暂无法编辑或参与；原始数据已保留。";
          dom.replaceChildren(title, message);
          return;
        }
        const restoreEditFocus = doc.activeElement === dom.querySelector("[data-checkin-edit]");
        if (!editor.isEditable) editing = false;
        dom.style.background = editing ? "#fafafa" : "";
        const preservedForm = editing ? dom.querySelector<HTMLFormElement>(":scope > form") : null;
        if (preservedForm) {
          for (const child of Array.from(dom.children)) if (child !== preservedForm) child.remove();
        } else dom.replaceChildren();
        const append = (element: HTMLElement) => {
          if (preservedForm) dom.insertBefore(element, preservedForm);
          else dom.append(element);
        };
        const title = doc.createElement("strong");
        title.textContent = text(current.attrs.title, defaultTitle);
        if (!editing) append(title);
        const deadline = date(current.attrs.deadline);
        if (deadline && !editing) {
          const time = doc.createElement("time");
          time.dateTime = deadline;
          time.textContent = `截止日期：${formatInteractiveDeadline(deadline)}`;
          append(time);
        }
        const action = doc.createElement("button");
        action.type = "button";
        action.textContent = state === "checked" ? "已打卡" : text(current.attrs.buttonLabel, defaultButton);
        action.disabled = state !== "ready";
        action.addEventListener("click", () => {
          if (!disposed && dom.contains(action) && !editing && state === "ready") void request(true);
        });
        if (!editing) append(action);
        const status = doc.createElement("span");
        status.setAttribute("role", "status");
        status.textContent = {
          unavailable: "打卡服务未配置",
          loading: "正在加载打卡状态",
          ready: "",
          submitting: "正在提交打卡",
          checked: "",
          error: "打卡状态获取或提交失败",
          syncerror: "打卡配置尚未与服务同步",
        }[state];
        append(status);
        if (state === "error") {
          const retry = doc.createElement("button");
          retry.type = "button";
          retry.textContent = "重新获取状态";
          retry.addEventListener("click", () => {
            if (!disposed && dom.contains(retry)) void request(false);
          });
          append(retry);
        }
        if (state === "syncerror" && editor.isEditable && host && id()) {
          const sync = doc.createElement("button");
          sync.type = "button";
          sync.textContent = "同步打卡配置";
          sync.addEventListener("click", () => {
            if (!disposed && dom.contains(sync)) void syncConfig();
          });
          append(sync);
        }
        if (editor.isEditable && !editing) {
          const edit = doc.createElement("button");
          edit.type = "button";
          edit.dataset.checkinEdit = "";
          edit.textContent = "编辑打卡";
          edit.addEventListener("click", () => {
            if (disposed || !dom.contains(edit) || !editor.isEditable) return;
            editing = true;
            draft = {
              title: text(current.attrs.title, defaultTitle),
              buttonLabel: text(current.attrs.buttonLabel, defaultButton),
              deadline: splitInteractiveDeadline(current.attrs.deadline).date,
              deadlineTime: splitInteractiveDeadline(current.attrs.deadline).time,
              deadlineEnabled: !!date(current.attrs.deadline),
            };
            paint();
          });
          append(edit);
        }
        if (editor.isEditable && editing && !preservedForm) {
          const form = doc.createElement("form");
          form.setAttribute("aria-label", "编辑打卡");
          form.style.paddingTop = "0";
          form.style.borderTop = "0";
          const formTitle = doc.createElement("strong");
          formTitle.textContent = "编辑打卡";
          form.append(formTitle);
          const input = (label: string, value: string, type = "text") => {
            const wrapper = doc.createElement("label");
            wrapper.textContent = label;
            const field = doc.createElement("input");
            field.type = type;
            field.value = value;
            wrapper.append(field);
            form.append(wrapper);
            return field;
          };
          const titleInput = input("标题", draft?.title ?? text(current.attrs.title, defaultTitle));
          const buttonInput = input("按钮", draft?.buttonLabel ?? text(current.attrs.buttonLabel, defaultButton));
          buttonInput.setAttribute("aria-label", "按钮文字");
          const toggleLabel = doc.createElement("label");
          const toggle = doc.createElement("input");
          toggle.type = "checkbox";
          toggle.checked = draft?.deadlineEnabled ?? !!deadline;
          toggleLabel.append(toggle, doc.createTextNode("设置截止日期"));
          form.append(toggleLabel);
          const deadlineInput = input("截止日期", draft?.deadline ?? splitInteractiveDeadline(deadline).date, "date");
          const timeInput = input("截止时间", draft?.deadlineTime ?? splitInteractiveDeadline(deadline).time, "time");
          timeInput.step = "1";
          const showDeadline = () => {
            deadlineInput.parentElement!.hidden = !toggle.checked;
            timeInput.parentElement!.hidden = !toggle.checked;
            deadlineInput.parentElement!.style.display = toggle.checked ? "" : "none";
            timeInput.parentElement!.style.display = toggle.checked ? "" : "none";
            deadlineInput.disabled = !toggle.checked;
            timeInput.disabled = !toggle.checked;
          };
          showDeadline();
          const rememberDraft = () => {
            if (disposed || !editing || !dom.contains(form)) return;
            draft = {
              title: titleInput.value,
              buttonLabel: buttonInput.value,
              deadline: deadlineInput.value,
              deadlineTime: timeInput.value,
              deadlineEnabled: toggle.checked,
            };
            deadlineInput.setCustomValidity("");
          };
          for (const field of [titleInput, buttonInput, deadlineInput, timeInput])
            field.addEventListener("input", rememberDraft);
          toggle.addEventListener("change", () => {
            if (disposed || !editing || !dom.contains(form)) return;
            if (toggle.checked && !deadlineInput.value) {
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              const pad = (value: number) => String(value).padStart(2, "0");
              deadlineInput.value = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
              timeInput.value = `${pad(tomorrow.getHours())}:${pad(tomorrow.getMinutes())}:${pad(tomorrow.getSeconds())}`;
            }
            showDeadline();
            rememberDraft();
          });
          const save = doc.createElement("button");
          save.type = "submit";
          save.textContent = "确定";
          const close = doc.createElement("button");
          close.type = "button";
          close.textContent = "取消";
          close.addEventListener("click", () => {
            if (disposed || !editing || !dom.contains(form)) return;
            editing = false;
            paint();
            dom.querySelector<HTMLButtonElement>("[data-checkin-edit]")?.focus({ preventScroll: true });
          });
          form.append(save, close);
          form.addEventListener("submit", (event) => {
            event.preventDefault();
            if (!editing || !dom.contains(form) || disposed) return;
            if (toggle.checked && !deadlineInput.value) {
              deadlineInput.setCustomValidity("请先选择截止日期");
              deadlineInput.reportValidity();
              return;
            }
            const pos = getPos();
            const node = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
            if (!editor.isEditable || !node || node.type !== current.type || typeof pos !== "number") return;
            editing = false;
            const expected = {
              ...node.attrs,
              title: titleInput.value,
              buttonLabel: buttonInput.value,
              deadline: toggle.checked
                ? date(deadlineInput.value + (timeInput.value ? `T${timeInput.value}` : ""))
                : null,
            };
            const previousHostRevision = hostRevision;
            view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, expected));
            if (disposed || editor.isDestroyed) return;
            const nextPosition = getPos();
            const actual = typeof nextPosition === "number" ? view.state.doc.nodeAt(nextPosition) : null;
            if (
              hostRevision === previousHostRevision &&
              actual?.type === node.type &&
              JSON.stringify(actual.attrs) === JSON.stringify(expected)
            ) {
              dom.querySelector<HTMLButtonElement>("[data-checkin-edit]")?.focus({ preventScroll: true });
              void syncConfig();
            }
          });
          dom.append(form);
        }
        if (restoreEditFocus)
          dom.querySelector<HTMLButtonElement>("[data-checkin-edit]")?.focus({ preventScroll: true });
      };
      const syncConfig = async () => {
        if (!host?.getHost() || !id() || !editor.isEditable || disposed || !supported()) return;
        const expectedHostRevision = hostRevision;
        const cardId = id();
        const snapshot = config();
        const previous = syncController;
        const active = new AbortController();
        syncController = active;
        previous?.abort();
        if (
          disposed ||
          editor.isDestroyed ||
          syncController !== active ||
          hostRevision !== expectedHostRevision ||
          id() !== cardId ||
          !supported() ||
          JSON.stringify(config()) !== JSON.stringify(snapshot) ||
          !editor.isEditable
        ) {
          active.abort();
          if (syncController === active) syncController = undefined;
          return;
        }
        try {
          await host.sync(cardId, snapshot, active.signal);
        } catch {
          if (!disposed && !active.signal.aborted) {
            state = "syncerror";
            paint();
          }
        } finally {
          if (syncController === active) syncController = undefined;
        }
      };
      const unsubscribe = host?.subscribe((cardId) => {
        if (cardId === null) hostRevision++;
        if (!disposed && (cardId === null || cardId === id())) void request(false);
      });
      const historyChanged = ({ transaction }: { transaction: import("@tiptap/pm/state").Transaction }) => {
        const candidate = historyCandidate;
        if (!candidate || !restoresInteractiveActivity(transaction, current, candidate.before)) return;
        historyCandidate = undefined;
        if (!disposed && editor.isEditable && candidate.hostRevision === hostRevision) void syncConfig();
      };
      editor.on("transaction", historyChanged);
      let editable = editor.isEditable;
      const editableChanged = () => {
        if (editable === editor.isEditable) return;
        editable = editor.isEditable;
        paint();
      };
      editor.on("update", editableChanged);
      view.dom.addEventListener("semlo-editor:editable", editableChanged);
      paint();
      void request(false);
      return {
        dom,
        update(node) {
          if (node.type !== current.type) return false;
          const before = JSON.stringify([id(), config(), supported()]);
          const previous = current;
          current = node;
          if (JSON.stringify([id(), config(), supported()]) !== before) {
            syncController?.abort();
            historyCandidate = { before: previous, hostRevision };
            editing = false;
            void request(false);
          } else paint();
          return true;
        },
        stopEvent: () => true,
        ignoreMutation: () => true,
        destroy() {
          disposed = true;
          cancel();
          syncController?.abort();
          unsubscribe?.();
          editor.off("update", editableChanged);
          editor.off("transaction", historyChanged);
          view.dom.removeEventListener("semlo-editor:editable", editableChanged);
        },
      };
    };
  },
});
