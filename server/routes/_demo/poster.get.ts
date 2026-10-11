import { isDemo } from "../../demo";

// A generated poster for demo mode, so cards look like they do with real art: one of seven looks picked from the
// row and title (dark, light, white, colourful, and in between; they repeat across rows), each with the title set on
// it and its colours shifted per title. Not found outside demo mode.
const W = 200;
const H = 300;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// The title broken into at most three lines of about `width` characters; the last line ends in "…" when cut.
function lines(title: string, width: number) {
  const out: string[] = [];
  for (const word of title.split(/\s+/).filter(Boolean)) {
    const last = out.at(-1);
    if (last !== undefined && `${last} ${word}`.length <= width)
      out[out.length - 1] = `${last} ${word}`;
    else out.push(word);
  }
  if (out.length > 3) out.splice(2, out.length - 2, `${out[2]}…`);
  return out;
}

function titleBlock(
  title: string,
  o: {
    y: number;
    fill: string;
    size?: number;
    anchor?: "middle" | "start";
    font?: string;
    upper?: boolean;
    stroke?: string;
  },
) {
  const text = o.upper ? title.toUpperCase() : title;
  const ls = lines(text, o.upper ? 11 : 13);
  const size = o.size ?? (ls.length > 2 ? 22 : 26);
  const x = o.anchor === "start" ? 16 : W / 2;
  const stroke = o.stroke ? ` stroke="${o.stroke}" stroke-width="4" paint-order="stroke"` : "";
  return ls
    .map(
      (l, i) =>
        `<text x="${x}" y="${o.y + i * size * 1.1}" text-anchor="${o.anchor ?? "middle"}" font-family="${o.font ?? "Helvetica, Arial, sans-serif"}" font-size="${size}" font-weight="800" fill="${o.fill}"${stroke}>${esc(l)}</text>`,
    )
    .join("");
}

const grad = (id: string, stops: string[], vertical = true) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}">${stops
    .map((c, i) => `<stop offset="${i / (stops.length - 1)}" stop-color="${c}"/>`)
    .join("")}</linearGradient>`;

type Look = (title: string, h: number) => string;

const LOOKS: Look[] = [
  // Night: a near-black sky, a glowing moon, dark hills.
  (t, h) =>
    `<defs>${grad("s", [`hsl(${h} 50% 6%)`, `hsl(${h} 45% 16%)`])}<radialGradient id="g"><stop offset="0" stop-color="hsl(${h} 80% 90%)"/><stop offset="1" stop-color="hsl(${h} 80% 90%)" stop-opacity="0"/></radialGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#s)"/><circle cx="140" cy="80" r="60" fill="url(#g)" opacity=".5"/><circle cx="140" cy="80" r="26" fill="hsl(${h} 60% 92%)"/>
    <path d="M0 210 Q50 170 100 200 T200 185 V300 H0Z" fill="hsl(${h} 40% 10%)"/><path d="M0 240 Q70 210 130 235 T200 225 V300 H0Z" fill="#05050a"/>
    ${titleBlock(t, { y: 262, fill: "#f4f1ea", font: "Georgia, serif", size: 20 })}`,
  // Dawn: light peach sky, sun, soft mountain layers, dark title.
  (t, h) =>
    `<defs>${grad("s", [`hsl(${(h + 20) % 360} 80% 88%)`, `hsl(${(h + 40) % 360} 85% 80%)`])}</defs>
    <rect width="${W}" height="${H}" fill="url(#s)"/><circle cx="100" cy="150" r="42" fill="hsl(${(h + 30) % 360} 95% 70%)"/>
    <path d="M0 190 L60 130 L110 180 L150 140 L200 185 V300 H0Z" fill="hsl(${h} 30% 70%)"/><path d="M0 225 L70 175 L140 220 L200 195 V300 H0Z" fill="hsl(${h} 30% 55%)"/>
    ${titleBlock(t, { y: 52, fill: `hsl(${h} 40% 18%)` })}`,
  // White: an off-white sheet with one bold shape, black title, a thin rule.
  (t, h) =>
    `<rect width="${W}" height="${H}" fill="#f5f3ee"/><circle cx="130" cy="120" r="70" fill="hsl(${h} 75% 52%)"/><rect x="30" y="70" width="70" height="110" fill="#111" opacity=".9"/>
    <line x1="16" y1="222" x2="184" y2="222" stroke="#111" stroke-width="2"/>
    ${titleBlock(t, { y: 248, fill: "#111", anchor: "start", upper: true, size: 18 })}`,
  // Neon: a loud diagonal gradient with stripes, white title.
  (t, h) =>
    `<defs>${grad("s", [`hsl(${h} 90% 55%)`, `hsl(${(h + 50) % 360} 95% 55%)`, `hsl(${(h + 100) % 360} 95% 60%)`], false)}</defs>
    <rect width="${W}" height="${H}" fill="url(#s)"/>
    ${[0, 1, 2, 3, 4].map((i) => `<path d="M${-60 + i * 60} 300 L${40 + i * 60} 0 L${60 + i * 60} 0 L${-40 + i * 60} 300Z" fill="#fff" opacity=".12"/>`).join("")}
    ${titleBlock(t, { y: 150, fill: "#fff", stroke: "rgb(0 0 0 / .35)", upper: true })}`,
  // Sky: bright anime sky with clouds over the sea, title with an outline.
  (t, h) =>
    `<defs>${grad("s", [`hsl(${200 + (h % 20)} 85% 55%)`, `hsl(${195 + (h % 20)} 90% 82%)`])}${grad("w", [`hsl(${205 + (h % 20)} 80% 45%)`, `hsl(${215 + (h % 20)} 85% 28%)`])}</defs>
    <rect width="${W}" height="${H}" fill="url(#s)"/>
    <g fill="#fff" opacity=".95"><ellipse cx="50" cy="150" rx="45" ry="18"/><ellipse cx="80" cy="138" rx="30" ry="20"/><ellipse cx="160" cy="110" rx="40" ry="14"/><ellipse cx="140" cy="100" rx="22" ry="14"/></g>
    <rect y="200" width="${W}" height="100" fill="url(#w)"/><path d="M0 205 H200" stroke="#fff" stroke-width="2" opacity=".6"/>
    ${titleBlock(t, { y: 52, fill: "#fff", stroke: `hsl(${210 + (h % 20)} 70% 30%)` })}`,
  // Noir: black, a red bar, a pale face of light, title set small and wide.
  (t, h) =>
    `<rect width="${W}" height="${H}" fill="#0b0b0b"/><rect x="0" y="40" width="${W}" height="8" fill="hsl(${h % 20} 85% 48%)"/>
    <ellipse cx="100" cy="150" rx="46" ry="62" fill="#d9d4cc" opacity=".85"/><path d="M54 150 Q100 230 146 150 V300 H54Z" fill="#0b0b0b"/>
    ${titleBlock(t, { y: 248, fill: "#eee", upper: true, size: 17 })}<text x="100" y="30" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="9" letter-spacing="3" fill="#888">A FILM</text>`,
  // Forest: mid-tone greens, pines in fog, light title.
  (t, h) =>
    `<defs>${grad("s", [`hsl(${100 + (h % 60)} 25% 62%)`, `hsl(${120 + (h % 60)} 30% 30%)`])}</defs>
    <rect width="${W}" height="${H}" fill="url(#s)"/>
    ${[
      [20, 0.5],
      [55, 0.65],
      [95, 0.5],
      [135, 0.7],
      [175, 0.55],
    ]
      .map(
        ([x, s]) =>
          `<path d="M${x} ${300 - 260 * s!} L${x! + 22} 300 L${x! - 22} 300Z" fill="hsl(${130 + (h % 40)} 35% 16%)" opacity=".85"/>`,
      )
      .join("")}
    <rect y="180" width="${W}" height="40" fill="#fff" opacity=".18"/>
    ${titleBlock(t, { y: 60, fill: "#f2f5ec", font: "Georgia, serif" })}`,
];

export default defineEventHandler((event) => {
  if (!isDemo()) throw createError({ statusCode: 404 });
  const { key = "", title = "" } = getQuery(event) as { key?: string; title?: string };
  let hash = 0;
  for (const c of `${key}${title}`) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  // Mixed (murmur3's finaliser), so the looks spread evenly instead of following the last characters.
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  const look = LOOKS[hash % LOOKS.length]!;
  // Golden-angle steps, so neighbouring rows get clearly different colours.
  const hue = Math.round((hash * 137.508) % 360);
  setHeader(event, "content-type", "image/svg+xml");
  setHeader(event, "cache-control", "public, max-age=3600");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${look(String(title), hue)}</svg>`;
});
