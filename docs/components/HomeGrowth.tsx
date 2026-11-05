import { useEffect, useRef, type ReactNode } from "react";

export function HeroSprig() {
  return (
    <div className="semlo-editor-sprig" aria-hidden="true">
      <div className="semlo-editor-sprig-sway">
        <svg viewBox="0 0 180 290" fill="none">
          <defs>
            <linearGradient
              id="semlo-editor-sprig-soft"
              x1="28"
              y1="220"
              x2="140"
              y2="55"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#99C2A1" />
              <stop offset="1" stopColor="#C8DEC5" />
            </linearGradient>
            <linearGradient
              id="semlo-editor-sprig-fresh"
              x1="55"
              y1="225"
              x2="145"
              y2="55"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#83B192" />
              <stop offset="1" stopColor="#BDD9BA" />
            </linearGradient>
          </defs>
          <g className="semlo-editor-sprig-shoot semlo-editor-sprig-shoot-back" opacity="0.38">
            <g className="semlo-editor-sprig-growth">
              <path
                d="M72 287C73 250 70 218 64 187C61 175 55 165 48 156M68 210C57 200 46 196 36 195M65 187C72 179 80 174 89 172"
                stroke="#85AD8F"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <g className="semlo-editor-sprig-leaf semlo-editor-sprig-leaf-left semlo-editor-sprig-leaf-one">
                <path d="M68 210C51 214 36 205 34 195C46 190 60 198 68 210Z" fill="url(#semlo-editor-sprig-soft)" />
              </g>
              <g className="semlo-editor-sprig-leaf semlo-editor-sprig-leaf-right semlo-editor-sprig-leaf-three">
                <path d="M65 188C70 175 81 168 91 170C90 182 78 190 65 188Z" fill="url(#semlo-editor-sprig-soft)" />
              </g>
              <g className="semlo-editor-sprig-leaf semlo-editor-sprig-leaf-tip">
                <path d="M48 160C39 150 38 140 43 132C53 136 58 148 48 160Z" fill="url(#semlo-editor-sprig-fresh)" />
              </g>
            </g>
          </g>
          <g className="semlo-editor-sprig-shoot semlo-editor-sprig-shoot-left" opacity="0.7">
            <g className="semlo-editor-sprig-growth">
              <path
                d="M72 287C65 270 54 254 43 242C34 233 25 228 15 225M56 257C45 257 35 253 26 248M48 247C47 237 43 227 36 219"
                stroke="#85AD8F"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <g className="semlo-editor-sprig-leaf semlo-editor-sprig-leaf-left semlo-editor-sprig-leaf-one">
                <path d="M56 257C42 263 27 260 21 249C31 243 46 246 56 257Z" fill="url(#semlo-editor-sprig-soft)" />
                <path d="M27 250C37 251 46 253 53 256" stroke="#EDF8EC" strokeOpacity="0.55" />
              </g>
              <g className="semlo-editor-sprig-leaf semlo-editor-sprig-leaf-left semlo-editor-sprig-leaf-three">
                <path d="M47 244C37 238 31 227 36 219C46 222 51 232 47 244Z" fill="url(#semlo-editor-sprig-fresh)" />
              </g>
              <g className="semlo-editor-sprig-leaf semlo-editor-sprig-leaf-left semlo-editor-sprig-leaf-tip">
                <path d="M26 229C17 230 8 226 7 219C15 216 23 220 26 229Z" fill="url(#semlo-editor-sprig-soft)" />
              </g>
            </g>
          </g>
          <g className="semlo-editor-sprig-shoot semlo-editor-sprig-shoot-right" opacity="0.7">
            <g className="semlo-editor-sprig-growth">
              <path
                d="M72 287C88 272 105 263 124 256C139 251 151 244 158 234M103 264C105 252 110 243 119 237M126 255C137 257 146 255 154 250"
                stroke="#85AD8F"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <g className="semlo-editor-sprig-leaf semlo-editor-sprig-leaf-right semlo-editor-sprig-leaf-one">
                <path
                  d="M102 264C97 252 101 241 111 237C118 245 114 257 102 264Z"
                  fill="url(#semlo-editor-sprig-soft)"
                />
              </g>
              <g className="semlo-editor-sprig-leaf semlo-editor-sprig-leaf-right semlo-editor-sprig-leaf-three">
                <path
                  d="M126 255C134 243 148 237 158 240C157 251 144 258 126 255Z"
                  fill="url(#semlo-editor-sprig-fresh)"
                />
                <path d="M132 254C141 250 149 246 155 242" stroke="#EDF8EC" strokeOpacity="0.55" />
              </g>
              <g className="semlo-editor-sprig-leaf semlo-editor-sprig-leaf-right semlo-editor-sprig-leaf-tip">
                <path
                  d="M151 243C150 232 155 223 164 220C170 229 165 238 151 243Z"
                  fill="url(#semlo-editor-sprig-soft)"
                />
              </g>
            </g>
          </g>
          <g className="semlo-editor-sprig-shoot semlo-editor-sprig-shoot-main">
            <g className="semlo-editor-sprig-growth">
              <path
                d="M72 287C79 252 81 219 85 187C90 155 100 134 103 105M82 222C71 206 59 198 44 194M87 197C101 185 115 185 130 188M91 163C80 149 70 142 62 139M94 153C106 139 118 132 131 129"
                stroke="#85AD8F"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              <g className="semlo-editor-sprig-leaf semlo-editor-sprig-leaf-left semlo-editor-sprig-leaf-one">
                <path d="M82 224C55 230 29 214 28 192C50 187 73 201 82 224Z" fill="url(#semlo-editor-sprig-soft)" />
                <path d="M40 197C54 202 67 211 78 221" stroke="#EDF8EC" strokeOpacity="0.6" strokeWidth="1.2" />
              </g>
              <g className="semlo-editor-sprig-leaf semlo-editor-sprig-leaf-right semlo-editor-sprig-leaf-two">
                <path
                  d="M85 205C105 179 133 176 147 188C140 210 113 222 85 205Z"
                  fill="url(#semlo-editor-sprig-fresh)"
                />
                <path d="M94 203C108 196 123 191 138 189" stroke="#DDF0DF" strokeOpacity="0.6" strokeWidth="1.2" />
              </g>
              <g className="semlo-editor-sprig-leaf semlo-editor-sprig-leaf-left semlo-editor-sprig-leaf-three">
                <path d="M92 164C68 161 49 145 53 126C72 123 90 140 92 164Z" fill="url(#semlo-editor-sprig-soft)" />
                <path d="M61 134C73 141 83 150 90 160" stroke="#F1F8EC" strokeOpacity="0.6" strokeWidth="1.2" />
              </g>
              <g className="semlo-editor-sprig-leaf semlo-editor-sprig-leaf-right semlo-editor-sprig-leaf-four">
                <path
                  d="M94 154C104 129 128 116 145 122C142 143 119 160 94 154Z"
                  fill="url(#semlo-editor-sprig-fresh)"
                />
                <path d="M101 151C112 141 124 133 138 126" stroke="#E4F3E3" strokeOpacity="0.6" strokeWidth="1.2" />
              </g>
              <g className="semlo-editor-sprig-leaf semlo-editor-sprig-leaf-tip">
                <path d="M103 118C89 92 92 68 108 54C124 70 120 98 103 118Z" fill="url(#semlo-editor-sprig-fresh)" />
                <path d="M106 108C108 92 109 77 108 63" stroke="#D9EDDB" strokeOpacity="0.6" strokeWidth="1.2" />
              </g>
              <g className="semlo-editor-sprig-bud">
                <path d="M97 133C108 127 114 115 117 104" stroke="#86B492" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M117 107C112 101 114 95 119 92C123 97 122 103 117 107Z" fill="#E5BFC0" />
              </g>
            </g>
          </g>
        </svg>
      </div>
    </div>
  );
}

export function GrowingFeatures({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-growing");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.25 },
    );
    container.querySelectorAll(".semlo-editor-feature-art").forEach((art) => observer.observe(art));
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="semlo-editor-capabilities">
      {children}
    </div>
  );
}
