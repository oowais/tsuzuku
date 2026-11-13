import { isDemo } from "../../demo";

// A poster for demo mode, so cards look like they do with real art: a redirect to one of these AniList covers (the
// same CDN real anime posters come from): the `n`th (a row's place, so neighbours differ), else one picked from the
// row and title. The covers repeat once the rows outnumber them. A mix of dark, light, white and colourful art, so
// every card style and theme is seen with each. Hotlinked, not stored: the demo needs the internet for posters, as
// the real app does. Not found outside demo mode.
const CDN = "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/";
const COVERS = [
  "bx1535-kUgkcrfOrkUM.jpg", // Death Note: dark
  "bx140960-Kb6R5nYQfjmP.jpg", // SPY x FAMILY: white
  "bx21-ELSYx3yMPcKM.jpg", // ONE PIECE: colourful
  "bx127230-DdP4vAdssLoz.png", // Chainsaw Man: dark red
  "bx20954-sYRfE5jQRtSB.jpg", // A Silent Voice: light
  "bx21519-SUo3ZQuCbYhJ.png", // Your Name.: bright blue
  "bx113415-LHBAeoZDIsnF.jpg", // JUJUTSU KAISEN: dark
  "bx9253-tIUXF2gfU8Sg.jpg", // Steins;Gate: pale
  "bx21355-wRVUrGxpvIQQ.jpg", // Re:ZERO: pink
  "bx101922-WBsBl0ClmgYL.jpg", // Demon Slayer: warm
  "bx21827-ubzq619ZA2E9.png", // Violet Evergarden: blue
  "bx20464-ooZUyBe4ptp9.png", // HAIKYU!!: orange
  "bx101348-2fhDFPCuMNiz.jpg", // Vinland Saga: muted
  "bx124080-3i22mRVPBS0T.jpg", // Horimiya: light
];

export default defineEventHandler((event) => {
  if (!isDemo()) throw createError({ statusCode: 404 });
  const {
    key = "",
    title = "",
    n,
  } = getQuery(event) as { key?: string; title?: string; n?: string };
  let hash = 0;
  for (const c of `${key}${title}`) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  // Mixed (murmur3's finaliser), so the covers spread evenly instead of following the last characters.
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  const pick = n && /^\d+$/.test(n) ? Number(n) : hash;
  setHeader(event, "cache-control", "public, max-age=3600");
  return sendRedirect(event, `${CDN}${COVERS[pick % COVERS.length]}`, 302);
});
