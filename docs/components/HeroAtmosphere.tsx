import { useEffect, useRef } from "react";

import "./hero-atmosphere.css";

export default function HeroAtmosphere() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const hero = canvas?.parentElement;
    if (!canvas || !hero) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    const editor = hero.querySelector<HTMLElement>(".semlo-editor-editor-frame");
    const onEditorFocus = () => hero.classList.add("semlo-editor-editor-focused");
    const onEditorBlur = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && editor?.contains(event.relatedTarget)) return;
      hero.classList.remove("semlo-editor-editor-focused");
    };

    editor?.addEventListener("focusin", onEditorFocus);
    editor?.addEventListener("focusout", onEditorBlur);
    if (editor?.contains(document.activeElement)) onEditorFocus();

    void import("./hero-atmosphere-scene")
      .then(({ createHeroAtmosphere }) => {
        if (!disposed) cleanup = createHeroAtmosphere(canvas, hero);
      })
      .catch(() => {
        // The CSS background and illustrated sprig remain available without WebGL.
      });

    return () => {
      disposed = true;
      cleanup?.();
      editor?.removeEventListener("focusin", onEditorFocus);
      editor?.removeEventListener("focusout", onEditorBlur);
      hero.classList.remove("semlo-editor-editor-focused");
    };
  }, []);

  return (
    <>
      <div className="semlo-editor-hero-sunlight" aria-hidden="true" />
      <canvas ref={canvasRef} className="semlo-editor-hero-atmosphere" aria-hidden="true" />
    </>
  );
}
