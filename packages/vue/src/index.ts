import { createEditor } from "@semlo-editor/core";
import type {
  EditorContent,
  EditorController,
  EditorControllerWithResults,
  EditorIntegrations,
  EditorOptions,
  EditorSnapshot,
} from "@semlo-editor/core";
import { defineComponent, getCurrentInstance, h, onBeforeUnmount, onMounted, ref, watch, type PropType } from "vue";

type CompleteIntegrations = EditorIntegrations & Record<keyof EditorIntegrations, unknown>;

export interface SemloEditorExposed {
  getEditor(): EditorControllerWithResults | undefined;
}

const integrationProps = {
  uploadImage: { type: Function as PropType<EditorOptions["uploadImage"]>, default: undefined },
  uploadAttachment: { type: Function as PropType<EditorOptions["uploadAttachment"]>, default: undefined },
  resolveAttachmentPreview: {
    type: Function as PropType<EditorOptions["resolveAttachmentPreview"]>,
    default: undefined,
  },
  searchMentions: { type: Function as PropType<EditorOptions["searchMentions"]>, default: undefined },
  encryptedTextProvider: { type: Object as PropType<EditorOptions["encryptedTextProvider"]>, default: undefined },
  yuqueContentProvider: { type: Object as PropType<EditorOptions["yuqueContentProvider"]>, default: undefined },
  runCode: { type: Function as PropType<EditorOptions["runCode"]>, default: undefined },
  translate: { type: Function as PropType<EditorOptions["translate"]>, default: undefined },
  writingService: { type: Function as PropType<EditorOptions["writingService"]>, default: undefined },
  writingFeedback: { type: Function as PropType<EditorOptions["writingFeedback"]>, default: undefined },
  databaseAiFill: { type: Function as PropType<EditorOptions["databaseAiFill"]>, default: undefined },
  currentUser: { type: Function as PropType<EditorOptions["currentUser"]>, default: undefined },
  resolveEmbedMetadata: { type: Function as PropType<EditorOptions["resolveEmbedMetadata"]>, default: undefined },
  interactiveCardHost: { type: Object as PropType<EditorOptions["interactiveCardHost"]>, default: undefined },
  onInteractiveCardAbandoned: {
    type: Function as PropType<EditorOptions["onInteractiveCardAbandoned"]>,
    default: undefined,
  },
} satisfies Record<keyof EditorIntegrations, unknown>;

const SemloEditorComponent = defineComponent({
  name: "SemloEditor",
  // 显式转发属性，避免 Vue 再次将被过滤的内容属性应用到宿主。
  inheritAttrs: false,
  props: {
    content: { type: [Object, String] as PropType<EditorContent>, default: undefined },
    editable: { type: Boolean, default: true },
    placeholder: { type: String, default: undefined },
    toolbar: { type: [Boolean, Function] as PropType<EditorOptions["toolbar"]>, default: true },
    floatingToolbar: { type: [Boolean, Function] as PropType<EditorOptions["floatingToolbar"]>, default: undefined },
    outline: { type: Boolean, default: true },
    extensions: { type: Array as PropType<EditorOptions["extensions"]>, default: undefined },
    codeBlockPreferences: { type: Object as PropType<EditorOptions["codeBlockPreferences"]>, default: undefined },
    headingFoldPreferences: { type: Object as PropType<EditorOptions["headingFoldPreferences"]>, default: undefined },
    ...integrationProps,
  },
  emits: {
    change: (_snapshot: EditorSnapshot) => true,
    ready: (_editor: EditorController) => true,
    error: (_error: Error) => true,
  },
  setup(props, { emit, expose, attrs }) {
    const component = getCurrentInstance();
    const host = ref<HTMLElement>();
    let editor: EditorControllerWithResults | undefined;
    onMounted(() => {
      if (!host.value) return;
      const emitChange = (snapshot: EditorSnapshot) => emit("change", snapshot);
      editor = createEditor({
        element: host.value,
        content: props.content,
        editable: props.editable,
        placeholder: props.placeholder,
        toolbar: props.toolbar,
        floatingToolbar: props.floatingToolbar,
        outline: props.outline,
        extensions: props.extensions,
        codeBlockPreferences: props.codeBlockPreferences,
        headingFoldPreferences: props.headingFoldPreferences,
        ...({
          uploadImage: props.uploadImage,
          uploadAttachment: props.uploadAttachment,
          resolveAttachmentPreview: props.resolveAttachmentPreview,
          searchMentions: props.searchMentions,
          encryptedTextProvider: props.encryptedTextProvider,
          yuqueContentProvider: props.yuqueContentProvider,
          runCode: props.runCode,
          translate: props.translate,
          writingService: props.writingService,
          writingFeedback: props.writingFeedback,
          databaseAiFill: props.databaseAiFill,
          currentUser: props.currentUser,
          resolveEmbedMetadata: props.resolveEmbedMetadata,
          interactiveCardHost: props.interactiveCardHost,
          onInteractiveCardAbandoned: props.onInteractiveCardAbandoned,
        } satisfies CompleteIntegrations),
        // 事件监听器可能动态变化，且已声明的 emit 不在 attrs 中。
        get onChange() {
          const listeners = component?.vnode.props;
          return listeners?.onChange || listeners?.onChangeOnce ? emitChange : undefined;
        },
        onError: (error) => emit("error", error),
      });
      emit("ready", editor);
    });
    watch(
      () => props.content,
      (value) => {
        if (value !== undefined) editor?.setContent(value);
      },
      { deep: true },
    );
    watch(
      () => props.editable,
      (value) => editor?.setEditable(value),
    );
    watch(
      () =>
        ({
          uploadImage: props.uploadImage,
          uploadAttachment: props.uploadAttachment,
          resolveAttachmentPreview: props.resolveAttachmentPreview,
          searchMentions: props.searchMentions,
          encryptedTextProvider: props.encryptedTextProvider,
          yuqueContentProvider: props.yuqueContentProvider,
          runCode: props.runCode,
          translate: props.translate,
          writingService: props.writingService,
          writingFeedback: props.writingFeedback,
          databaseAiFill: props.databaseAiFill,
          currentUser: props.currentUser,
          resolveEmbedMetadata: props.resolveEmbedMetadata,
          interactiveCardHost: props.interactiveCardHost,
          onInteractiveCardAbandoned: props.onInteractiveCardAbandoned,
        }) satisfies CompleteIntegrations,
      (integrations) => editor?.setIntegrations(integrations),
    );
    onBeforeUnmount(() => {
      editor?.destroy();
      editor = undefined;
    });
    expose({ getEditor: () => editor } satisfies SemloEditorExposed);
    return () => {
      const {
        children: _children,
        dangerouslySetInnerHTML: _dangerouslySetInnerHTML,
        innerHTML: _innerHTML,
        innerText: _innerText,
        outerHTML: _outerHTML,
        outerText: _outerText,
        textContent: _textContent,
        ".innerHTML": _forcedInnerHTML,
        ".innerText": _forcedInnerText,
        ".outerHTML": _forcedOuterHTML,
        ".outerText": _forcedOuterText,
        ".textContent": _forcedTextContent,
        ...domProps
      } = attrs;
      return h("div", { ...domProps, ref: host });
    };
  },
});

// Vue 的 setup expose 不会自动进入组件实例声明；补充与运行时一致的类型。
export const SemloEditor = SemloEditorComponent as typeof SemloEditorComponent & {
  new (): InstanceType<typeof SemloEditorComponent> & SemloEditorExposed;
};
