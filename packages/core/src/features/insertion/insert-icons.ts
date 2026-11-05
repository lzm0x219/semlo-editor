/** Small, locally drawn illustrations for insertion-menu entries. */
export const insertIcons: Readonly<Record<string, string>> = {
  ai: '<path d="m8 23 2-6L22 5l4 4-12 12-6 2Z" fill="#d8f1e4"/><path d="m19 8 4 4M10 17l4 4M7 25l3-2"/><path d="M8 4v5M5.5 6.5h5M24 18v5M21.5 20.5h5" stroke="#66ba90"/>',
  canvas:
    '<rect x="3.5" y="5" width="25" height="21" rx="2"/><path d="m8 20 5-6 5 4 5-8"/><circle cx="8" cy="20" r="2" fill="#e0f2e7"/><circle cx="13" cy="14" r="2" fill="#e9e2fa"/><circle cx="18" cy="18" r="2" fill="#fff0c9"/><circle cx="23" cy="10" r="2" fill="#d8eafa"/>',
  mindmap:
    '<path d="M15 16H9M17 15l6-6M17 17l6 6M16 13V7M16 19v6" stroke="#a9a3bb"/><circle cx="16" cy="16" r="3.5" fill="#a998d8" stroke="#8976c2"/><circle cx="7" cy="16" r="2.5" fill="#f4efff" stroke="#a998d8"/><circle cx="25" cy="7" r="2.5" fill="#e5f4ec" stroke="#8ccdaf"/><circle cx="25" cy="25" r="2.5" fill="#fff1d7" stroke="#e8c66e"/><circle cx="16" cy="5" r="2" fill="#e5efff" stroke="#9ab9e7"/><circle cx="16" cy="27" r="2" fill="#f4efff" stroke="#a998d8"/>',
  flowchart:
    '<path d="M16 8v4M12 17H8v5M20 17h4v5" stroke="#858b87"/><rect x="12" y="3" width="8" height="5" rx="1" fill="#e2f2e8"/><path d="m16 12 4.5 4.5L16 21l-4.5-4.5Z" fill="#fff1c5"/><rect x="4" y="22" width="8" height="6" rx="1" fill="#e3edf8"/><rect x="20" y="22" width="8" height="6" rx="1" fill="#f1eafa"/>',
  database:
    '<rect x="4" y="5" width="24" height="22" rx="2"/><path d="M4 11h24M4 17h24M4 22h24M12 5v22M20 5v22"/><path d="M5 6h6v4H5z" fill="#ccebdc" stroke="none"/><path d="M13 12h6v4h-6z" fill="#e3effa" stroke="none"/><path d="M21 18h6v3h-6z" fill="#fff0c7" stroke="none"/>',
  album:
    '<path d="M6 8V5h20v19h-3M3 10h20v18H3z"/><circle cx="9" cy="15" r="2" fill="#f6d478" stroke="none"/><path d="m5 25 5-5 4 3 3-4 4 6" fill="#d8eee2"/>',
  kanban:
    '<rect x="3.5" y="5" width="25" height="22" rx="2"/><path d="M12 5v22M20 5v22"/><rect x="5.5" y="8" width="4.5" height="5" rx="1" fill="#d5efe0" stroke="none"/><rect x="14" y="8" width="4" height="7" rx="1" fill="#e3ecfb" stroke="none"/><rect x="22" y="8" width="4.5" height="5" rx="1" fill="#faedcc" stroke="none"/><path d="M6 17h4M14 19h4M22 17h4" stroke="#aeb7b2"/>',
  uml: '<rect x="4" y="4" width="10" height="9" rx="1"/><path d="M4 7h10M7 10h4M18 14h10v11H18zM18 18h10M21 21h4M9 13v4h9"/><path d="M6 5h6" stroke="#78c59f"/>',
  diagram:
    '<rect x="3" y="4" width="26" height="24" rx="2"/><path d="M8 10h7M8 15h5M8 20h7M19 10h5v4h-5zM21.5 14v4M19 18h5v4h-5z"/><path d="M8 25h9" stroke="#85cda9"/>',
  gallery:
    '<rect x="3" y="6" width="26" height="20" rx="2"/><path d="M11 6v20M21 6v20"/><circle cx="7" cy="12" r="1.5" fill="#f2d17f" stroke="none"/><path d="m4 22 3-4 3 3M12 22l4-6 4 6M22 22l3-4 3 4" stroke="#87c6a4"/>',
  yuque:
    '<path d="M5 5h9c2 0 3 1 3 3v20c-1-2-2-3-4-3H5zM27 5h-7c-2 0-3 1-3 3v20c1-2 2-3 4-3h6z"/><path d="M8 10h6M8 14h6M20 10h4M20 14h4" stroke="#80c8a3"/>',
  vote: '<path d="M7 15H5l-2 11h26l-2-11h-2M10 18h12M10 5h12v10H10z"/><path d="m13 10 2 2 4-4" stroke="#69bd90" stroke-width="1.6"/>',
  checkin:
    '<rect x="4" y="6" width="24" height="21" rx="2"/><path d="M4 12h24M10 3v6M22 3v6M8 16h4M8 21h4M16 16h4"/><circle cx="23" cy="22" r="5" fill="#e3f4e9"/><path d="m20.5 22 1.7 1.7 3-3.3" stroke="#64b98b"/>',
  encrypted:
    '<rect x="6" y="13" width="20" height="15" rx="2" fill="#e8f4ec"/><path d="M10 13V9a6 6 0 0 1 12 0v4"/><circle cx="16" cy="19" r="2"/><path d="M16 21v3"/>',
  youku:
    '<circle cx="16" cy="16" r="11" stroke="#dbe2e1"/><path d="M10 8v16l7-8z" fill="#50a9e8" stroke="none"/><path d="m17 16 6-7v14z" fill="#ee6d7d" stroke="none"/>',
  bilibili:
    '<path d="m10 4 3 4M22 4l-3 4" stroke="#65b9d6" stroke-width="1.5"/><rect x="5" y="8" width="22" height="18" rx="4" fill="#e2f5fa" stroke="#65b9d6"/><path d="m11 14 2 2M21 14l-2 2M12 20c2 2 6 2 8 0" stroke="#65b9d6"/>',
  netease:
    '<circle cx="16" cy="16" r="11" fill="#e95455" stroke="none"/><path d="M19 8v11a3 3 0 1 1-2-2.8V10l6-2v8a3 3 0 1 1-2-2.8" stroke="#fff" stroke-width="1.5"/>',
  taobao:
    '<rect x="5" y="6" width="22" height="20" rx="5" fill="#f38b4a" stroke="none"/><path d="m13 10 9 6-9 6z" fill="#fff" stroke="none"/>',
  amap: '<path d="M16 28s-8-7-8-15a8 8 0 0 1 16 0c0 8-8 15-8 15Z" fill="#e5f1ff" stroke="#6c9de3"/><circle cx="16" cy="13" r="3" fill="#6ebc91" stroke="none"/><path d="M12 23l8-11" stroke="#f2c26f" stroke-width="2"/>',
  modao:
    '<rect x="5" y="5" width="22" height="22" rx="5" fill="#f0eaff" stroke="#ae93da"/><path d="m10 20 3-8 3 5 3-5 3 8M10 22h12" stroke="#8f75be" stroke-width="1.5"/>',
  figma:
    '<rect x="10" y="4" width="6" height="8" rx="3" fill="#ee8277" stroke="none"/><rect x="16" y="4" width="6" height="8" rx="3" fill="#f4b086" stroke="none"/><rect x="10" y="12" width="6" height="8" rx="3" fill="#b594df" stroke="none"/><circle cx="19" cy="16" r="3" fill="#87c5ed" stroke="none"/><rect x="10" y="20" width="6" height="8" rx="3" fill="#84c99e" stroke="none"/>',
  processon:
    '<rect x="5" y="4" width="22" height="24" rx="3" fill="#edf3ff" stroke="#9bb6df"/><rect x="12" y="7" width="8" height="5" rx="1" fill="#8fb6e9" stroke="none"/><rect x="7" y="20" width="7" height="5" rx="1" fill="#c7d9f2" stroke="none"/><rect x="18" y="20" width="7" height="5" rx="1" fill="#c7d9f2" stroke="none"/><path d="M16 12v4M10.5 20v-4h11v4" stroke="#6e91c5"/>',
  canva:
    '<circle cx="16" cy="16" r="11" fill="#6fc4c3" stroke="none"/><path d="M21 11c-2-3-7-3-9 0-3 4-1 10 3 11 3 1 5-1 6-3" stroke="#fff" stroke-width="2"/>',
  juejin:
    '<path d="m16 4 8 5-8 5-8-5z" fill="#7aaaf1" stroke="none"/><path d="m7 14 9 6 9-6M7 20l9 6 9-6" stroke="#6b9ee6" stroke-width="2"/>',
  codepen:
    '<path d="m16 4 11 7v10l-11 7-11-7V11zM5 11l11 7 11-7M5 21l11-7 11 7M16 4v10M16 18v10" stroke="#555" stroke-width="1.4"/>',
  yida: '<rect x="5" y="5" width="9" height="9" rx="2" fill="#8dcfae" stroke="none"/><rect x="18" y="18" width="9" height="9" rx="2" fill="#9dbce8" stroke="none"/><path d="M14 9h4v9M9 14v9h9" stroke="#84a8a0" stroke-width="1.5"/>',
  jinshuju:
    '<rect x="5" y="5" width="22" height="22" rx="4" fill="#fff3db" stroke="#e9c476"/><path d="M10 21v-5M15 21v-9M20 21V9M24 21H8" stroke="#e7a94a" stroke-width="1.8"/>',
};
