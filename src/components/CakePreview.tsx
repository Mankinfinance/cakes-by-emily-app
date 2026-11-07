// A simple illustrated preview that changes with the customer's choices.
// It is a guide only, not an exact likeness of the finished cake.

interface Props {
  tiers: number;
  tall?: boolean;
  wide?: boolean;
  colour: string;
  finish: string;
  decorations: string[];
  topperText?: string;
  className?: string;
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp((n >> 16) + amount);
  const g = clamp(((n >> 8) & 0xff) + amount);
  const b = clamp((n & 0xff) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

export function CakePreview({ tiers, tall, wide, colour, finish, decorations, topperText, className }: Props) {
  const base = /^#[0-9a-fA-F]{6}$/.test(colour) ? colour : "#F2C4CE";
  const dark = shade(base, -28);
  const has = (id: string) => decorations.includes(id);
  const layers =
    tiers >= 2
      ? [
          { w: 190, h: 92, y: 300 },
          { w: 130, h: 80, y: 220 },
        ]
      : [{ w: wide ? 210 : 170, h: tall ? 150 : 110, y: 300 }];
  const top = layers[layers.length - 1];
  const topY = top.y - top.h;

  return (
    <svg viewBox="0 0 300 380" role="img" aria-label="Preview of your cake" className={className} data-testid="cake-preview">
      <ellipse cx="150" cy="322" rx="125" ry="14" fill="#e9dcd6" />
      <rect x="40" y="300" width="220" height="14" rx="7" fill="#d9c7bf" />
      {layers.map((l, i) => {
        const x = 150 - l.w / 2;
        const semi = finish === "fin-semi-naked";
        return (
          <g key={i}>
            <rect x={x} y={l.y - l.h} width={l.w} height={l.h} rx="8" fill={semi ? "#e8cfa8" : base} />
            {semi && (
              <>
                <rect x={x} y={l.y - l.h} width={l.w} height={l.h} rx="8" fill={base} opacity="0.55" />
                <line x1={x + 4} x2={x + l.w - 4} y1={l.y - l.h / 2} y2={l.y - l.h / 2} stroke="#fff" strokeOpacity=".7" strokeWidth="5" />
              </>
            )}
            {finish === "fin-painted" && (
              <path
                d={`M${x + 10} ${l.y - l.h * 0.35} q 30 -22 60 0 t 60 0 t 60 0`}
                stroke={dark}
                strokeWidth="9"
                fill="none"
                strokeLinecap="round"
                opacity=".55"
              />
            )}
            {finish === "fin-fondant" && <rect x={x} y={l.y - 10} width={l.w} height="10" rx="5" fill={dark} opacity=".5" />}
            {finish === "fin-drip" && (
              <path
                d={`M${x} ${l.y - l.h + 2} h ${l.w} v 14 ${Array.from({ length: 6 })
                  .map((_, k) => `q -${l.w / 12} ${k % 2 ? 26 : 12} -${l.w / 6} 0`)
                  .join(" ")} z`}
                fill="#5a3527"
              />
            )}
            {has("dec-gold-leaf") && <path d={`M${x + l.w - 34} ${l.y - l.h + 24} l 14 6 l -6 12 l -12 -4 z`} fill="#c9a24f" />}
          </g>
        );
      })}
      {has("dec-sprinkles") &&
        Array.from({ length: 14 }).map((_, i) => (
          <rect
            key={i}
            x={150 - top.w / 2 + 10 + ((i * 37) % (top.w - 20))}
            y={topY + 4 + ((i * 13) % 10)}
            width="7"
            height="2.5"
            rx="1"
            fill={["#f6a5c0", "#9ed3f0", "#f9d77e", "#b7e3a8"][i % 4]}
            transform={`rotate(${(i * 47) % 180} ${150 - top.w / 2 + 10 + ((i * 37) % (top.w - 20))} ${topY + 6})`}
          />
        ))}
      {has("dec-macarons") &&
        [-40, -14, 12, 38].map((dx, i) => (
          <g key={i} transform={`translate(${150 + dx} ${topY - 8})`}>
            <ellipse rx="11" ry="5" fill={["#f6b6c8", "#c9e4c5", "#f7dc9b", "#cdb8e0"][i]} />
            <ellipse cy="5" rx="11" ry="5" fill={["#f6b6c8", "#c9e4c5", "#f7dc9b", "#cdb8e0"][i]} />
          </g>
        ))}
      {has("dec-fresh-flowers") &&
        [
          [-34, 0, "#f3a6b7"],
          [-14, -10, "#fff1f3"],
          [8, -2, "#e98ea4"],
        ].map(([dx, dy, c], i) => (
          <g key={i} transform={`translate(${150 + Number(dx) + top.w / 4} ${topY + Number(dy)})`}>
            {[0, 72, 144, 216, 288].map((a) => (
              <ellipse key={a} rx="6" ry="10" fill={String(c)} transform={`rotate(${a}) translate(0 -7)`} />
            ))}
            <circle r="4" fill="#f5d27a" />
          </g>
        ))}
      {has("dec-butterflies") &&
        [
          [-60, 40],
          [64, 70],
        ].map(([dx, dy], i) => (
          <g key={i} transform={`translate(${150 + dx} ${topY + dy})`} fill="#9b7fc4" opacity=".9">
            <ellipse cx="-6" rx="7" ry="10" transform="rotate(-20)" />
            <ellipse cx="6" rx="7" ry="10" transform="rotate(20)" />
          </g>
        ))}
      {has("dec-topper") && (
        <g>
          <line x1="128" y1={topY - 4} x2="128" y2={topY - 46} stroke="#b8955a" strokeWidth="2" />
          <line x1="172" y1={topY - 4} x2="172" y2={topY - 46} stroke="#b8955a" strokeWidth="2" />
          <text
            x="150"
            y={topY - 50}
            textAnchor="middle"
            fontFamily="var(--font-great-vibes), cursive"
            fontSize={(topperText?.length ?? 0) > 10 ? 24 : 32}
            fill="#b8955a"
            data-testid="topper-text"
          >
            {topperText || "Your name"}
          </text>
        </g>
      )}
    </svg>
  );
}
