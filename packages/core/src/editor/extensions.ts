import { Extension, type Mark as TiptapMark } from "@tiptap/core";
import type { AnyExtension, Extensions } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";

import { createBlockActions } from "../features/blocks/actions/extension";
import { Callout } from "../features/blocks/callout";
import { Column, Columns } from "../features/blocks/columns";
import { SemloEditorDetails, SemloEditorDetailsSummary, SemloEditorDetailsContent } from "../features/blocks/details";
import { Calendar } from "../features/calendar/calendar";
import { DateCard } from "../features/cards/date-card";
import { EncryptedText } from "../features/cards/encrypted-text";
import { BlockFormula, Formula } from "../features/cards/formula";
import { Status } from "../features/cards/status";
import { CodeCard } from "../features/code-block/extension";
import { CodeBlockKeyboard } from "../features/code-block/keyboard";
import { Database } from "../features/database/extension";
import { CanvasBoard } from "../features/drawing/canvas/extension";
import { Diagram } from "../features/drawing/diagram/extension";
import { Mindmap } from "../features/drawing/mindmap/extension";
import { HeadingEndSelection } from "../features/heading/end-selection";
import { HeadingFold } from "../features/heading/fold";
import { HeadingKeyboard } from "../features/heading/keyboard";
import { HeadingNumbering } from "../features/heading/numbering";
import { slashCommands } from "../features/insertion/suggestion";
import { CheckinCard } from "../features/interactive/checkin-card";
import type { InteractiveCardHostController } from "../features/interactive/interactive-card-host";
import { VoteCard } from "../features/interactive/vote-card";
import { FlatListTab } from "../features/list/flat-list-tab";
import { ListFold } from "../features/list/list-fold";
import { OrderedListNumbering } from "../features/list/ordered-numbering";
import { OrderedListStyles } from "../features/list/ordered-style";
import { Attachment } from "../features/media/attachment/extension";
import { attachmentUploadExtension } from "../features/media/attachment/uploads";
import { Audio, Video } from "../features/media/audio-video/extension";
import { Gallery } from "../features/media/gallery/extension";
import { ImageCard } from "../features/media/image/extension";
import { imageUploadExtension } from "../features/media/image/uploads";
import { SemloEditorEmbed } from "../features/references/embed";
import { EmbedBookmarkInline, EmbedBookmarkBlock } from "../features/references/embed-bookmark";
import { getLinkState } from "../features/references/link-command";
import { Mention, mentionSuggestion } from "../features/references/mention";
import { SemloEditorTable } from "../features/table/extension";
import {
  SemloEditorColor,
  SemloEditorFontFamily,
  SemloEditorFontSize,
  TextGradient,
} from "../features/text/color-gradient";
import { DocumentFontExtension } from "../features/text/document-font";
import { FontSizeShortcuts } from "../features/text/font-size-shortcuts";
import { LocalFontName } from "../features/text/local-fonts";
import { ParagraphLayout } from "../features/text/paragraph-layout";
import { TransactionGuard } from "../runtime/transaction-guard";
import type { EditorOptions } from "../types";
import { createStarterKitWithCodeFonts } from "./starter-kit";

type Integrations = Pick<
  EditorOptions,
  | "uploadImage"
  | "uploadAttachment"
  | "searchMentions"
  | "currentUser"
  | "resolveEmbedMetadata"
  | "encryptedTextProvider"
>;

export function createEditorExtensions({
  options,
  bubbleExtension,
  getIntegrations,
  interactiveController,
  registerViewDisposer,
  pointerExtension,
  openInsertBelow,
  openLink,
  slashActions,
  report,
}: {
  options: EditorOptions;
  bubbleExtension?: () => AnyExtension;
  getIntegrations: () => Integrations;
  interactiveController: InteractiveCardHostController;
  registerViewDisposer: (dispose: () => void) => () => void;
  pointerExtension: () => AnyExtension;
  openInsertBelow: NonNullable<Parameters<typeof createBlockActions>[0]>["openInsertBelow"];
  openLink: () => void;
  slashActions: Parameters<typeof slashCommands>;
  report: (error: unknown) => void;
}): Extensions {
  return [
    pointerExtension(),
    EncryptedText.configure({ getProvider: () => getIntegrations().encryptedTextProvider }),
    CheckinCard.configure({ host: interactiveController }),
    VoteCard.configure({ host: interactiveController }),
    createStarterKitWithCodeFonts(options.extensions ?? []).extend({
      addExtensions() {
        return (this.parent?.() ?? []).map((extension) =>
          extension.type === "mark" && extension.name === "link"
            ? (extension as TiptapMark).extend({
                parseHTML() {
                  return [{ tag: "a[data-semlo-editor-link-placeholder]:not([href])" }, ...(this.parent?.() ?? [])];
                },
                renderHTML(props) {
                  const { HTMLAttributes } = props;
                  if (HTMLAttributes.href == null)
                    return ["a", { ...HTMLAttributes, "data-semlo-editor-link-placeholder": "" }, 0];
                  return this.parent?.(props) ?? ["a", HTMLAttributes, 0];
                },
              })
            : extension,
        );
      },
    }),
    HeadingNumbering,
    HeadingFold,
    HeadingKeyboard,
    HeadingEndSelection,
    FlatListTab,
    ListFold,
    OrderedListStyles,
    OrderedListNumbering,
    FontSizeShortcuts,
    createBlockActions({ openInsertBelow }),
    ImageCard,
    Placeholder.configure({ placeholder: options.placeholder ?? "输入内容，或输入 / 插入更多内容" }),
    SemloEditorTable.configure({ resizable: true, registerViewDisposer }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TextStyle,
    SemloEditorFontFamily,
    LocalFontName,
    DocumentFontExtension,
    SemloEditorFontSize,
    SemloEditorColor,
    TextGradient,
    ParagraphLayout,
    Highlight.configure({ multicolor: true }),
    Subscript,
    Superscript,
    Callout,
    CodeCard.configure({ exitOnTripleEnter: false }),
    CodeBlockKeyboard,
    Diagram,
    Mindmap,
    CanvasBoard,
    SemloEditorEmbed,
    EmbedBookmarkInline.configure({ resolveMetadata: getIntegrations().resolveEmbedMetadata }),
    EmbedBookmarkBlock.configure({ resolveMetadata: getIntegrations().resolveEmbedMetadata }),
    Gallery.configure({ getUploadImage: () => getIntegrations().uploadImage, onError: report }),
    Database.configure({
      getSearchMentions: () => getIntegrations().searchMentions,
      getUploadImage: () => getIntegrations().uploadImage,
      getUploadAttachment: () => getIntegrations().uploadAttachment,
      getCurrentUser: () => getIntegrations().currentUser,
      onError: report,
    }),
    Columns,
    Column,
    Attachment,
    Video,
    Audio,
    Status,
    Formula,
    BlockFormula,
    DateCard,
    Calendar,
    Mention,
    SemloEditorDetails.configure({
      persist: true,
      renderToggleButton: ({ element, isOpen }) => element.setAttribute("aria-label", isOpen ? "收起内容" : "展开内容"),
    }),
    SemloEditorDetailsSummary,
    SemloEditorDetailsContent,
    imageUploadExtension(() => getIntegrations().uploadImage, report),
    attachmentUploadExtension,
    ...(bubbleExtension ? [bubbleExtension()] : []),
    Extension.create({
      name: "semloEditorShortcuts",
      addKeyboardShortcuts() {
        return {
          "Mod-k": () => {
            if (!getLinkState(this.editor).enabled) return false;
            openLink();
            return true;
          },
          "Mod-Shift-c": () => this.editor.commands.setTextAlign("center"),
        };
      },
    }),
    slashCommands(...slashActions),
    mentionSuggestion(() => getIntegrations().searchMentions, report),
    ...(options.extensions ?? []),
    TransactionGuard,
  ];
}
