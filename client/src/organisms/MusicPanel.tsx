import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { getSocket } from "../socket/client";
import { useStore } from "../state/store";
import { parseYoutubeLink } from "../utils/youtube";
import {
  CATEGORY_KEYS,
  CATEGORY_LABELS,
  MUSIC_CATEGORIES,
  SFX_TRACKS,
  type CategoryKey,
} from "../data/music";

interface Props {
  instanceId: string;
}

// ── Fade utilities — equal-power curves prevent perceived dip ────
// out: cos curve  (startVol → 0)
function fadeOut(
  audio: HTMLAudioElement,
  ms: number,
  onDone?: () => void,
): () => void {
  const startVol = audio.volume;
  const t0 = performance.now();
  let raf = 0,
    cancelled = false;
  function tick(now: number) {
    if (cancelled) return;
    const p = Math.min((now - t0) / ms, 1);
    audio.volume = startVol * Math.cos((p * Math.PI) / 2);
    if (p < 1) raf = requestAnimationFrame(tick);
    else {
      audio.volume = 0;
      onDone?.();
    }
  }
  raf = requestAnimationFrame(tick);
  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}

// in: sin curve  (0 → targetVol)
function fadeIn(
  audio: HTMLAudioElement,
  targetVol: number,
  ms: number,
): () => void {
  const t0 = performance.now();
  let raf = 0,
    cancelled = false;
  function tick(now: number) {
    if (cancelled) return;
    const p = Math.min((now - t0) / ms, 1);
    audio.volume = targetVol * Math.sin((p * Math.PI) / 2);
    if (p < 1) raf = requestAnimationFrame(tick);
    else {
      audio.volume = targetVol;
    }
  }
  raf = requestAnimationFrame(tick);
  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}

// ── SVG icons ────────────────────────────────────────────────────
function SfxIcon({ id }: { id: string }) {
  const p = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (id) {
    case "rain":
      return (
        <svg {...p}>
          <line x1="4" y1="3" x2="2" y2="13" />
          <line x1="8" y1="3" x2="6" y2="13" />
          <line x1="12" y1="3" x2="10" y2="13" />
        </svg>
      );
    case "fire":
      return (
        <svg {...p}>
          <path d="M8 14c-3 0-5-2.2-5-4.8 0-2 1.4-3.4 2-5.2.5 1.4 1 2.3 2 3C7.5 5.2 8 3 8 2c1.5 2 4 3.5 4 7.2C12 11.8 10.5 14 8 14z" />
        </svg>
      );
    case "wind":
      return (
        <svg {...p}>
          <path d="M2 5c1.5-1.5 3.5-1.5 5 0s3.5 1.5 5 0" />
          <path d="M2 9c1.5-1.5 3.5-1.5 5 0s3.5 1.5 5 0" />
          <path d="M2 13c1.5-1.5 2.5-1.5 3.5 0" />
        </svg>
      );
    case "crowd":
      return (
        <svg {...p}>
          <circle cx="5.5" cy="5" r="2" />
          <circle cx="10.5" cy="5" r="2" />
          <path d="M1 14c0-2.5 2-4 4.5-4" />
          <path d="M15 14c0-2.5-2-4-4.5-4s-4.5 1.5-4.5 4" />
        </svg>
      );
    case "forest":
      return (
        <svg {...p}>
          <path d="M8 2 L14 11 H2 Z" />
          <line x1="8" y1="11" x2="8" y2="14" />
        </svg>
      );
    case "ocean":
      return (
        <svg {...p}>
          <path d="M1 7c1.3-1.8 2.7-1.8 4 0s2.7 1.8 4 0 2.7-1.8 4 0" />
          <path d="M1 11c1.3-1.8 2.7-1.8 4 0s2.7 1.8 4 0 2.7-1.8 4 0" />
        </svg>
      );
    case "swords":
      return (
        <svg {...p}>
          <path d="M6.5 10 L8 2 L9.5 10" />
          <line x1="5" y1="10" x2="11" y2="10" />
          <line x1="8" y1="10" x2="8" y2="13" />
          <circle cx="8" cy="14" r="1.2" stroke="none" fill="currentColor" />
        </svg>
      );
    default:
      return <svg {...p} />;
  }
}

function CategoryIcon({ id }: { id: string }) {
  const p = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (id) {
    case "tavern":
      return (
        <svg {...p}>
          <path d="M5 2h6L9 9H7L5 2z" />
          <line x1="8" y1="9" x2="8" y2="13" />
          <line x1="5" y1="13" x2="11" y2="13" />
        </svg>
      );
    case "adventure":
      return (
        <svg {...p}>
          <circle cx="8" cy="8" r="6" />
          <polyline points="6,7 8,3 10,7" />
          <line x1="8" y1="3" x2="8" y2="13" />
        </svg>
      );
    case "combat":
      return (
        <svg {...p}>
          <line x1="4" y1="4" x2="12" y2="12" />
          <line x1="12" y1="4" x2="4" y2="12" />
          <line x1="2" y1="6" x2="6" y2="2" />
          <line x1="14" y1="6" x2="10" y2="2" />
          <line x1="2" y1="10" x2="6" y2="14" />
          <line x1="14" y1="10" x2="10" y2="14" />
        </svg>
      );
    case "mystery":
      return (
        <svg {...p}>
          <path d="M1 8s3-5.5 7-5.5S15 8 15 8s-3 5.5-7 5.5S1 8 1 8z" />
          <circle cx="8" cy="8" r="2" />
        </svg>
      );
    case "rest":
      return (
        <svg {...p}>
          <path d="M12 4.5a6 6 0 1 1-7.5 7.5 5 5 0 0 0 7.5-7.5z" />
        </svg>
      );
    default:
      return <svg {...p} />;
  }
}

function VolumeIcon({ muted }: { muted: boolean }) {
  const p = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg {...p}>
      <path d="M3 6H1v4h2l4 3V3L3 6z" />
      {muted ? (
        <>
          <line x1="10" y1="6" x2="14" y2="10" />
          <line x1="14" y1="6" x2="10" y2="10" />
        </>
      ) : (
        <>
          <path d="M10 5.5a4 4 0 0 1 0 5" />
          <path d="M12.5 3a7 7 0 0 1 0 10" />
        </>
      )}
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 13V4l8-2v9" />
      <circle cx="4" cy="13" r="2" />
      <circle cx="12" cy="11" r="2" />
    </svg>
  );
}

const popupVariants = {
  hidden: { opacity: 0, scale: 0.9, y: 4 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 460, damping: 28 },
  },
  exit: { opacity: 0, scale: 0.9, y: 4, transition: { duration: 0.13 } },
};

const FADE_MS = 700;
const DEFAULT_VOLUME = 0.05;
// How far (seconds) a client's playback position may drift from the
// server-derived expected position before we forcibly reseek it.
const DRIFT_TOLERANCE_S = 1.5;
const DRIFT_CHECK_MS = 20000;

const SERVER_URL = import.meta.env.VITE_SERVER_URL as string;

function audioUrl(youtubeId: string, isCustom: boolean): string {
  return `${SERVER_URL}/api/music/audio/${youtubeId}${isCustom ? "?custom=1" : ""}`;
}

// Discord's Activity CSP restricts `media-src` to 'self'/blob:/data: — an
// <audio src> pointed straight at our (cross-origin) server gets silently
// blocked. fetch() is governed by connect-src instead (which does allow
// our origin), so we pull the bytes ourselves and hand the element a
// blob: URL, which the CSP explicitly permits.
//
// Reads the body as a stream (rather than res.blob()) so onProgress can
// report real download progress — the server sends the actual size of
// the selected format via X-Estimated-Bytes when it's known (always true
// for an already-cached file; for a fresh download it's yt-dlp's own
// estimate, close enough for a progress bar). Falls back to res.blob()
// if streaming reads aren't available.
async function fetchAudioBlobUrl(
  youtubeId: string,
  isCustom: boolean,
  signal: AbortSignal,
  onProgress: (receivedBytes: number, estimatedBytes: number | null) => void,
): Promise<string> {
  const url = audioUrl(youtubeId, isCustom);
  console.log(`[MusicPanel] fetch(${url}) starting`);
  const res = await fetch(url, { signal });
  console.log(
    `[MusicPanel] fetch(${url}) → ${res.status} ${res.statusText}, content-type=${res.headers.get("Content-Type")}, body=${res.body ? "stream" : "null"}`,
  );
  if (!res.ok) throw new Error(`audio fetch failed: ${res.status}`);

  const estimatedHeader = res.headers.get("X-Estimated-Bytes");
  const estimatedBytes = estimatedHeader ? Number(estimatedHeader) : null;
  // Content-Type is CORS-safelisted, always readable without needing
  // Access-Control-Expose-Headers. Must be carried onto the Blob manually
  // below — res.blob() does this automatically, but reading the stream by
  // hand does not, and a typeless blob: URL routinely fails to play as
  // audio/mp4 (m4a) in Chromium-based engines even though the bytes are
  // fine, throwing NotSupportedError on .play(). webm/opus tracks happen
  // to still get sniffed correctly without it, which is why this only
  // ever affected some songs and not others.
  const mimeType = res.headers.get("Content-Type") || undefined;

  if (!res.body) {
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }

  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress(received, estimatedBytes);
  }
  return URL.createObjectURL(new Blob(chunks, { type: mimeType }));
}

function revokeIfBlobUrl(src: string) {
  if (src.startsWith("blob:")) URL.revokeObjectURL(src);
}

// Position `audio` should be at right now, given when the track started
// and how far into it playback should always begin — the track loops
// within [offsetSeconds, duration) rather than replaying the skipped part
// on every loop.
function expectedPosition(
  startedAt: number,
  offsetSeconds: number,
  duration: number,
): number {
  // Clamped defensively: `offsetSeconds` can exceed `duration` (a custom
  // link's t= past the actual video length), and during a rapid song
  // switch this can be called with a startedAt/offsetSeconds pair for a
  // different track than the `duration` just loaded into this <audio>
  // slot. An out-of-range result thrown straight into `currentTime`
  // raises an uncaught IndexSizeError and crashes playback setup.
  const safeOffset = Math.min(Math.max(offsetSeconds, 0), Math.max(duration - 0.1, 0));
  const loopSpan = Math.max(duration - safeOffset, 0.1);
  const position = safeOffset + (((Date.now() - startedAt) / 1000) % loopSpan);
  return Math.min(Math.max(position, 0), Math.max(duration - 0.05, 0));
}

// Seeks `audio` to where it should be right now given when the (looping)
// track started, so every listener hears the same moment regardless of
// when their own client started playing it.
function seekToSynced(
  audio: HTMLAudioElement,
  startedAt: number,
  offsetSeconds: number,
) {
  const apply = () => {
    const duration = audio.duration;
    if (!isFinite(duration) || duration <= 0) return;
    audio.currentTime = expectedPosition(startedAt, offsetSeconds, duration);
  };
  if (audio.readyState >= 1) apply();
  else audio.addEventListener("loadedmetadata", apply, { once: true });
}

export function MusicPanel({ instanceId }: Props) {
  const { state, dispatch } = useStore();
  const category = state.musicCategory as CategoryKey;
  const songIndex = state.musicSongIndex;
  const customYoutubeId = state.customYoutubeId;
  const customOffsetSeconds = state.customOffsetSeconds;
  const musicStartedAt = state.musicStartedAt;
  const sfxVolumes = state.sfxVolumes;
  const [musicVolume, setMusicVolume] = useState(DEFAULT_VOLUME);
  const [openSfx, setOpenSfx] = useState<string | null>(null);
  const [showVol, setShowVol] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [customError, setCustomError] = useState(false);
  // null = hidden, -1 = loading but total size unknown, 0-100 = known %.
  // Only shown once loading crosses a short delay, so an already-cached
  // (near-instant) fetch never flashes it.
  const [downloadProgress, setDownloadProgress] = useState<number | null>(
    null,
  );

  // A custom pasted link overrides whatever the catalog selection is.
  const activeSong = MUSIC_CATEGORIES[category][songIndex];
  const activeYoutubeId = customYoutubeId || activeSong?.youtubeId || "";
  const activeOffsetSeconds = customYoutubeId
    ? customOffsetSeconds
    : activeSong?.offsetSeconds ?? 0;

  // Two audio slots for crossfade
  const audioA = useRef(new Audio());
  const audioB = useRef(new Audio());
  const activeSlot = useRef<"a" | "b">("a");
  const cancelFades = useRef<Array<() => void>>([]);

  // Keep a ref so the crossfade effect always reads the latest volume
  const musicVolumeRef = useRef(musicVolume);
  useEffect(() => {
    musicVolumeRef.current = musicVolume;
  }, [musicVolume]);

  // Keep refs so the drift-check interval always reads the latest sync anchor
  const musicStartedAtRef = useRef(musicStartedAt);
  useEffect(() => {
    musicStartedAtRef.current = musicStartedAt;
  }, [musicStartedAt]);
  const activeOffsetSecondsRef = useRef(activeOffsetSeconds);
  useEffect(() => {
    activeOffsetSecondsRef.current = activeOffsetSeconds;
  }, [activeOffsetSeconds]);

  const sfxRefs = useRef<Record<string, HTMLAudioElement>>({});
  const sfxSrcsRef = useRef<Record<string, string>>({});

  // ── music crossfade on category / song change ────────────────────
  useEffect(() => {
    console.log(
      `[MusicPanel] crossfade effect fired: category=${category} songIndex=${songIndex} customYoutubeId=${customYoutubeId} activeYoutubeId="${activeYoutubeId}" musicStartedAt=${musicStartedAt}`,
    );

    cancelFades.current.forEach((f) => f());
    cancelFades.current = [];

    if (!activeYoutubeId) {
      console.log(`[MusicPanel] bailing: activeYoutubeId is falsy`);
      return;
    }

    const elA = audioA.current;
    const elB = audioB.current;

    // Determine which element is ACTUALLY audibly playing right now.
    // Do NOT rely on activeSlot: it is flipped at the start of each effect
    // (before the fade completes), so it is wrong on any rapid switch.
    const outAudio =
      !elA.paused && elA.volume > 0
        ? elA
        : !elB.paused && elB.volume > 0
          ? elB
          : null;
    const inAudio = outAudio === elA ? elB : elA;

    // Keep activeSlot in sync for the volume-slider effect.
    activeSlot.current = inAudio === elA ? "a" : "b";

    // A rapid switch used to just *ignore* the previous fetch's eventual
    // result while leaving the actual network request/stream-read running
    // to completion in the background — wasteful, and the source of the
    // rapid-switching glitches (a stale request could still be the one
    // that ends up "winning" a race against a newer switch depending on
    // timing). Abort it for real instead.
    const controller = new AbortController();
    const isCustom = !!customYoutubeId;

    // Only show "Downloading…" if the fetch is actually slow — an
    // already-cached track resolves in a handful of ms and should never
    // flash a progress bar.
    const showProgressTimer = window.setTimeout(() => {
      if (!controller.signal.aborted) setDownloadProgress((p) => p ?? -1);
    }, 300);

    console.log(`[MusicPanel] calling fetchAudioBlobUrl(${activeYoutubeId})`);
    void fetchAudioBlobUrl(
      activeYoutubeId,
      isCustom,
      controller.signal,
      (received, estimated) => {
        setDownloadProgress(
          estimated ? Math.min(99, (received / estimated) * 100) : -1,
        );
      },
    )
      .then((blobUrl) => {
        console.log(
          `[MusicPanel] fetchAudioBlobUrl(${activeYoutubeId}) resolved: ${blobUrl}`,
        );
        clearTimeout(showProgressTimer);
        setDownloadProgress(null);
        revokeIfBlobUrl(inAudio.src);

        if (outAudio === null) {
          // Nothing audibly playing yet — start immediately (first load / after silence).
          inAudio.src = blobUrl;
          inAudio.loop = true;
          inAudio.volume = musicVolumeRef.current;
          void inAudio
            .play()
            .catch((e) => console.warn("[MusicPanel] autoplay blocked:", e));
          seekToSynced(inAudio, musicStartedAt, activeOffsetSeconds);
          return;
        }

        // Equal-power crossfade.
        cancelFades.current.push(
          fadeOut(outAudio, FADE_MS, () => outAudio.pause()),
        );
        inAudio.src = blobUrl;
        inAudio.loop = true;
        inAudio.volume = 0;
        void inAudio
          .play()
          .catch((e) => console.warn("[MusicPanel] autoplay blocked:", e));
        seekToSynced(inAudio, musicStartedAt, activeOffsetSeconds);
        cancelFades.current.push(
          fadeIn(inAudio, musicVolumeRef.current, FADE_MS),
        );
      })
      .catch((e) => {
        console.log(
          `[MusicPanel] fetchAudioBlobUrl(${activeYoutubeId}) rejected:`,
          e,
        );
        clearTimeout(showProgressTimer);
        setDownloadProgress(null);
        // A superseded-by-a-newer-switch abort is expected, not a real
        // failure — only warn on genuine fetch/network errors.
        if ((e as { name?: string })?.name !== "AbortError") {
          console.warn("[MusicPanel] failed to load audio:", e);
        }
      });

    return () => {
      controller.abort();
      clearTimeout(showProgressTimer);
      cancelFades.current.forEach((f) => f());
      cancelFades.current = [];
    };
  }, [
    activeYoutubeId,
    musicStartedAt,
    activeOffsetSeconds,
    customYoutubeId,
  ]);

  // ── periodic drift correction — nudges the playing track back in line
  // with the server-derived position if it's slipped past tolerance ───
  useEffect(() => {
    const interval = window.setInterval(() => {
      const active =
        activeSlot.current === "a" ? audioA.current : audioB.current;
      const duration = active.duration;
      if (!active.src || active.paused || !isFinite(duration) || duration <= 0)
        return;
      const expected = expectedPosition(
        musicStartedAtRef.current,
        activeOffsetSecondsRef.current,
        duration,
      );
      if (Math.abs(active.currentTime - expected) > DRIFT_TOLERANCE_S) {
        active.currentTime = expected;
      }
    }, DRIFT_CHECK_MS);
    return () => clearInterval(interval);
  }, []);

  // ── master volume — update active slot only, no crossfade ───────
  useEffect(() => {
    const active = activeSlot.current === "a" ? audioA.current : audioB.current;
    active.volume = musicVolume;
  }, [musicVolume]);

  // ── cleanup on unmount ───────────────────────────────────────────
  useEffect(() => {
    return () => {
      audioA.current.pause();
      audioB.current.pause();
      revokeIfBlobUrl(audioA.current.src);
      revokeIfBlobUrl(audioB.current.src);
    };
  }, []);

  // ── unlock audio on the first real user gesture ──────────────────
  // Browsers block audio-with-sound from autoplaying until the page has
  // had a genuine click/tap/keypress, so a play() attempt made right when
  // the join sync arrives can fail silently (the calls above swallow the
  // rejection). Retry once inside the first gesture, which satisfies the
  // browser's autoplay policy.
  useEffect(() => {
    function unlock() {
      const active =
        activeSlot.current === "a" ? audioA.current : audioB.current;
      if (active.src && active.paused) void active.play().catch(() => {});
      Object.values(sfxRefs.current).forEach((audio) => {
        if (audio.src && audio.volume > 0 && audio.paused) {
          void audio.play().catch(() => {});
        }
      });
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    }
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // ── sfx playback ─────────────────────────────────────────────────
  useEffect(() => {
    SFX_TRACKS.forEach((track) => {
      const vol = sfxVolumes[track.id] ?? 0;
      const src = track.categorySrc?.[category] || track.src;

      if (!sfxRefs.current[track.id]) {
        sfxRefs.current[track.id] = new Audio();
        sfxRefs.current[track.id].loop = true;
        sfxSrcsRef.current[track.id] = "";
      }

      const audio = sfxRefs.current[track.id];

      if (sfxSrcsRef.current[track.id] !== src) {
        const wasPlaying = !audio.paused && audio.volume > 0;
        audio.pause();
        audio.src = src;
        audio.load();
        audio.loop = true;
        sfxSrcsRef.current[track.id] = src;
        if (wasPlaying && vol > 0 && src) void audio.play().catch(() => {});
      }

      audio.volume = vol;
      if (vol > 0 && src) void audio.play().catch(() => {});
      else audio.pause();
    });
  }, [sfxVolumes, category]);

  // ── handlers ─────────────────────────────────────────────────────
  function handleCategoryClick(cat: CategoryKey) {
    const songs = MUSIC_CATEGORIES[cat];
    const validIndices = songs.reduce<number[]>((acc, s, i) => {
      if (s.youtubeId) acc.push(i);
      return acc;
    }, []);
    if (validIndices.length === 0) return;

    let nextIndex: number;
    if (cat === category) {
      const pos = validIndices.indexOf(songIndex);
      nextIndex = validIndices[(pos + 1) % validIndices.length];
    } else {
      nextIndex = validIndices[Math.floor(Math.random() * validIndices.length)];
    }

    // Use our own clock as the sync anchor for our local playback; the
    // server stamps its own (near-identical) time for everyone else.
    const startedAt = Date.now();
    dispatch({
      type: "MUSIC_SYNC",
      payload: {
        category: cat,
        songIndex: nextIndex,
        customYoutubeId: null,
        customOffsetSeconds: 0,
        startedAt,
      },
    });
    getSocket().emit("music_change", {
      instanceId,
      category: cat,
      songIndex: nextIndex,
    });
  }

  function handleCustomSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseYoutubeLink(customInput);
    if (!parsed) {
      setCustomError(true);
      return;
    }

    setCustomError(false);
    setCustomInput("");

    const startedAt = Date.now();
    dispatch({
      type: "MUSIC_SYNC",
      payload: {
        category,
        songIndex,
        customYoutubeId: parsed.id,
        customOffsetSeconds: parsed.offsetSeconds,
        startedAt,
      },
    });
    getSocket().emit("music_change_custom", {
      instanceId,
      youtubeId: parsed.id,
      offsetSeconds: parsed.offsetSeconds,
    });
  }

  function handleSfxVolume(sfxId: string, volume: number) {
    dispatch({ type: "SFX_SYNC", payload: { sfxId, volume } });
    getSocket().emit("sfx_change", { instanceId, sfxId, volume });
  }

  const currentSong = MUSIC_CATEGORIES[category][songIndex];

  return (
    <div className="music-panel">
      {/* Row 1 — SFX + local volume */}
      <div className="music-panel__row music-panel__sfx-row">
        {SFX_TRACKS.map((track) => {
          const vol = sfxVolumes[track.id] ?? 0;
          return (
            <div key={track.id} className="sfx-ctrl">
              <button
                className={`sfx-ctrl__btn${vol > 0 ? " sfx-ctrl__btn--on" : ""}`}
                title={track.label}
                onClick={() =>
                  setOpenSfx((p) => (p === track.id ? null : track.id))
                }
              >
                <SfxIcon id={track.id} />
              </button>
              <AnimatePresence>
                {openSfx === track.id && (
                  <motion.div
                    className="sfx-ctrl__popup"
                    variants={popupVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                  >
                    <span className="sfx-ctrl__popup-label">{track.label}</span>
                    <input
                      type="range"
                      className="sfx-ctrl__slider"
                      min={0}
                      max={1}
                      step={0.01}
                      value={vol}
                      onChange={(e) =>
                        handleSfxVolume(track.id, parseFloat(e.target.value))
                      }
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        <div className="sfx-ctrl music-panel__vol-ctrl">
          <button
            className={`sfx-ctrl__btn${showVol ? " sfx-ctrl__btn--on" : ""}`}
            title="My volume (not synced)"
            onClick={() => setShowVol((p) => !p)}
          >
            <VolumeIcon muted={musicVolume === 0} />
          </button>
          <AnimatePresence>
            {showVol && (
              <motion.div
                className="sfx-ctrl__popup"
                variants={popupVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <span className="sfx-ctrl__popup-label">My Volume</span>
                <input
                  type="range"
                  className="sfx-ctrl__slider"
                  min={0}
                  max={1}
                  step={0.01}
                  value={musicVolume}
                  onChange={(e) => setMusicVolume(parseFloat(e.target.value))}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="music-panel__divider" />

      {/* Row 2 — Category icons */}
      <div className="music-panel__row music-panel__cat-row">
        {CATEGORY_KEYS.map((cat) => (
          <button
            key={cat}
            className={`cat-btn${cat === category && !customYoutubeId ? " cat-btn--active" : ""}`}
            onClick={() => handleCategoryClick(cat)}
            title={
              cat === category
                ? `${CATEGORY_LABELS[cat]} — next song`
                : CATEGORY_LABELS[cat]
            }
          >
            <CategoryIcon id={cat} />
          </button>
        ))}
      </div>

      <div className="music-panel__divider" />

      {/* Row 2.5 — custom YouTube link */}
      <form
        className="music-panel__row custom-track-form"
        onSubmit={handleCustomSubmit}
      >
        <input
          type="text"
          className={`custom-track-form__input${customError ? " custom-track-form__input--error" : ""}`}
          placeholder="Paste a YouTube link…"
          value={customInput}
          onChange={(e) => {
            setCustomInput(e.target.value);
            if (customError) setCustomError(false);
          }}
        />
        <button
          type="submit"
          className="custom-track-form__submit"
          title="Play this link for everyone"
        >
          ▶
        </button>
      </form>

      <div className="music-panel__divider" />

      {/* Row 3 — Now playing (always visible, independent of downloads) */}
      <div className="music-panel__row music-panel__now-playing">
        <span className="music-panel__np-label">Now Playing</span>
        <span className="music-panel__np-title">
          <NoteIcon />
          {customYoutubeId ? "Custom link" : (currentSong?.title ?? "—")}
        </span>
      </div>

      {/* Row 4 — download progress, its own area so it never displaces
          the now-playing title */}
      {downloadProgress !== null && (
        <div className="music-panel__row music-panel__download">
          <span className="music-panel__np-label">Downloading…</span>
          <div className="download-bar">
            <div
              className={`download-bar__fill${downloadProgress < 0 ? " download-bar__fill--indeterminate" : ""}`}
              style={
                downloadProgress >= 0
                  ? { width: `${downloadProgress}%` }
                  : undefined
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
