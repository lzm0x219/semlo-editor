import { Table, type TableOptions } from "@tiptap/extension-table";
import { columnResizing, columnResizingPluginKey, isInTable } from "@tiptap/pm/tables";

import {
  cellBackground,
  parsedCellBackground,
  parsedCellTextAlign,
  parsedCellTextColor,
  cellVerticalAlign,
  cellLineHeight,
  pastedFontSize,
  cellFontSizeChain,
  cellFontVariables,
} from "./attributes";
import { tableContextMenu } from "./context-menu";
import { tableEdgesPlugin, type TableViewDisposerRegistration } from "./edges";
import { mergedTablePaste } from "./paste";
import { SemloEditorTableView, managedResize, fitColumnChanges } from "./resize";
import { tableHeaderDecorations, tableStyleAttributes, tableStyleOutput } from "./toolbar";

export const SemloEditorTable = Table.extend<TableOptions & { registerViewDisposer?: TableViewDisposerRegistration }>({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      "Shift-Tab": () => {
        if (!this.editor.isEditable) return false;
        return this.editor.commands.goToPreviousCell() || isInTable(this.editor.state);
      },
    };
  },
  addGlobalAttributes() {
    return [
      ...(this.parent?.() ?? []),
      { types: ["table"], attributes: tableStyleAttributes() },
      {
        types: ["tableCell", "tableHeader"],
        attributes: {
          semloEditorCellLineHeight: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              cellLineHeight(element.getAttribute("data-semlo-editor-cell-line-height")),
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = cellLineHeight(attributes.semloEditorCellLineHeight);
              return value ? { "data-semlo-editor-cell-line-height": value, style: `line-height: ${value}` } : {};
            },
          },
          semloEditorCellFontVariables: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const value = element.getAttribute("data-semlo-editor-cell-font-variables");
              if (!value) return null;
              try {
                return cellFontVariables(JSON.parse(value));
              } catch {
                return null;
              }
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = cellFontVariables(attributes.semloEditorCellFontVariables);
              return value
                ? {
                    "data-semlo-editor-cell-font-variables": JSON.stringify(value),
                    style: Object.entries(value)
                      .map(([name, item]) => `${name}: ${item}`)
                      .join("; "),
                  }
                : {};
            },
          },
          semloEditorCellFontSizeChain: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const value = element.getAttribute("data-semlo-editor-cell-font-size-chain");
              if (!value) return null;
              try {
                return cellFontSizeChain(JSON.parse(value));
              } catch {
                return null;
              }
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = cellFontSizeChain(attributes.semloEditorCellFontSizeChain);
              return value ? { "data-semlo-editor-cell-font-size-chain": JSON.stringify(value) } : {};
            },
          },
          semloEditorCellBaseFontSize: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              pastedFontSize(element.getAttribute("data-semlo-editor-cell-base-font-size") ?? "", false),
            renderHTML: (attributes: Record<string, unknown>) => {
              const value =
                typeof attributes.semloEditorCellBaseFontSize === "string"
                  ? pastedFontSize(attributes.semloEditorCellBaseFontSize, false)
                  : null;
              return value ? { "data-semlo-editor-cell-base-font-size": value, style: `font-size: ${value}` } : {};
            },
          },
          semloEditorCellTextColor: {
            default: null,
            parseHTML: (element: HTMLElement) => parsedCellTextColor(element),
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = cellBackground(attributes.semloEditorCellTextColor);
              return value ? { style: `color: ${value}` } : {};
            },
          },
          semloEditorCellTextAlign: {
            default: null,
            parseHTML: (element: HTMLElement) => parsedCellTextAlign(element),
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = attributes.semloEditorCellTextAlign;
              return typeof value === "string" && ["left", "center", "right", "justify"].includes(value)
                ? { style: `text-align: ${value}` }
                : {};
            },
          },
          semloEditorCellVerticalAlign: {
            default: null,
            parseHTML: (element: HTMLElement) => cellVerticalAlign(element.style.verticalAlign),
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = cellVerticalAlign(attributes.semloEditorCellVerticalAlign);
              return value ? { style: `vertical-align: ${value}` } : {};
            },
          },
          semloEditorCellBackground: {
            default: null,
            parseHTML: (element: HTMLElement) => parsedCellBackground(element),
            renderHTML: (attributes: Record<string, unknown>) => {
              const color = cellBackground(attributes.semloEditorCellBackground);
              return color ? { style: `background-color: ${color}` } : {};
            },
          },
          semloEditorSequence: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const value = Number(element.getAttribute("data-semlo-editor-sequence"));
              return Number.isSafeInteger(value) && value > 0 ? value : null;
            },
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.semloEditorSequence
                ? { "data-semlo-editor-sequence": String(attributes.semloEditorSequence) }
                : {},
          },
        },
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const output = this.parent?.({ node, HTMLAttributes });
    return output ? tableStyleOutput(output, node, this.options.cellMinWidth) : ["table", HTMLAttributes, ["tbody", 0]];
  },
  addProseMirrorPlugins() {
    const plugins = this.parent?.() ?? [];
    plugins.unshift(mergedTablePaste(this.editor));
    plugins.push(tableContextMenu(this.options.registerViewDisposer));
    plugins.push(fitColumnChanges(this.options.cellMinWidth));
    plugins.push(tableHeaderDecorations());
    plugins.push(tableEdgesPlugin(this.options.registerViewDisposer));
    if (!this.options.resizable) return plugins;
    let index = plugins.findIndex((plugin) => plugin.spec.key === columnResizingPluginKey);
    if (index === -1) {
      plugins.unshift(
        columnResizing({
          handleWidth: this.options.handleWidth,
          cellMinWidth: this.options.cellMinWidth,
          defaultCellMinWidth: this.options.cellMinWidth,
          View: null,
          lastColumnResizable: this.options.lastColumnResizable,
        }),
      );
      index = 0;
    }
    plugins.splice(index, 0, managedResize(this.options.cellMinWidth));
    return plugins;
  },
}).configure({ View: SemloEditorTableView });
