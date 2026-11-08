import type { EditorIntegrations, EditorOptions } from "../types";

type CompleteIntegrations = EditorIntegrations & Record<keyof EditorIntegrations, unknown>;

function readIntegrations(source: EditorIntegrations): EditorIntegrations {
  return {
    uploadImage: source.uploadImage,
    uploadAttachment: source.uploadAttachment,
    resolveAttachmentPreview: source.resolveAttachmentPreview,
    searchMentions: source.searchMentions,
    runCode: source.runCode,
    translate: source.translate,
    writingService: source.writingService,
    writingFeedback: source.writingFeedback,
    databaseAiFill: source.databaseAiFill,
    currentUser: source.currentUser,
    resolveEmbedMetadata: source.resolveEmbedMetadata,
    yuqueContentProvider: source.yuqueContentProvider,
    encryptedTextProvider: source.encryptedTextProvider,
    interactiveCardHost: source.interactiveCardHost,
    onInteractiveCardAbandoned: source.onInteractiveCardAbandoned,
  } satisfies CompleteIntegrations;
}

export function createIntegrationBindings(options: EditorOptions) {
  let current = readIntegrations(options);
  return {
    get current() {
      return current;
    },
    replace(next: EditorIntegrations) {
      const replacement = readIntegrations(next);
      // 在替换前比较宿主能力，调用方据此使依赖旧能力的会话或请求失效。
      const changes = {
        searchChanged: current.searchMentions !== replacement.searchMentions,
        runnerChanged: current.runCode !== replacement.runCode,
        translationChanged: current.translate !== replacement.translate,
        writingChanged: current.writingService !== replacement.writingService,
        writingFeedbackChanged: current.writingFeedback !== replacement.writingFeedback,
        databaseAiChanged: current.databaseAiFill !== replacement.databaseAiFill,
        embedResolverChanged: current.resolveEmbedMetadata !== replacement.resolveEmbedMetadata,
        yuqueProviderChanged: current.yuqueContentProvider !== replacement.yuqueContentProvider,
        encryptedProviderChanged: current.encryptedTextProvider !== replacement.encryptedTextProvider,
        interactiveChanged: current.interactiveCardHost !== replacement.interactiveCardHost,
        interactiveCallbackChanged: current.onInteractiveCardAbandoned !== replacement.onInteractiveCardAbandoned,
      };
      current = replacement;
      return changes;
    },
  };
}
