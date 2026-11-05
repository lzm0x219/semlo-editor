import { trackPopupPosition } from "../../platform/dom/dropdown";
import { linkPopup } from "../../platform/dom/popup-owner";

export interface CodeBlockOption {
  value: string;
  label: string;
  note?: string;
}

interface CodeBlockControlOptions {
  doc: Document;
  label: string;
  className: string;
  options: CodeBlockOption[];
  searchable?: boolean;
  unknownNote?: string;
  onChoose: (value: string) => void;
}

/** A body-mounted picker so the code card's overflow does not clip its menu. */
export function createCodeBlockControl({
  doc,
  label,
  className,
  options,
  searchable,
  unknownNote,
  onChoose,
}: CodeBlockControlOptions) {
  const element = doc.createElement("button");
  element.type = "button";
  element.className = `semlo-editor-code-select ${className}`;
  element.setAttribute("aria-label", label);
  element.setAttribute("aria-haspopup", "dialog");
  element.setAttribute("aria-expanded", "false");
  let value = "";
  let closePopup: (() => void) | undefined;
  let refreshPopup: (() => void) | undefined;

  const setValue = (next: string) => {
    if (next === value) return;
    value = next;
    const selected = options.find((option) => option.value === value);
    element.textContent = selected?.label ?? value;
    element.title = selected?.note
      ? `${selected.label}（${selected.note}）`
      : (selected?.label ?? (unknownNote ? `${value}（${unknownNote}）` : value));
    element.dataset.value = value;
    refreshPopup?.();
  };

  const open = () => {
    if (element.disabled) return;
    const popup = doc.createElement("div");
    popup.className = `semlo-editor-code-menu${searchable ? " is-searchable" : ""}`;
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", `${label}选项`);
    const search = searchable ? doc.createElement("input") : undefined;
    if (search) {
      const width = element.getBoundingClientRect().width;
      search.className = `${element.className} semlo-editor-code-language-search`;
      search.type = "text";
      search.style.width = `${width}px`;
      search.placeholder = options.find((option) => option.value === value)?.label ?? value;
      search.setAttribute("aria-label", "搜索代码语言");
      search.setAttribute("role", "combobox");
      search.setAttribute("aria-autocomplete", "list");
      search.setAttribute("aria-expanded", "true");
      element.hidden = true;
      element.after(search);
    }
    const list = doc.createElement("div");
    list.className = "semlo-editor-code-menu-list";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", `${label}选项`);
    if (!search) list.tabIndex = 0;
    popup.append(list);
    doc.body.append(popup);
    const unlink = linkPopup(element, popup);
    list.id = `${popup.id}-list`;
    search?.setAttribute("aria-controls", list.id);
    element.setAttribute("aria-expanded", "true");

    let closed = false;
    let stopPosition = () => {};
    let filtered: CodeBlockOption[] = [];
    let activeIndex = 0;
    const focusOwner = search ?? list;
    const close = () => {
      if (closed) return;
      closed = true;
      stopPosition();
      doc.removeEventListener("pointerdown", outside, true);
      unlink();
      popup.remove();
      search?.remove();
      element.hidden = false;
      element.setAttribute("aria-expanded", "false");
      closePopup = undefined;
      refreshPopup = undefined;
    };
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!popup.contains(target) && !element.contains(target) && target !== search) close();
    };
    const revealActive = () => {
      const row = list.children.item(activeIndex) as HTMLElement | null;
      if (!row) return;
      const rowBounds = row.getBoundingClientRect();
      const listBounds = list.getBoundingClientRect();
      if (rowBounds.top < listBounds.top) list.scrollTop -= listBounds.top - rowBounds.top;
      else if (rowBounds.bottom > listBounds.bottom) list.scrollTop += rowBounds.bottom - listBounds.bottom;
    };
    const updateActive = () => {
      const rows = list.querySelectorAll<HTMLElement>('[role="option"]');
      rows.forEach((row, index) => row.classList.toggle("is-active", index === activeIndex));
      const active = rows[activeIndex];
      if (active) focusOwner.setAttribute("aria-activedescendant", active.id);
      else focusOwner.removeAttribute("aria-activedescendant");
      revealActive();
    };
    const choose = (chosen: CodeBlockOption) => {
      close();
      onChoose(chosen.value);
    };
    const render = () => {
      const query = search?.value.trim().toLocaleLowerCase() ?? "";
      filtered = options.filter(
        (option) =>
          option.label.toLocaleLowerCase().includes(query) || option.value.toLocaleLowerCase().includes(query),
      );
      const selectedIndex = filtered.findIndex((option) => option.value === value);
      activeIndex = !query && selectedIndex >= 0 ? selectedIndex : 0;
      list.replaceChildren();
      filtered.forEach((option, index) => {
        const row = doc.createElement("button");
        row.type = "button";
        row.className = "semlo-editor-code-menu-option";
        row.id = `${list.id}-option-${index}`;
        row.dataset.value = option.value;
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", String(option.value === value));
        row.tabIndex = -1;
        const text = doc.createElement("span");
        text.className = "semlo-editor-code-menu-label";
        text.textContent = option.label;
        const check = doc.createElement("span");
        check.className = "semlo-editor-code-menu-check";
        check.setAttribute("aria-hidden", "true");
        check.textContent = option.value === value ? "✓" : "";
        row.append(check, text);
        if (option.note) {
          const note = doc.createElement("span");
          note.className = "semlo-editor-code-menu-note";
          note.textContent = option.note;
          row.append(note);
          row.setAttribute("aria-label", `${option.label}（${option.note}）`);
        }
        // Keep focus on the search/list so selection never moves the editor's cursor.
        row.addEventListener("mousedown", (event) => event.preventDefault());
        row.addEventListener("click", () => choose(option));
        row.addEventListener("pointermove", () => {
          if (activeIndex !== index) {
            activeIndex = index;
            updateActive();
          }
        });
        list.append(row);
      });
      updateActive();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        element.focus();
      } else if (event.key === "Tab") {
        close();
        element.focus();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!filtered.length) return;
        activeIndex = (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length;
        updateActive();
      } else if (!search && (event.key === "Home" || event.key === "End")) {
        event.preventDefault();
        if (!filtered.length) return;
        activeIndex = event.key === "Home" ? 0 : filtered.length - 1;
        updateActive();
      } else if (event.key === "Enter" || (!search && event.key === " ")) {
        event.preventDefault();
        if (filtered[activeIndex]) choose(filtered[activeIndex]);
      }
    };
    search?.addEventListener("input", render);
    focusOwner.addEventListener("keydown", keydown);
    doc.addEventListener("pointerdown", outside, true);
    closePopup = close;
    refreshPopup = render;
    render();
    const position = trackPopupPosition(search ?? element, popup, close);
    stopPosition = position.stop;
    position.update();
    if (!closed) {
      // Positioning can constrain the list after render; reveal the selection again.
      revealActive();
      focusOwner.focus();
    }
  };

  element.addEventListener("click", () => {
    if (closePopup) closePopup();
    else open();
  });

  return {
    element,
    setValue,
    setDisabled(disabled: boolean) {
      element.disabled = disabled;
      if (disabled) closePopup?.();
    },
    destroy() {
      closePopup?.();
    },
  };
}
