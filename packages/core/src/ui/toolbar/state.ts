import type { Editor } from "@tiptap/core";

import { headingStyleStateFromSelection } from "../../features/heading/style-command";
import { toolbarAlignmentIcon } from "./icons";
import { readToolbarAlignment, readToolbarSelection, readToolbarTypography } from "./read-state";
import { refreshToolbarButtons, type ToolbarButton } from "./toolbar";

export function refreshToolbarState({
  editor,
  buttons,
  heading,
  fontFamily,
  fontLabel,
  fontSize,
  alignment,
  orderedArrow,
  indent,
  lineHeight,
  textColor,
  highlightColor,
  script,
  shell,
}: {
  editor: Editor;
  buttons: ToolbarButton[];
  heading: HTMLButtonElement;
  fontFamily: HTMLButtonElement;
  fontLabel: HTMLElement;
  fontSize: HTMLButtonElement;
  alignment: HTMLButtonElement;
  orderedArrow: HTMLButtonElement;
  indent: HTMLButtonElement;
  lineHeight: HTMLButtonElement;
  textColor: { setDisabled: (disabled: boolean) => void };
  highlightColor: { setDisabled: (disabled: boolean) => void };
  script: HTMLButtonElement;
  shell: HTMLElement;
}) {
  const { selectedHeading, detailsSelection, detailsRestricted } = readToolbarSelection(editor);
  const headingStyle = headingStyleStateFromSelection(editor, selectedHeading, detailsSelection);
  refreshToolbarButtons(editor, buttons, detailsRestricted);
  heading.textContent = headingStyle.level === null ? "" : headingStyle.level ? `标题${headingStyle.level}` : "正文";
  heading.disabled = !headingStyle.enabled;
  fontFamily.disabled = !editor.isEditable;
  const typography = readToolbarTypography(editor, selectedHeading);
  fontLabel.textContent = typography.fontLabel;
  fontSize.textContent = typography.fontSize;
  fontSize.disabled = !editor.isEditable || selectedHeading.headingsOnly || detailsSelection === "summary";
  alignment.dataset.value = readToolbarAlignment(editor);
  alignment.innerHTML = toolbarAlignmentIcon(alignment.dataset.value);
  alignment.disabled = !editor.isEditable || detailsRestricted;
  orderedArrow.disabled = !editor.isEditable || detailsRestricted;
  indent.disabled = !editor.isEditable || detailsRestricted;
  lineHeight.disabled = !editor.isEditable || detailsRestricted;
  textColor.setDisabled(!editor.isEditable);
  highlightColor.setDisabled(!editor.isEditable);
  script.disabled = !editor.isEditable;
  shell.classList.toggle("semlo-editor-readonly", !editor.isEditable);
  editor.view.dom.setAttribute("aria-readonly", String(!editor.isEditable));
}
