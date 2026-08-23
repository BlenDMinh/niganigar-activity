// d20 roll animation assets. Each stage's video carries no audio track of
// its own (confirmed via ffprobe) — video and audio are always separate
// files, played back together on their own <video>/<audio> elements.

export type RevealVariant = "normal" | "gold" | "red" | "red-fake";

export const ROLLING_VIDEO = "/vid/d20roll.mp4";
export const ROLLING_AUDIO = "/vid/d20roll.mp3";

export const REVEAL1_VIDEO = "/vid/d20-reveal1.mp4";
export const REVEAL1_AUDIO = "/vid/d20-reveal1.mp3";

// reveal2 only ever has three of the four variants — "red" doubles as the
// bad-NAT roll AND the tease shown before a good-NAT roll gets "faked".
export const REVEAL2_VIDEO: Record<"normal" | "gold" | "red", string> = {
  normal: "/vid/d20-reveal2-normal.mp4",
  gold: "/vid/d20-reveal2-gold.mp4",
  red: "/vid/d20-reveal2-red.mp4",
};
export const REVEAL2_AUDIO: Record<"normal" | "gold" | "red", string> = {
  normal: "/vid/d20-reveal2-normal.mp3",
  gold: "/vid/d20-reveal2-gold.mp3",
  red: "/vid/d20-reveal2-red.mp3",
};

export const REVEAL3_VIDEO: Record<RevealVariant, string> = {
  normal: "/vid/d20-reveal3-normal.mp4",
  gold: "/vid/d20-reveal3-gold.mp4",
  red: "/vid/d20-reveal3-red.mp4",
  "red-fake": "/vid/d20-reveal3-red-fake.mp4",
};
export const REVEAL3_AUDIO: Record<RevealVariant, string> = {
  normal: "/vid/d20-reveal3-normal.mp3",
  gold: "/vid/d20-reveal3-gold.mp3",
  red: "/vid/d20-reveal3-red.mp3",
  "red-fake": "/vid/d20-reveal3-red-fake.mp3",
};

export const BACKGROUND_IMAGE = "/img/background.png";

// reveal3 clips are 24fps — an interrupting 3rd tap (reveal2's video not
// yet finished) skips straight to frame 40 instead of restarting from 0,
// so rushing through the taps doesn't force everyone to sit through the
// same wind-up twice.
export const REVEAL3_SKIP_TIME = 40 / 24;

const ALL_URLS = [
  ROLLING_VIDEO,
  ROLLING_AUDIO,
  REVEAL1_VIDEO,
  REVEAL1_AUDIO,
  ...Object.values(REVEAL2_VIDEO),
  ...Object.values(REVEAL2_AUDIO),
  ...Object.values(REVEAL3_VIDEO),
  ...Object.values(REVEAL3_AUDIO),
  BACKGROUND_IMAGE,
];

let preloaded = false;

// Warms the browser's HTTP cache for every roll animation asset right
// after joining, so the first roll of a session doesn't stutter on a
// cold fetch. Fire-and-forget: a failed prefetch just means that one
// asset falls back to fetching live when actually needed.
export function preloadRollAssets(): void {
  if (preloaded) return;
  preloaded = true;

  for (const url of ALL_URLS) {
    if (url.endsWith(".mp4")) {
      const video = document.createElement("video");
      video.preload = "auto";
      video.muted = true;
      video.src = url;
      video.load();
    } else if (url.endsWith(".mp3")) {
      const audio = new Audio(url);
      audio.preload = "auto";
      audio.load();
    } else {
      const img = new Image();
      img.src = url;
    }
    // Belt-and-suspenders: also warm the plain HTTP cache directly, in
    // case a browser's media-element preloading is more conservative
    // than its fetch cache (e.g. data-saver heuristics on some engines).
    void fetch(url, { cache: "force-cache" }).catch(() => {});
  }
}
