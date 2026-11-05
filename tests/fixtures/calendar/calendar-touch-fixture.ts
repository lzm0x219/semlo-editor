import "../../../packages/core/src/styles/style.css";
import { createEditor } from "../../../packages/core/src/index";

const host = document.createElement("div");
host.style.width = "850px";
document.body.append(host);
Object.assign(window, {
  touchCalendarEditor: createEditor({
    element: host,
    outline: false,
    onChange: (snapshot) => {
      Object.assign(window, { touchCalendarChange: snapshot });
      if (Reflect.get(window, "touchCalendarDestroyOnChange")) {
        const controller = Reflect.get(window, "touchCalendarEditor");
        if (!controller) throw new Error("Calendar fixture is not initialized");
        controller.destroy();
      }
    },
    content: {
      type: "doc",
      content: [
        { type: "paragraph" },
        {
          type: "semloEditorCalendar",
          attrs: {
            events: [{ id: "touch", title: "日程", start: "2026-11-05", end: "2026-11-14", description: "", color: 0 }],
          },
        },
        { type: "paragraph" },
      ],
    },
  }),
});
