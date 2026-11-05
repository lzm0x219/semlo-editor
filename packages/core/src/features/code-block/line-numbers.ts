/** Keep logical line numbers aligned when a single code line wraps visually. */
export function createCodeLineNumbers({
  code,
  numbers,
  content,
  wrapping,
  visible,
}: {
  code: HTMLElement;
  numbers: HTMLElement;
  content: () => string;
  wrapping: () => boolean;
  visible: () => boolean;
}) {
  const doc = code.ownerDocument;
  const win = doc.defaultView;
  // Bound the number of layout reads and detached DOM writes per frame.
  const linesPerFrame = 128;
  const millisecondsPerFrame = 7;
  let frame: number | undefined;
  let viewportFrame: number | undefined;
  let generation = 0;
  let destroyed = false;
  let overlay: HTMLElement | undefined;
  let savedColor: { value: string; priority: string } | undefined;
  let renderViewport: (() => void) | undefined;
  let listeningForScroll = false;
  let intersection: IntersectionObserver | undefined;

  const isGutterHidden = () =>
    numbers.style.getPropertyValue("color") === "transparent" &&
    numbers.style.getPropertyPriority("color") === "important";

  const hideGutter = () => {
    // Remember an external inline color change made while work was pending.
    if (!savedColor || !isGutterHidden())
      savedColor = {
        value: numbers.style.getPropertyValue("color"),
        priority: numbers.style.getPropertyPriority("color"),
      };
    numbers.style.setProperty("color", "transparent", "important");
  };

  const restoreColor = () => {
    if (!savedColor || !isGutterHidden()) return;
    if (savedColor.value) numbers.style.setProperty("color", savedColor.value, savedColor.priority);
    else numbers.style.removeProperty("color");
  };

  const stopListeningForScroll = () => {
    if (!listeningForScroll) return;
    doc.removeEventListener("scroll", scrolled, true);
    win?.removeEventListener("scroll", scrolled);
    intersection?.disconnect();
    intersection = undefined;
    listeningForScroll = false;
  };

  const restoreGutter = () => {
    renderViewport = undefined;
    if (viewportFrame !== undefined) win?.cancelAnimationFrame(viewportFrame);
    viewportFrame = undefined;
    stopListeningForScroll();
    overlay?.remove();
    restoreColor();
    overlay = undefined;
    savedColor = undefined;
  };

  const requestViewport = () => {
    if (!win || !renderViewport || viewportFrame !== undefined) return;
    viewportFrame = win.requestAnimationFrame(() => {
      viewportFrame = undefined;
      renderViewport?.();
    });
  };

  const scrolled = (event: Event) => {
    const target = event.target;
    if (target === doc || target === win || (win && target instanceof win.Node && target.contains(code)))
      requestViewport();
  };

  const render = (version: number, confirmingMismatch = false) => {
    if (destroyed || version !== generation) return;
    if (!visible()) {
      restoreGutter();
      return;
    }
    const text = content();
    const lines = text.split("\n");
    if (!wrapping()) {
      restoreGutter();
      const plain = lines.map((_, index) => String(index + 1)).join("\n");
      if (numbers.textContent !== plain || numbers.querySelector(".semlo-editor-code-number-line"))
        numbers.textContent = plain;
      return;
    }
    if (!text.length) {
      restoreGutter();
      numbers.textContent = "1";
      return;
    }
    // A newly mounted large block has no previous gutter to retain while its
    // actual wrapped line boxes are measured across frames.
    if (!numbers.textContent) numbers.textContent = lines.map((_, index) => String(index + 1)).join("\n");
    // A collapsed or detached block has no measurable line boxes. ResizeObserver
    // schedules the real measurement after it becomes visible again.
    const bounds = code.getBoundingClientRect();
    if (!code.isConnected || !numbers.isConnected || bounds.width <= 0 || bounds.height <= 0) {
      restoreGutter();
      return;
    }
    const computed = win?.getComputedStyle(code);
    const lineHeight = parseFloat(computed?.lineHeight ?? "") || (parseFloat(computed?.fontSize ?? "") || 14) * 1.45;
    const styleSignature = () => {
      const style = win?.getComputedStyle(code);
      return [
        style?.fontFamily,
        style?.fontSize,
        style?.fontWeight,
        style?.fontStyle,
        style?.fontStretch,
        style?.fontVariant,
        style?.fontFeatureSettings,
        style?.fontVariationSettings,
        style?.lineHeight,
        style?.letterSpacing,
        style?.wordSpacing,
        style?.tabSize,
        style?.whiteSpace,
        style?.overflowWrap,
        style?.wordBreak,
        style?.lineBreak,
        style?.textIndent,
        style?.textTransform,
        style?.direction,
        style?.writingMode,
      ].join("|");
    };
    const initialStyle = styleSignature();
    // offsetHeight is integer-rounded, which can introduce a tiny systematic
    // error on every row of a long block. Computed height retains fractions.
    const computedHeight = parseFloat(computed?.height ?? "");
    const measuredScale = computedHeight > 0 ? bounds.height / computedHeight : 1;
    const scale = Math.round(measuredScale * 100000) / 100000 || 1;
    const walker = doc.createTreeWalker(code, win?.NodeFilter.SHOW_TEXT ?? 4);
    const textNodes: Array<{ node: Text; start: number; end: number }> = [];
    let total = 0;
    let domText = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const textNode = node as Text;
      // Widget decorations are not part of the document text. Their DOM can
      // still affect wrapping, so ranges spanning them keep their layout.
      const widget = textNode.parentElement?.closest(".ProseMirror-widget");
      if (widget && widget !== code && code.contains(widget)) continue;
      textNodes.push({ node: textNode, start: total, end: total + textNode.length });
      total += textNode.length;
      domText += textNode.data;
    }
    // NodeView updates may precede ProseMirror's content DOM patch. Wait one
    // more frame and recheck before treating a mismatch as persistent; the
    // mutation observer restarts this work if the patch arrives meanwhile.
    if (domText !== text || !textNodes.length) {
      if (win && !confirmingMismatch) {
        frame = win.requestAnimationFrame(() => {
          frame = undefined;
          render(version, true);
        });
      } else {
        // Unknown DOM additions cannot be mapped to document offsets safely.
        // Show logical line numbers instead of leaving the gutter invisible.
        restoreGutter();
        numbers.textContent = lines.map((_, index) => String(index + 1)).join("\n");
      }
      return;
    }
    const resolve = (offset: number, forward = false) => {
      let low = 0;
      let high = textNodes.length - 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (textNodes[middle].end < offset || (forward && textNodes[middle].end === offset)) low = middle + 1;
        else high = middle;
      }
      const entry = textNodes[low];
      return { node: entry.node, offset: Math.max(0, Math.min(entry.node.length, offset - entry.start)) };
    };

    if (win && lines.length > linesPerFrame) {
      if (!overlay) {
        if (!savedColor) hideGutter();
        restoreColor();
        const visibleColor = win.getComputedStyle(numbers).color;
        hideGutter();
        overlay = doc.createElement("span");
        overlay.className = "semlo-editor-code-visible-numbers";
        Object.assign(overlay.style, { position: "absolute", inset: "0", pointerEvents: "none", color: visibleColor });
        numbers.append(overlay);
        doc.addEventListener("scroll", scrolled, true);
        win.addEventListener("scroll", scrolled);
        listeningForScroll = true;
        if (typeof win.IntersectionObserver === "function") {
          intersection = new win.IntersectionObserver(requestViewport);
          intersection.observe(code);
        }
      } else if (savedColor) {
        // Re-read the inherited color after a theme change while keeping the
        // previous rows hidden during the same JavaScript task.
        if (!isGutterHidden()) hideGutter();
        restoreColor();
        overlay.style.color = win.getComputedStyle(numbers).color;
        hideGutter();
      }
      const offsets: number[] = [];
      let nextOffset = 0;
      for (const line of lines) {
        offsets.push(nextOffset);
        nextOffset += line.length + 1;
      }
      const viewportRange = doc.createRange();
      const topAt = (index: number, origin: number) => {
        const at = offsets[index];
        if (at === text.length) {
          const trailing = code.lastElementChild;
          if (!trailing?.matches("br.ProseMirror-trailingBreak")) return undefined;
          const marker = trailing.getBoundingClientRect();
          return marker.height > 0 ? marker.top - origin : undefined;
        }
        const start = resolve(at, true);
        const end = resolve(at + 1);
        viewportRange.setStart(start.node, start.offset);
        viewportRange.setEnd(end.node, end.offset);
        const rect = [...viewportRange.getClientRects()].find((item) => item.height > 0 || item.width > 0);
        return rect ? rect.top - origin : undefined;
      };
      renderViewport = () => {
        if (destroyed || version !== generation || !overlay || !visible() || !wrapping() || content() !== text) return;
        const rect = code.getBoundingClientRect();
        if (
          !rect.width ||
          !rect.height ||
          Math.abs(rect.width - bounds.width) > 0.01 ||
          styleSignature() !== initialStyle
        )
          return;
        let clipTop = 0;
        let clipBottom = win.innerHeight;
        for (let parent = code.parentElement; parent && parent !== doc.documentElement; parent = parent.parentElement) {
          if (!/^(auto|scroll|hidden|clip|overlay)$/.test(win.getComputedStyle(parent).overflowY)) continue;
          const box = parent.getBoundingClientRect();
          clipTop = Math.max(clipTop, box.top);
          clipBottom = Math.min(clipBottom, box.bottom);
        }
        if (clipBottom <= clipTop || rect.bottom < clipTop || rect.top > clipBottom) {
          overlay.replaceChildren();
          overlay.style.visibility = "visible";
          return;
        }
        const startY = clipTop - rect.top;
        const endY = clipBottom - rect.top;
        const initial = topAt(0, rect.top);
        if (initial === undefined) return;
        const findLine = (target: number) => {
          let low = 0;
          let high = lines.length;
          while (low < high) {
            const mid = Math.floor((low + high) / 2);
            const top = topAt(mid, rect.top);
            if (top !== undefined && top <= target) low = mid + 1;
            else high = mid;
          }
          return Math.max(0, low - 1);
        };
        const first = Math.max(0, findLine(startY) - 1);
        const last = Math.min(lines.length - 1, findLine(endY) + 1);
        const base = (rect.top - numbers.getBoundingClientRect().top) / scale;
        const right = win.getComputedStyle(numbers).paddingRight;
        const visibleRows = doc.createDocumentFragment();
        for (let line = first; line <= last; line += 1) {
          const top = topAt(line, rect.top);
          if (top === undefined) continue;
          const row = doc.createElement("span");
          row.className = "semlo-editor-code-visible-number";
          Object.assign(row.style, {
            position: "absolute",
            left: "0",
            right,
            top: `${base + (top - initial) / scale}px`,
          });
          row.textContent = String(line + 1);
          visibleRows.append(row);
        }
        overlay.replaceChildren(visibleRows);
        overlay.style.visibility = "visible";
      };
      renderViewport();
    } else restoreGutter();

    const fragment = doc.createDocumentFragment();
    const range = doc.createRange();
    let index = 0;
    let offset = 0;
    let previousRow: HTMLElement | undefined;
    let previousTop: number | undefined;
    const measure = () => {
      if (destroyed || version !== generation) return;
      const currentBounds = code.getBoundingClientRect();
      if (
        !visible() ||
        !wrapping() ||
        !code.isConnected ||
        !numbers.isConnected ||
        content() !== text ||
        Math.abs(currentBounds.width - bounds.width) > 0.01 ||
        styleSignature() !== initialStyle
      ) {
        schedule();
        return;
      }
      const endIndex = win ? Math.min(index + linesPerFrame, lines.length) : lines.length;
      const started = win?.performance.now() ?? 0;
      while (index < endIndex) {
        const line = lines[index];
        let height = lineHeight;
        let lineTop: number | undefined;
        // Include a line break for an empty line so its rendered line box can
        // be measured too. A final empty line has no following character.
        const measurementLength = line.length || (index + 1 < lines.length ? 1 : 0);
        if (measurementLength) {
          const start = resolve(offset, true);
          const end = resolve(offset + measurementLength);
          range.setStart(start.node, start.offset);
          range.setEnd(end.node, end.offset);
          const tops = [...range.getClientRects()]
            .filter((rect) => rect.width > 0 || rect.height > 0)
            // Viewport coordinates move while the user scrolls between frames.
            .map((rect) => rect.top - currentBounds.top)
            .sort((a, b) => a - b);
          lineTop = tops[0];
          let count = 0;
          let previous = Number.NEGATIVE_INFINITY;
          for (const top of tops) {
            if (top - previous >= lineHeight * scale * 0.6) {
              count += 1;
              previous = top;
            }
          }
          height = lineHeight * Math.max(1, count);
        } else {
          // ProseMirror renders a trailing <br> for the final empty line.
          // If no marker is available, retain the computed line-height fallback.
          const trailing = code.lastElementChild;
          if (trailing?.matches("br.ProseMirror-trailingBreak")) {
            const marker = trailing.getBoundingClientRect();
            if (marker.height > 0) lineTop = marker.top - currentBounds.top;
          }
        }
        if (previousRow && previousTop !== undefined && lineTop !== undefined && lineTop > previousTop) {
          // Real line starts avoid fractional line-height rounding drift across
          // thousands of rows, including when the editor is zoomed.
          previousRow.style.height = `${(lineTop - previousTop) / scale}px`;
        }
        offset += line.length + 1;
        const row = doc.createElement("span");
        row.className = "semlo-editor-code-number-line";
        row.style.height = `${height}px`;
        row.textContent = String(index + 1) + (index + 1 < lines.length ? "\n" : "");
        fragment.append(row);
        previousRow = row;
        previousTop = lineTop;
        index += 1;
        // A single complex line may itself be slow; process at least one line
        // while avoiding another full batch in that frame.
        if (win && win.performance.now() - started >= millisecondsPerFrame) break;
      }
      if (index < lines.length) {
        frame = win?.requestAnimationFrame(() => {
          frame = undefined;
          measure();
        });
        return;
      }
      // Keep the old gutter intact until every row belongs to this snapshot.
      // Preserve the user's current horizontal/vertical scroll during the swap.
      const scroll = code.closest<HTMLElement>(".semlo-editor-code-body");
      const left = scroll?.scrollLeft;
      const top = scroll?.scrollTop;
      renderViewport = undefined;
      if (viewportFrame !== undefined) win?.cancelAnimationFrame(viewportFrame);
      viewportFrame = undefined;
      stopListeningForScroll();
      restoreColor();
      numbers.replaceChildren(fragment);
      overlay = undefined;
      savedColor = undefined;
      if (scroll && left !== undefined && top !== undefined) {
        if (scroll.scrollLeft !== left) scroll.scrollLeft = left;
        if (scroll.scrollTop !== top) scroll.scrollTop = top;
      }
    };
    if (win && lines.length > linesPerFrame) {
      frame = win.requestAnimationFrame(() => {
        frame = undefined;
        measure();
      });
    } else measure();
  };

  function schedule() {
    if (destroyed) return;
    generation += 1;
    if (frame !== undefined) win?.cancelAnimationFrame(frame);
    const version = generation;
    if (!win) {
      frame = undefined;
      render(version);
      return;
    }
    const isWrapped = wrapping();
    const currentText = content();
    if (isWrapped && visible() && !numbers.textContent)
      numbers.textContent = currentText
        .split("\n")
        .map((_, index) => String(index + 1))
        .join("\n");
    const deferForLayout = isWrapped && currentText.split("\n", linesPerFrame + 1).length > linesPerFrame;
    if (deferForLayout && visible()) {
      // Do not briefly paint stale or unmeasured numbers before the exact
      // visible rows are ready. The gutter is already hidden from assistive
      // technology by the owning code block.
      hideGutter();
      if (overlay) overlay.style.visibility = "hidden";
    }
    frame = win.requestAnimationFrame(() => {
      frame = undefined;
      if (destroyed || version !== generation) return;
      if (deferForLayout) {
        frame = win.requestAnimationFrame(() => {
          frame = undefined;
          render(version);
        });
      } else render(version);
    });
  }
  const observer = win && typeof win.ResizeObserver === "function" ? new win.ResizeObserver(schedule) : undefined;
  observer?.observe(code);
  const mutations = win && typeof win.MutationObserver === "function" ? new win.MutationObserver(schedule) : undefined;
  mutations?.observe(code, { subtree: true, childList: true, characterData: true, attributes: true });
  const colorMutations =
    win && typeof win.MutationObserver === "function"
      ? new win.MutationObserver(() => {
          if (savedColor && !isGutterHidden()) schedule();
        })
      : undefined;
  colorMutations?.observe(numbers, { attributes: true, attributeFilter: ["style"] });
  win?.addEventListener("resize", schedule);
  doc.fonts?.addEventListener("loadingdone", schedule);
  return {
    schedule,
    destroy() {
      destroyed = true;
      generation += 1;
      if (frame !== undefined) win?.cancelAnimationFrame(frame);
      if (viewportFrame !== undefined) win?.cancelAnimationFrame(viewportFrame);
      observer?.disconnect();
      mutations?.disconnect();
      colorMutations?.disconnect();
      win?.removeEventListener("resize", schedule);
      restoreGutter();
      doc.fonts?.removeEventListener("loadingdone", schedule);
    },
  };
}
