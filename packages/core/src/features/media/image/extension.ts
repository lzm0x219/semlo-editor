import { mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { closeHistory } from "@tiptap/pm/history";
import { type DOMOutputSpec } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";

import { safeImageLinkURL } from "../shared/image-link";
import { fullImageCrop, imageCrop, imageCropClip, imageRotation, imageTransform } from "../shared/transform";
import { imageStyle, imageCaption, imageHref, imageElement, imageStyleCSS, dimension } from "./attributes";
import { createImageNodeView } from "./node-view";

/** Image attributes remain compatible with the standard Tiptap image node. */
export const ImageCard = Image.extend({
  inline() {
    return true;
  },
  group() {
    return "inline";
  },
  addAttributes() {
    const inherited = this.parent?.() ?? {};
    return {
      ...inherited,
      ...Object.fromEntries(
        ["src", "alt", "title", "width", "height"].map((name) => [
          name,
          {
            ...inherited[name],
            parseHTML: (element: HTMLElement) => imageElement(element)?.getAttribute(name) ?? null,
          },
        ]),
      ),
      semloEditorImageStyle: {
        default: "none",
        parseHTML: (element: HTMLElement) =>
          imageStyle(imageElement(element)?.getAttribute("data-semlo-editor-image-style")),
        renderHTML: (attributes: Record<string, unknown>) => {
          const style = imageStyle(attributes.semloEditorImageStyle);
          return style === "none" ? {} : { "data-semlo-editor-image-style": style, style: imageStyleCSS(style) };
        },
      },
      semloEditorImageRotation: {
        default: 0,
        parseHTML: (element: HTMLElement) =>
          imageRotation(imageElement(element)?.getAttribute("data-semlo-editor-image-rotation")),
        renderHTML: (attributes: Record<string, unknown>) => {
          const rotation = imageRotation(attributes.semloEditorImageRotation);
          return rotation ? { "data-semlo-editor-image-rotation": String(rotation) } : {};
        },
      },
      semloEditorImageCrop: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          imageCrop(imageElement(element)?.getAttribute("data-semlo-editor-image-crop")),
        renderHTML: (attributes: Record<string, unknown>) => {
          const crop = imageCrop(attributes.semloEditorImageCrop);
          return crop ? { "data-semlo-editor-image-crop": JSON.stringify(crop) } : {};
        },
      },
      semloEditorCaption: {
        default: "",
        rendered: false,
        parseHTML: (element: HTMLElement) => imageCaption(element.getAttribute("data-semlo-editor-caption")),
      },
      semloEditorCaptionVisible: {
        default: false,
        rendered: false,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-semlo-editor-caption-visible") === "true",
      },
      semloEditorImageHref: {
        default: "",
        rendered: false,
        parseHTML: (element: HTMLElement) =>
          imageHref(
            element.getAttribute("data-semlo-editor-image-href") ??
              imageElement(element)?.closest("a[href]")?.getAttribute("href"),
          ),
      },
      semloEditorImageOpenInCurrent: {
        default: false,
        rendered: false,
        parseHTML: (element: HTMLElement) => {
          const explicit = element.getAttribute("data-semlo-editor-image-current");
          if (explicit !== null) return explicit === "true";
          const anchor = imageElement(element)?.closest("a[href]");
          return !!anchor && anchor.getAttribute("target") !== "_blank";
        },
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-semlo-editor-image]",
        priority: 100,
        getAttrs: (element) => {
          const source = imageElement(element as HTMLElement)?.getAttribute("src");
          return source && (this.options.allowBase64 || !source.toLowerCase().startsWith("data:")) ? {} : false;
        },
      },
      {
        // Preserve the link on an image without swallowing mixed link text.
        tag: "a[href]",
        priority: 100,
        getAttrs: (element) => {
          const anchor = element as HTMLElement;
          const image = imageElement(anchor);
          const source = image?.getAttribute("src");
          const standalone = Array.from(anchor.childNodes).every(
            (child) => child === image || (child.nodeType === 3 && !child.textContent?.trim()),
          );
          return source && standalone && (this.options.allowBase64 || !source.toLowerCase().startsWith("data:"))
            ? {}
            : false;
        },
      },
      ...(this.parent?.() ?? []),
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const rotation = imageRotation(node.attrs.semloEditorImageRotation);
    const crop = imageCrop(node.attrs.semloEditorImageCrop);
    const width = dimension(node.attrs.width);
    const height = dimension(node.attrs.height);
    const imageAttributes = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes);
    if (!width) delete imageAttributes.width;
    if (!height) delete imageAttributes.height;
    const geometry =
      (rotation || crop) && width && height ? imageTransform(rotation, crop ?? fullImageCrop(), width, height) : null;
    // A transformed image needs a real layout box for its visible dimensions.
    // Use inline styles so exported HTML and rich clipboard contents work without
    // the editor stylesheet. Normal images retain their original markup.
    if (geometry) {
      const clip = crop ? `; clip-path: ${imageCropClip(crop, rotation)}; border: 0; box-shadow: none` : "";
      imageAttributes.style = `${imageAttributes.style ?? ""}; position: absolute; left: ${geometry.left}%; top: ${geometry.top}%; width: ${geometry.width}%; height: ${geometry.height}%; max-width: none; margin: 0; transform: translate(-50%, -50%) rotate(${rotation}deg)${clip}`;
    } else if (rotation) {
      imageAttributes.style = `${imageAttributes.style ?? ""}; transform: rotate(${rotation}deg)`;
    }
    const image: DOMOutputSpec = ["img", imageAttributes];
    const visual: DOMOutputSpec = geometry
      ? [
          "span",
          {
            style: `position: relative; display: inline-block; width: ${width}px; max-width: 100%; aspect-ratio: ${width} / ${height}; vertical-align: top; overflow: hidden; ${crop ? imageStyleCSS(imageStyle(node.attrs.semloEditorImageStyle)) : ""}`,
          },
          image,
        ]
      : image;
    const caption = imageCaption(node.attrs.semloEditorCaption);
    const captionVisible = node.attrs.semloEditorCaptionVisible === true;
    const href = imageHref(node.attrs.semloEditorImageHref);
    const current = node.attrs.semloEditorImageOpenInCurrent === true;
    if (!caption && !captionVisible && !href && !current && !rotation && !crop) return image;
    const destination = safeImageLinkURL(href);
    const content: DOMOutputSpec = destination
      ? ["a", { href: destination, target: current ? "_self" : "_blank", rel: "noopener noreferrer" }, visual]
      : visual;
    const children: DOMOutputSpec[] = [content];
    if (captionVisible && caption)
      children.push([
        "span",
        {
          "data-semlo-editor-image-caption": "",
          style:
            "display: block; padding-top: 8px; color: #8a8a8a; font-size: 14px; line-height: 22px; overflow-wrap: break-word; word-break: break-all",
        },
        caption,
      ]);
    return [
      "span",
      {
        "data-semlo-editor-image": "",
        "data-semlo-editor-caption": caption,
        "data-semlo-editor-caption-visible": String(captionVisible),
        "data-semlo-editor-image-href": href,
        "data-semlo-editor-image-current": String(current),
        style: `display: inline-flex; ${width ? `width: ${width}px; ` : ""}max-width: 100%; flex-direction: column; vertical-align: text-bottom; text-align: center`,
      },
      ...children,
    ];
  },
  renderText({ node }) {
    return node.attrs.alt || "";
  },
  addKeyboardShortcuts() {
    const removeAdjacentImage = (before: boolean) => {
      const selection = this.editor.state.selection;
      let from: number;
      let to: number;
      if (selection instanceof NodeSelection && selection.node.type === this.type) {
        from = selection.from;
        to = selection.to;
      } else {
        if (!(selection instanceof TextSelection) || !selection.empty) return false;
        const position = selection.from;
        const adjacent = before ? selection.$from.nodeBefore : selection.$from.nodeAfter;
        if (!adjacent || adjacent.type !== this.type) return false;
        from = before ? position - adjacent.nodeSize : position;
        to = before ? position : position + adjacent.nodeSize;
      }
      const removed = this.editor.commands.command(({ tr }) => {
        closeHistory(tr).deleteRange(from, to);
        return true;
      });
      if (removed) this.editor.view.dispatch(closeHistory(this.editor.state.tr));
      return removed;
    };
    return {
      ...this.parent?.(),
      Backspace: () => removeAdjacentImage(true),
      Delete: () => removeAdjacentImage(false),
    };
  },
  addNodeView() {
    return createImageNodeView();
  },
});
