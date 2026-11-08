import { runCleanupSteps } from "../runtime/cleanup";
import type { createIntegrationBindings } from "./bindings";

type Changes = ReturnType<ReturnType<typeof createIntegrationBindings>["replace"]>;
type Notification =
  | "attachment"
  | "interactive"
  | "runner"
  | "translation"
  | "writing"
  | "writingFeedback"
  | "databaseAi"
  | "embed"
  | "yuque"
  | "cardMenu"
  | "slash"
  | "imageUpload"
  | "search"
  | "encrypted";

interface IntegrationUpdateActions extends Record<Notification, () => void> {
  unavailable(): boolean;
  markEncryptedChanged(): void;
}

/** 每个编辑器独立协调通知，失败的通知保留至后续调用重试。 */
export function createIntegrationUpdateCoordinator(actions: IntegrationUpdateActions) {
  const pending: Record<Notification, boolean> = {
    attachment: false,
    interactive: false,
    runner: false,
    translation: false,
    writing: false,
    writingFeedback: false,
    databaseAi: false,
    embed: false,
    yuque: false,
    cardMenu: false,
    slash: false,
    imageUpload: false,
    search: false,
    encrypted: false,
  };

  const notify = (key: Notification, afterDestroy = false) => {
    if (!pending[key] || (!afterDestroy && actions.unavailable())) return;
    // 先移除待通知标记，允许回调同步重入并处理更新后的完整配置。
    pending[key] = false;
    try {
      actions[key]();
    } catch (error) {
      pending[key] = true;
      throw error;
    }
  };

  return (changes: Changes) => {
    const menuChanged =
      changes.writingChanged ||
      changes.interactiveChanged ||
      changes.interactiveCallbackChanged ||
      changes.yuqueProviderChanged ||
      changes.encryptedProviderChanged;
    pending.interactive ||= changes.interactiveChanged;
    pending.attachment = true;
    pending.runner ||= changes.runnerChanged;
    pending.translation ||= changes.translationChanged;
    pending.writing ||= changes.writingChanged;
    pending.writingFeedback ||= changes.writingFeedbackChanged;
    pending.databaseAi ||= changes.databaseAiChanged;
    pending.embed ||= changes.embedResolverChanged;
    pending.yuque ||= changes.yuqueProviderChanged;
    pending.cardMenu ||= menuChanged;
    pending.slash ||= menuChanged;
    pending.imageUpload = true;
    pending.search ||= changes.searchChanged;
    if (changes.encryptedProviderChanged) {
      actions.markEncryptedChanged();
      pending.encrypted = true;
    }
    runCleanupSteps(
      [
        () => notify("attachment", true),
        () => notify("interactive"),
        () => notify("runner"),
        () => notify("translation"),
        () => notify("writing", true),
        () => notify("writingFeedback", true),
        () => notify("databaseAi"),
        () => notify("embed"),
        () => notify("yuque"),
        () => notify("cardMenu"),
        () => notify("slash"),
        () => notify("imageUpload"),
        () => notify("search"),
        // 其他通知失败或同步销毁时仍须使旧加密会话失效。
        () => notify("encrypted", true),
      ],
      "Editor integration update failed",
    );
  };
}
