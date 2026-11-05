import { Node } from "@tiptap/core";
import { undo, redo } from "@tiptap/pm/history";
import { Plugin } from "@tiptap/pm/state";

import {
  interactiveDeadline,
  formatInteractiveDeadline,
  interactiveDeadlineAttributes,
  readInteractiveDeadline,
  supportedInteractiveDeadline,
} from "./interactive-card-deadline";
import { restoresInteractiveActivity } from "./interactive-card-history";
import { stripCopiedActivityIds } from "./interactive-card-host";
import type { InteractiveCardConfig, InteractiveCardHostController } from "./interactive-card-host";
import { createVoteDeadlinePicker } from "./vote-deadline-picker";

export interface VoteOption {
  id: string;
  label: string;
}
/** Status is authoritative; the service owns identity, access, deadlines and vote persistence. */
export interface VoteStatus {
  canVote: boolean;
  selectedOptionIds: string[];
}
export interface VoteService {
  getStatus(cardId: string, signal: AbortSignal): Promise<VoteStatus>;
  submitVote(cardId: string, optionIds: string[], signal: AbortSignal): Promise<VoteStatus>;
}
export interface VoteCardOptions {
  host: InteractiveCardHostController | null;
}

const string = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
function optionsFrom(value: unknown): VoteOption[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const option = item as Record<string, unknown>;
    if (typeof option.id !== "string" || !option.id || ids.has(option.id) || typeof option.label !== "string")
      return [];
    ids.add(option.id);
    return [{ ...option, id: option.id, label: option.label }];
  });
}
function supportedOptions(value: unknown): boolean {
  return Array.isArray(value) && optionsFrom(value).length === value.length;
}
function parseOptions(value: string | null): unknown {
  if (value === null) return [];
  try {
    return JSON.parse(value) as unknown;
  } catch {
    // 保留损坏的原文，避免重新导出时把无法识别的数据变成空选项。
    return value;
  }
}
const validDate = interactiveDeadline;

function validStatus(value: VoteStatus, options: VoteOption[], multiple: boolean): boolean {
  if (!value || typeof value.canVote !== "boolean" || !Array.isArray(value.selectedOptionIds)) return false;
  const ids = new Set(options.map((option) => option.id));
  return (
    value.selectedOptionIds.every((id) => typeof id === "string" && ids.has(id)) &&
    new Set(value.selectedOptionIds).size === value.selectedOptionIds.length &&
    (multiple || value.selectedOptionIds.length <= 1)
  );
}

/** cardId identifies an activity created by the host; option IDs must remain stable across edits. */
let nextVoteGroup = 0;
export const VoteCard = Node.create<VoteCardOptions>({
  name: "semloEditorVote",
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
      title: { default: "投票", rendered: false, parseHTML: (element) => element.getAttribute("data-title") ?? "投票" },
      options: {
        default: [],
        rendered: false,
        parseHTML: (element) => parseOptions(element.getAttribute("data-options")),
      },
      multiple: {
        default: false,
        rendered: false,
        parseHTML: (element) => element.getAttribute("data-multiple") === "true",
      },
      deadline: {
        default: null,
        rendered: false,
        parseHTML: (element) => readInteractiveDeadline(element),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-semlo-editor-vote]" }];
  },
  renderText({ node }) {
    return string(node.attrs.title, "投票");
  },
  renderHTML({ node }) {
    const title = string(node.attrs.title, "投票");
    const options = optionsFrom(node.attrs.options);
    const deadline = validDate(node.attrs.deadline);
    return [
      "div",
      {
        "data-semlo-editor-vote": "",
        ...(string(node.attrs.cardId).trim() ? { "data-card-id": string(node.attrs.cardId).trim() } : {}),
        "data-title": title,
        "data-options": JSON.stringify(node.attrs.options) ?? "null",
        "data-multiple": String(node.attrs.multiple === true),
        ...interactiveDeadlineAttributes(node.attrs.deadline),
      },
      ["strong", title],
      ...(supportedOptions(node.attrs.options)
        ? options.map((option) => ["p", option.label] as const)
        : [["p", "投票选项数据格式不受支持，暂无法编辑。"] as const]),
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
      dom.className = "semlo-editor-vote-card";
      dom.contentEditable = "false";
      const host = this.options.host;
      let syncController: AbortController | undefined;
      const groupName = `semlo-editor-vote-${++nextVoteGroup}`;
      let current = initial;
      let disposed = false;
      let controller: AbortController | undefined;
      let revision = 0;
      let state: "unavailable" | "loading" | "ready" | "submitting" | "error" | "syncerror" = "unavailable";
      let status: VoteStatus | undefined;
      let selected: string[] = [];
      let updating = false;
      let hostRevision = 0;
      let historyCandidate: { before: typeof initial; hostRevision: number } | undefined;
      let disposeDeadline: (() => void) | undefined;
      let syncTimer: ReturnType<typeof setTimeout> | undefined;
      let pendingHost: ReturnType<InteractiveCardHostController["getHost"]> = null;
      const id = () => string(current.attrs.cardId).trim();
      const options = () => optionsFrom(current.attrs.options);
      const supported = () =>
        supportedOptions(current.attrs.options) && supportedInteractiveDeadline(current.attrs.deadline);
      const config = (): InteractiveCardConfig => ({
        kind: "vote",
        title: string(current.attrs.title, "投票"),
        // 扩展字段属于文档数据，不改变现有宿主投票服务的配置契约。
        options: options().map(({ id, label }) => ({ id, label })),
        multiple: current.attrs.multiple === true,
        deadline: validDate(current.attrs.deadline),
      });
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
        const service = host?.getHost()?.vote;
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
          if (
            syncTimer !== undefined ||
            host.isSyncing(cardId, "vote") ||
            !(await host.verify(cardId, config(), controller.signal))
          ) {
            if (disposed || requestId !== revision) return;
            state = "syncerror";
            controller = undefined;
            paint();
            return;
          }
          if (disposed || requestId !== revision) return;
          const result = await (submit
            ? service.submitVote(cardId, [...selected], controller.signal)
            : service.getStatus(cardId, controller.signal));
          if (disposed || requestId !== revision || id() !== cardId) return;
          if (!validStatus(result, options(), current.attrs.multiple === true)) throw new Error("Invalid vote status");
          status = { canVote: result.canVote, selectedOptionIds: [...result.selectedOptionIds] };
          selected = [...status.selectedOptionIds];
          state = "ready";
        } catch {
          if (disposed || requestId !== revision || id() !== cardId) return;
          status = undefined;
          state = "error";
        }
        controller = undefined;
        paint();
      };
      const scheduleSync = () => {
        if (syncTimer !== undefined) clearTimeout(syncTimer);
        pendingHost = host?.getHost() ?? null;
        syncTimer = setTimeout(() => {
          syncTimer = undefined;
          if (!disposed && pendingHost && pendingHost === host?.getHost()) void syncConfig(true);
          else if (!disposed) void request(false);
        }, 400);
      };
      const commitAttrs = (attrs: Record<string, unknown>, rebuild = false) => {
        if (!editor.isEditable || disposed || !supported()) return;
        const pos = getPos();
        const node = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
        if (!node || node.type !== current.type || typeof pos !== "number") return;
        if (Object.keys(attrs).every((key) => JSON.stringify(node.attrs[key]) === JSON.stringify(attrs[key]))) return;
        const previousHostRevision = hostRevision;
        const cancelledRevision = cancel();
        if (revision !== cancelledRevision) revision++;
        const positionAfterCancel = getPos();
        const nodeAfterCancel =
          typeof positionAfterCancel === "number" ? view.state.doc.nodeAt(positionAfterCancel) : null;
        if (disposed || editor.isDestroyed || positionAfterCancel !== pos || !nodeAfterCancel?.eq(node)) return;
        status = undefined;
        selected = [];
        state = "loading";
        const expected = { ...node.attrs, ...attrs };
        updating = true;
        try {
          view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, expected));
        } finally {
          updating = false;
        }
        if (disposed || editor.isDestroyed) return;
        const nextPosition = getPos();
        const actual = typeof nextPosition === "number" ? view.state.doc.nodeAt(nextPosition) : null;
        if (
          hostRevision !== previousHostRevision ||
          !actual ||
          actual.type !== node.type ||
          JSON.stringify(actual.attrs) !== JSON.stringify(expected)
        ) {
          delete dom.dataset.editMode;
          void request(false);
          return;
        }
        scheduleSync();
        if (rebuild) {
          delete dom.dataset.editMode;
          paint();
        } else updateEditStatus();
      };
      const updateEditStatus = () => {
        const message = dom.querySelector<HTMLElement>("[data-vote-status]");
        if (!message) return;
        message.textContent =
          !host?.getHost()?.vote || !id()
            ? "投票服务未配置"
            : syncTimer !== undefined || host.isSyncing(id(), "vote")
              ? "正在同步投票配置"
              : state === "loading"
                ? "正在加载投票状态"
                : state === "syncerror"
                  ? "投票配置尚未与服务同步"
                  : state === "error"
                    ? "投票状态获取或提交失败"
                    : "";
        const retry = dom.querySelector<HTMLButtonElement>("[data-vote-sync]");
        if (retry) {
          retry.hidden = (state !== "syncerror" && state !== "error") || syncTimer !== undefined;
          retry.textContent = state === "error" ? "重新获取状态" : "同步投票配置";
        }
      };
      const paintEditor = () => {
        if (dom.dataset.editMode === "true") {
          updateEditStatus();
          return;
        }
        disposeDeadline?.();
        disposeDeadline = undefined;
        dom.replaceChildren();
        dom.dataset.editMode = "true";
        dom.style.background = "#fafafa";
        const form = doc.createElement("form");
        const commit = (attrs: Record<string, unknown>, rebuild = false) => {
          if (dom.contains(form)) commitAttrs(attrs, rebuild);
        };
        form.className = "semlo-editor-vote-editor";
        form.style.paddingTop = "0";
        form.style.borderTop = "0";
        form.setAttribute("aria-label", "编辑投票");
        form.addEventListener("submit", (event) => event.preventDefault());
        form.addEventListener("keydown", (event) => {
          if (disposed || !dom.contains(form)) return;
          if (event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey)) return;
          const key = event.key.toLowerCase();
          if (key !== "z" && key !== "y") return;
          const target = event.target as HTMLElement;
          if (target instanceof (doc.defaultView?.HTMLInputElement ?? HTMLInputElement)) return;
          const label = target.getAttribute("aria-label");
          const addFocused = target.hasAttribute("data-vote-add");
          const operation = key === "y" || event.shiftKey ? redo : undo;
          if (!operation(view.state, view.dispatch)) return;
          event.preventDefault();
          event.stopPropagation();
          if (label) {
            const next = Array.from(dom.querySelectorAll<HTMLElement>("[aria-label]")).find(
              (element) => element.getAttribute("aria-label") === label,
            );
            next?.focus({ preventScroll: true });
          } else if (addFocused)
            dom.querySelector<HTMLButtonElement>("[data-vote-add]")?.focus({ preventScroll: true });
        });
        const heading = doc.createElement("div");
        heading.className = "semlo-editor-vote-editor-heading";
        heading.style.display = "flex";
        heading.style.gap = "8px";
        const mode = doc.createElement("select");
        mode.setAttribute("aria-label", "投票类型");
        for (const [value, label] of [
          ["single", "单选"],
          ["multiple", "多选"],
        ]) {
          const option = doc.createElement("option");
          option.value = value;
          option.textContent = label;
          mode.append(option);
        }
        mode.value = current.attrs.multiple === true ? "multiple" : "single";
        mode.addEventListener("change", () => commit({ multiple: mode.value === "multiple" }));
        const trackText = (input: HTMLInputElement, apply: () => void) => {
          let composing = false;
          input.addEventListener("compositionstart", () => {
            composing = true;
          });
          input.addEventListener("compositionend", () => {
            composing = false;
            apply();
          });
          input.addEventListener("input", (event) => {
            if (!composing && !(event as InputEvent).isComposing) apply();
          });
        };
        const title = doc.createElement("input");
        title.type = "text";
        title.style.flex = "1";
        title.setAttribute("aria-label", "标题");
        title.placeholder = "请输入投票标题";
        title.value = string(current.attrs.title, "投票");
        trackText(title, () => commit({ title: title.value }));
        heading.append(mode, title);
        form.append(heading);
        options().forEach((option, index) => {
          const row = doc.createElement("div");
          row.className = "semlo-editor-vote-editor-option";
          row.style.display = "flex";
          row.style.gap = "8px";
          const input = doc.createElement("input");
          input.type = "text";
          input.style.flex = "1";
          input.setAttribute("aria-label", `选项 ${index + 1}`);
          input.placeholder = `选项 ${index + 1}`;
          input.value = option.label;
          trackText(input, () =>
            commit({
              options: options().map((value) => (value.id === option.id ? { ...value, label: input.value } : value)),
            }),
          );
          const remove = doc.createElement("button");
          remove.type = "button";
          remove.setAttribute("aria-label", `删除选项 ${index + 1}`);
          remove.textContent = "×";
          remove.addEventListener("click", () => {
            if (disposed || !dom.contains(remove)) return;
            const remaining = options().filter((value) => value.id !== option.id);
            commit({ options: remaining }, true);
            const nextIndex = Math.min(index, remaining.length - 1);
            const next =
              nextIndex >= 0
                ? dom.querySelector<HTMLButtonElement>(`button[aria-label="删除选项 ${nextIndex + 1}"]`)
                : dom.querySelector<HTMLButtonElement>("[data-vote-add]");
            next?.focus({ preventScroll: true });
          });
          row.append(input, remove);
          form.append(row);
        });
        const add = doc.createElement("button");
        add.type = "button";
        add.dataset.voteAdd = "";
        add.textContent = "+ 添加选项";
        add.addEventListener("click", () => {
          if (disposed || !dom.contains(add)) return;
          let optionId: string;
          do {
            optionId = Array.from(doc.defaultView!.crypto.getRandomValues(new Uint8Array(16)), (byte) =>
              byte.toString(16).padStart(2, "0"),
            ).join("");
          } while (options().some((option) => option.id === optionId));
          const next = [...options(), { id: optionId, label: "" }];
          commit({ options: next }, true);
          dom.querySelector<HTMLInputElement>(`input[aria-label="选项 ${next.length}"]`)?.focus();
        });
        form.append(add);
        const deadlinePicker = createVoteDeadlinePicker(
          doc,
          () => validDate(current.attrs.deadline),
          (deadline) => {
            commit({ deadline });
          },
        );
        disposeDeadline = deadlinePicker.destroy;
        form.append(deadlinePicker.element);
        const message = doc.createElement("span");
        message.dataset.voteStatus = "";
        message.setAttribute("role", "status");
        const retry = doc.createElement("button");
        retry.type = "button";
        retry.dataset.voteSync = "";
        retry.textContent = "同步投票配置";
        retry.addEventListener("click", () => {
          if (disposed || !dom.contains(retry)) return;
          if (state === "error") void request(false);
          else void syncConfig();
        });
        form.append(message, retry);
        dom.append(form);
        updateEditStatus();
      };
      const paint = () => {
        if (!supported()) {
          disposeDeadline?.();
          disposeDeadline = undefined;
          delete dom.dataset.editMode;
          dom.style.background = "";
          const title = doc.createElement("strong");
          title.textContent = string(current.attrs.title, "投票");
          const message = doc.createElement("p");
          message.setAttribute("role", "status");
          message.textContent = supportedOptions(current.attrs.options)
            ? "投票截止日期格式不受支持，暂无法编辑或参与；原始数据已保留。"
            : "投票选项数据格式不受支持，暂无法编辑或参与；原始数据已保留。";
          dom.replaceChildren(title, message);
          return;
        }
        if (editor.isEditable) {
          paintEditor();
          return;
        }
        delete dom.dataset.editMode;
        disposeDeadline?.();
        disposeDeadline = undefined;
        dom.style.background = "";
        dom.replaceChildren();
        const title = doc.createElement("strong");
        title.textContent = string(current.attrs.title, "投票");
        dom.append(title);
        const deadline = validDate(current.attrs.deadline);
        if (deadline) {
          const time = doc.createElement("time");
          time.dateTime = deadline;
          time.textContent = `截止日期：${formatInteractiveDeadline(deadline)}`;
          dom.append(time);
        }
        const group = doc.createElement("fieldset");
        const legend = doc.createElement("legend");
        legend.textContent = current.attrs.multiple === true ? "多选" : "单选";
        group.append(legend);
        for (const option of options()) {
          const label = doc.createElement("label");
          const input = doc.createElement("input");
          input.type = current.attrs.multiple === true ? "checkbox" : "radio";
          input.name = groupName;
          input.checked = selected.includes(option.id);
          input.disabled = state !== "ready" || !status?.canVote;
          input.addEventListener("change", () => {
            if (disposed || !dom.contains(input) || state !== "ready" || !status?.canVote) return;
            selected =
              current.attrs.multiple === true
                ? input.checked
                  ? [...selected, option.id]
                  : selected.filter((value) => value !== option.id)
                : [option.id];
            submit.disabled = selected.length === 0;
          });
          label.append(input, doc.createTextNode(option.label));
          group.append(label);
        }
        dom.append(group);
        const submit = doc.createElement("button");
        submit.type = "button";
        submit.textContent = "投票";
        submit.disabled = state !== "ready" || !status?.canVote || selected.length === 0;
        submit.addEventListener("click", () => {
          if (!disposed && dom.contains(submit) && state === "ready" && status?.canVote && selected.length)
            void request(true);
        });
        dom.append(submit);
        const message = doc.createElement("span");
        message.setAttribute("role", "status");
        message.textContent =
          state === "unavailable"
            ? "投票服务未配置"
            : state === "loading"
              ? "正在加载投票状态"
              : state === "submitting"
                ? "正在提交投票"
                : state === "error"
                  ? "投票状态获取或提交失败"
                  : state === "syncerror"
                    ? "投票配置尚未与服务同步"
                    : status?.canVote
                      ? ""
                      : "当前不可投票";
        dom.append(message);
        if (state === "error") {
          const retry = doc.createElement("button");
          retry.type = "button";
          retry.textContent = "重新获取状态";
          retry.addEventListener("click", () => {
            if (!disposed && dom.contains(retry)) void request(false);
          });
          dom.append(retry);
        }
      };
      const syncConfig = async (authorizedEdit = false) => {
        if (!host?.getHost() || !id() || (!editor.isEditable && !authorizedEdit) || disposed || !supported()) return;
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
          (!editor.isEditable && !authorizedEdit)
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
        if (cardId === null && syncTimer !== undefined) {
          clearTimeout(syncTimer);
          syncTimer = undefined;
          pendingHost = null;
        }
        if (!disposed && (cardId === null || cardId === id())) void request(false);
      });
      const historyChanged = ({ transaction }: { transaction: import("@tiptap/pm/state").Transaction }) => {
        const candidate = historyCandidate;
        if (!candidate || !restoresInteractiveActivity(transaction, current, candidate.before)) return;
        historyCandidate = undefined;
        if (!disposed && editor.isEditable && candidate.hostRevision === hostRevision) scheduleSync();
      };
      editor.on("transaction", historyChanged);
      let editable = editor.isEditable;
      const editableChanged = () => {
        if (editable !== editor.isEditable) {
          editable = editor.isEditable;
          delete dom.dataset.editMode;
          if (!editable) void request(false);
          else paint();
        }
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
          if (updating) return true;
          if (JSON.stringify([id(), config(), supported()]) !== before) {
            historyCandidate = { before: previous, hostRevision };
            if (syncTimer !== undefined) clearTimeout(syncTimer);
            syncTimer = undefined;
            pendingHost = null;
            syncController?.abort();
            status = undefined;
            selected = [];
            delete dom.dataset.editMode;
            void request(false);
          } else paint();
          return true;
        },
        stopEvent: () => true,
        ignoreMutation: () => true,
        destroy() {
          disposed = true;
          disposeDeadline?.();
          disposeDeadline = undefined;
          cancel();
          if (syncTimer !== undefined) clearTimeout(syncTimer);
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
