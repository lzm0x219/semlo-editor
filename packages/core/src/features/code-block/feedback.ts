type Feedback = { element: HTMLElement; timer?: number };

const feedbackByDocument = new WeakMap<Document, Feedback>();

function showCodeMessage(doc: Document, message: string, kind: "success" | "error" | "pending", duration?: number) {
  const win = doc.defaultView;
  if (!win || !doc.body) return () => {};

  const previous = feedbackByDocument.get(doc);
  if (previous) {
    if (previous.timer !== undefined) win.clearTimeout(previous.timer);
    previous.element.remove();
  }

  const element = doc.createElement("div");
  element.className = "semlo-editor-code-feedback";
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");
  element.setAttribute("aria-atomic", "true");
  const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("aria-hidden", "true");
  const circle = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "8");
  circle.setAttribute("cy", "8");
  circle.setAttribute("r", "7");
  circle.setAttribute("fill", kind === "success" ? "#00b96b" : kind === "error" ? "#e5484d" : "#8c8c8c");
  const check = doc.createElementNS("http://www.w3.org/2000/svg", "path");
  check.setAttribute(
    "d",
    kind === "success" ? "M4.5 8.1 7 10.6l4.5-5" : kind === "error" ? "M5.5 5.5l5 5m0-5-5 5" : "M8 4.5v3.7l2.4 1.3",
  );
  check.setAttribute("fill", "none");
  check.setAttribute("stroke", "white");
  check.setAttribute("stroke-width", "1.5");
  check.setAttribute("stroke-linecap", "round");
  check.setAttribute("stroke-linejoin", "round");
  icon.append(circle, check);
  const label = doc.createElement("span");
  label.textContent = message;
  element.append(icon, label);
  doc.body.append(element);

  const dismiss = () => {
    const active = feedbackByDocument.get(doc);
    if (active?.element !== element) return;
    if (active.timer !== undefined) win.clearTimeout(active.timer);
    element.remove();
    feedbackByDocument.delete(doc);
  };
  const feedback: Feedback = { element };
  if (duration !== undefined) feedback.timer = win.setTimeout(dismiss, duration);
  feedbackByDocument.set(doc, feedback);
  return dismiss;
}

/** Show a short, non-interrupting code-block confirmation in this document. */
export function showCodeFeedback(doc: Document, message: string, kind: "success" | "error" = "success") {
  return showCodeMessage(doc, message, kind, 2200);
}

/** Keep progress visible until the originating operation finishes or is cancelled. */
export function showCodeProgress(doc: Document, message: string) {
  return showCodeMessage(doc, message, "pending");
}
