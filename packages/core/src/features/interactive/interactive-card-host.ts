import { Fragment, Slice } from "@tiptap/pm/model";

import type { CheckinService } from "./checkin-card";
import type { VoteOption, VoteService } from "./vote-card";

/** Deadlines use YYYY-MM-DD or local YYYY-MM-DDTHH:mm[:ss]; the host must define its time zone. */
export type InteractiveCardConfig =
  | { kind: "checkin"; title: string; buttonLabel: string; deadline: string | null }
  | { kind: "vote"; title: string; options: VoteOption[]; multiple: boolean; deadline: string | null };

/** The host enforces authentication, authorization, version ordering and server-side validation. */
export interface InteractiveCardHost {
  createActivity(
    config: InteractiveCardConfig,
    copiedFrom: string | null,
    signal: AbortSignal,
  ): Promise<{ cardId: string }>;
  /** Verify against the authoritative activity without changing it. */
  verifyConfiguration(cardId: string, config: InteractiveCardConfig, signal: AbortSignal): Promise<boolean>;
  /** Persist configuration. The host must reject stale or unauthorized changes. */
  syncConfiguration(cardId: string, config: InteractiveCardConfig, signal: AbortSignal): Promise<void>;
  checkin?: CheckinService;
  vote?: VoteService;
}

type Listener = (cardId: string | null) => void;

/** Errors that cannot be returned without replacing an existing failure remain observable. */
function reportObserverError(error: unknown) {
  queueMicrotask(() => {
    try {
      if (typeof globalThis.reportError === "function") globalThis.reportError(error);
      else console.error("互动卡片状态监听器出错", error);
    } catch (reportingError) {
      console.error("互动卡片状态监听器及错误报告失败", error, reportingError);
    }
  });
}

/** One instance per editor. Do not share it between editors with different identities. */
export class InteractiveCardHostController {
  private host: InteractiveCardHost | null = null;
  private generation = 0;
  private listeners = new Set<Listener>();
  private pending = new Set<AbortController>();
  private queues = new Map<string, Promise<void>>();

  constructor(host: InteractiveCardHost | null = null) {
    this.host = host;
  }
  getHost() {
    return this.host;
  }
  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private notify(cardId: string | null) {
    let failed = false;
    let firstError: unknown;
    for (const listener of this.listeners) {
      try {
        listener(cardId);
      } catch (error) {
        if (!failed) firstError = error;
        else reportObserverError(error);
        failed = true;
      }
    }
    if (failed) throw firstError;
  }
  setHost(host: InteractiveCardHost | null) {
    this.generation++;
    const previousPending = [...this.pending];
    this.pending.clear();
    this.queues.clear();
    this.host = host;
    for (const pending of previousPending) pending.abort();
    this.notify(null);
  }
  isSyncing(cardId: string, kind: InteractiveCardConfig["kind"]) {
    return this.queues.has(`${kind}:${cardId}`);
  }
  /** Call after a host-side change, including a change of signed-in identity. */
  refresh(cardId: string | null = null) {
    this.notify(cardId);
  }
  private async invoke<T>(
    signal: AbortSignal,
    run: (host: InteractiveCardHost, signal: AbortSignal) => Promise<T>,
    onStale?: (result: T) => void,
  ): Promise<T> {
    const host = this.host;
    if (!host || signal.aborted) throw new Error("互动卡片服务不可用");
    const generation = this.generation;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    this.pending.add(controller);
    try {
      const result = await run(host, controller.signal);
      if (controller.signal.aborted || generation !== this.generation) {
        onStale?.(result);
        throw new Error("互动卡片请求已失效");
      }
      return result;
    } finally {
      signal.removeEventListener("abort", abort);
      this.pending.delete(controller);
    }
  }
  /** Return an ID for insertion only after creation succeeds. Never insert a guessed ID. */
  async create(
    config: InteractiveCardConfig,
    signal: AbortSignal,
    copiedFrom: string | null = null,
    onAbandoned?: (cardId: string) => void,
  ): Promise<string> {
    const sourceId = copiedFrom === null ? null : copiedFrom.trim();
    if (sourceId === "") throw new Error("原活动 ID 为空");
    const result = await this.invoke(
      signal,
      (host, active) => host.createActivity(structuredClone(config), sourceId, active),
      (stale) => {
        const id = typeof stale?.cardId === "string" ? stale.cardId.trim() : "";
        if (id && id !== sourceId) onAbandoned?.(id);
      },
    );
    const id = typeof result?.cardId === "string" ? result.cardId.trim() : "";
    if (!id || (sourceId !== null && id === sourceId)) throw new Error("宿主未创建独立活动");
    return id;
  }
  async verify(cardId: string, config: InteractiveCardConfig, signal: AbortSignal): Promise<boolean> {
    if (!cardId.trim()) return false;
    return (
      (await this.invoke(signal, (host, active) =>
        host.verifyConfiguration(cardId, structuredClone(config), active),
      )) === true
    );
  }
  /** Serializes local writes for an activity; cross-client ordering remains the host's responsibility. */
  async sync(cardId: string, config: InteractiveCardConfig, signal: AbortSignal): Promise<void> {
    if (!cardId.trim()) throw new Error("活动 ID 为空");
    const key = `${config.kind}:${cardId}`;
    const generation = this.generation;
    const snapshot = structuredClone(config);
    const previous = this.queues.get(key) ?? Promise.resolve();
    let rejectedByObserver = false;
    const operation = previous
      .catch(() => {})
      .then(async () => {
        if (rejectedByObserver) return;
        if (signal.aborted || generation !== this.generation) throw new Error("互动卡片请求已失效");
        await this.invoke(signal, (host, active) => host.syncConfiguration(cardId, snapshot, active));
      });
    const settled = operation.then(
      () => {},
      () => {},
    );
    this.queues.set(key, settled);
    try {
      this.notify(cardId);
    } catch (error) {
      rejectedByObserver = true;
      void settled.then(() => {
        if (this.queues.get(key) === settled) this.queues.delete(key);
        try {
          this.notify(cardId);
        } catch (cleanupError) {
          // The original notification error has already been returned to the caller.
          reportObserverError(cleanupError);
        }
      });
      throw error;
    }
    let operationFailed = false;
    try {
      await operation;
    } catch (error) {
      operationFailed = true;
      throw error;
    } finally {
      if (this.queues.get(key) === settled) this.queues.delete(key);
      if (!operationFailed) this.notify(cardId);
      else {
        try {
          this.notify(cardId);
        } catch (observerError) {
          reportObserverError(observerError);
        }
      }
    }
  }
}

/** Clipboard copies never inherit an existing activity ID. The host may create a new activity explicitly. */
export function stripCopiedActivityIds(slice: import("@tiptap/pm/model").Slice): import("@tiptap/pm/model").Slice {
  const transform = (fragment: import("@tiptap/pm/model").Fragment): import("@tiptap/pm/model").Fragment => {
    const nodes: import("@tiptap/pm/model").Node[] = [];
    fragment.forEach((node) => {
      const content = node.content.size ? transform(node.content) : node.content;
      const copy =
        node.type.name === "semloEditorVote" || node.type.name === "semloEditorCheckin"
          ? node.type.create({ ...node.attrs, cardId: null }, content, node.marks)
          : node.copy(content);
      nodes.push(copy);
    });
    return Fragment.fromArray(nodes);
  };
  return new Slice(transform(slice.content), slice.openStart, slice.openEnd);
}

/** Creation requires a cleanup callback and the complete service for this activity kind. */
export function canCreateInteractiveActivity(
  host: InteractiveCardHost | null | undefined,
  kind: InteractiveCardConfig["kind"],
  onAbandoned: unknown,
): boolean {
  if (
    !host ||
    typeof onAbandoned !== "function" ||
    typeof host.createActivity !== "function" ||
    typeof host.verifyConfiguration !== "function" ||
    typeof host.syncConfiguration !== "function"
  )
    return false;
  if (kind === "vote") return typeof host.vote?.getStatus === "function" && typeof host.vote.submitVote === "function";
  return typeof host.checkin?.getStatus === "function" && typeof host.checkin.checkIn === "function";
}
