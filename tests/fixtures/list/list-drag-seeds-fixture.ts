import { Editor } from "@tiptap/core";

import { createStarterKitWithCodeFonts } from "../../../packages/core/src/editor/starter-kit";
import {
  OrderedListStyles,
  serializeOrderedListStyles,
  setOrderedListStyle,
} from "../../../packages/core/src/features/list/ordered-style";
import { serializeOrderedListOrdinals } from "../../../packages/core/src/features/list/ordinals";
import { toggleBulletListPreservingTaskIndent } from "../../../packages/core/src/features/list/task-list-conversion";
import { ParagraphLayout } from "../../../packages/core/src/features/text/paragraph-layout";
import { createEditor } from "../../../packages/core/src/index";

import "../../../demo/editor.css";

Object.assign(window, {
  createListDragSeedsEditor: createEditor,
  toggleBulletListPreservingTaskIndent,
  OrderedListStyles,
  ParagraphLayout,
  serializeOrderedListOrdinals,
  serializeOrderedListStyles,
  setOrderedListStyle,
  Editor,
  StarterKit: createStarterKitWithCodeFonts([]),
});
