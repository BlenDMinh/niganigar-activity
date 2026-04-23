import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { getSocket } from '../socket/client';
import {
  CATEGORY_KEYS, CATEGORY_LABELS, MUSIC_CATEGORIES, SFX_TRACKS,
  type CategoryKey,
} from '../data/music';

interface Props {
  instanceId: string;
}

// ── Fade utilities — equal-power curves prevent perceived dip ────
// out: cos curve  (startVol → 0)
function fadeOut(audio: HTMLAudioElement, ms: number, onDone?: () => void): () => void {
  const startVol = audio.volume;
  const t0 = performance.now();
  let raf = 0, cancelled = false;
  function tick(now: number) {
    if (cancelled) return;
    const p = Math.min((now - t0) / ms, 1);
    audio.volume = startVol * Math.cos(p * Math.PI / 2);
    if (p < 1) raf = requestAnimationFrame(tick);
    else { audio.volume = 0; onDone?.(); }
  }
  raf = requestAnimationFrame(tick);
  return () => { cancelled = true; cancelAnimationFrame(raf); };
}

// in: sin curve  (0 → targetVol)
function fadeIn(audio: HTMLAudioElement, targetVol: number, ms: number): () => void {
  const t0 = performance.now();
  let raf = 0, cancelled = false;
  function tick(now: number) {
    if (cancelled) return;
    const p = Math.min((now - t0) / ms, 1);
    audio.volume = targetVol * Math.sin(p * Math.PI / 2);
    if (p < 1) raf = requestAnimationFrame(tick);
    else { audio.volume = targetVol; }
  }
  raf = requestAnimationFrame(tick);
  return () => { cancelled = true; cancelAnimationFrame(raf); };
}

// ── SVG icons ────────────────────────────────────────────────────
function SfxIcon({ id }: { id: string }) {
  const p = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'rain':   return <svg {...p}><line x1="4" y1="3" x2="2" y2="13"/><line x1="8" y1="3" x2="6" y2="13"/><line x1="12" y1="3" x2="10" y2="13"/></svg>;
    case 'fire':   return <svg {...p}><path d="M8 14c-3 0-5-2.2-5-4.8 0-2 1.4-3.4 2-5.2.5 1.4 1 2.3 2 3C7.5 5.2 8 3 8 2c1.5 2 4 3.5 4 7.2C12 11.8 10.5 14 8 14z"/></svg>;
    case 'wind':   return <svg {...p}><path d="M2 5c1.5-1.5 3.5-1.5 5 0s3.5 1.5 5 0"/><path d="M2 9c1.5-1.5 3.5-1.5 5 0s3.5 1.5 5 0"/><path d="M2 13c1.5-1.5 2.5-1.5 3.5 0"/></svg>;
    case 'crowd':  return <svg {...p}><circle cx="5.5" cy="5" r="2"/><circle cx="10.5" cy="5" r="2"/><path d="M1 14c0-2.5 2-4 4.5-4"/><path d="M15 14c0-2.5-2-4-4.5-4s-4.5 1.5-4.5 4"/></svg>;
    case 'forest': return <svg {...p}><path d="M8 2 L14 11 H2 Z"/><line x1="8" y1="11" x2="8" y2="14"/></svg>;
    case 'ocean':  return <svg {...p}><path d="M1 7c1.3-1.8 2.7-1.8 4 0s2.7 1.8 4 0 2.7-1.8 4 0"/><path d="M1 11c1.3-1.8 2.7-1.8 4 0s2.7 1.8 4 0 2.7-1.8 4 0"/></svg>;
    case 'swords': return <svg {...p}><path d="M6.5 10 L8 2 L9.5 10"/><line x1="5" y1="10" x2="11" y2="10"/><line x1="8" y1="10" x2="8" y2="13"/><circle cx="8" cy="14" r="1.2" stroke="none" fill="currentColor"/></svg>;
    default:       return <svg {...p}/>;
  }
}

function CategoryIcon({ id }: { id: string }) {
  const p = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'tavern':    return <svg {...p}><path d="M5 2h6L9 9H7L5 2z"/><line x1="8" y1="9" x2="8" y2="13"/><line x1="5" y1="13" x2="11" y2="13"/></svg>;
    case 'adventure': return <svg {...p}><circle cx="8" cy="8" r="6"/><polyline points="6,7 8,3 10,7"/><line x1="8" y1="3" x2="8" y2="13"/></svg>;
    case 'combat':    return <svg {...p}><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/><line x1="2" y1="6" x2="6" y2="2"/><line x1="14" y1="6" x2="10" y2="2"/><line x1="2" y1="10" x2="6" y2="14"/><line x1="14" y1="10" x2="10" y2="14"/></svg>;
    case 'mystery':   return <svg {...p}><path d="M1 8s3-5.5 7-5.5S15 8 15 8s-3 5.5-7 5.5S1 8 1 8z"/><circle cx="8" cy="8" r="2"/></svg>;
    case 'rest':      return <svg {...p}><path d="M12 4.5a6 6 0 1 1-7.5 7.5 5 5 0 0 0 7.5-7.5z"/></svg>;
    default:          return <svg {...p}/>;
  }
}

function VolumeIcon({ muted }: { muted: boolean }) {
  const p = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg {...p}>
      <path d="M3 6H1v4h2l4 3V3L3 6z"/>
      {muted
        ? (<><line x1="10" y1="6" x2="14" y2="10"/><line x1="14" y1="6" x2="10" y2="10"/></>)
        : (<><path d="M10 5.5a4 4 0 0 1 0 5"/><path d="M12.5 3a7 7 0 0 1 0 10"/></>)
      }
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 13V4l8-2v9"/><circle cx="4" cy="13" r="2"/><circle cx="12" cy="11" r="2"/>
    </svg>
  );
}

const popupVariants = {
  hidden:  { opacity: 0, scale: 0.9, y: 4 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { type: 'spring' as const, stiffness: 460, damping: 28 } },
  exit:    { opacity: 0, scale: 0.9, y: 4, transition: { duration: 0.13 } },
};

const FADE_MS = 700;

export function MusicPanel({ instanceId }: Props) {
  const [category, setCategory]       = useState<CategoryKey>('tavern');
  const [songIndex, setSongIndex]     = useState(0);
  const [sfxVolumes, setSfxVolumes]   = useState<Record<string, number>>({});
  const [musicVolume, setMusicVolume] = useState(0.4);
  const [openSfx, setOpenSfx]         = useState<string | null>(null);
  const [showVol, setShowVol]          = useState(false);

  // Two audio slots for crossfade
  const audioA      = useRef(new Audio());
  const audioB      = useRef(new Audio());
  const activeSlot  = useRef<'a' | 'b'>('a');
  const cancelFades = useRef<Array<() => void>>([]);

  // Keep a ref so the crossfade effect always reads the latest volume
  const musicVolumeRef = useRef(musicVolume);
  useEffect(() => { musicVolumeRef.current = musicVolume; }, [musicVolume]);

  const sfxRefs = useRef<Record<string, HTMLAudioElement>>({});

  // ── socket sync ─────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    socket.on('session_music', p => { setCategory(p.category as CategoryKey); setSongIndex(p.songIndex); setSfxVolumes(p.sfxVolumes); });
    socket.on('music_sync',   p => { setCategory(p.category as CategoryKey); setSongIndex(p.songIndex); });
    socket.on('sfx_sync',     p => setSfxVolumes(prev => ({ ...prev, [p.sfxId]: p.volume })));
    return () => { socket.off('session_music'); socket.off('music_sync'); socket.off('sfx_sync'); };
  }, []);

  // ── music crossfade on category / song change ────────────────────
  useEffect(() => {
    cancelFades.current.forEach(f => f());
    cancelFades.current = [];

    const outSlot  = activeSlot.current;
    const inSlot   = outSlot === 'a' ? 'b' : 'a';
    const outAudio = outSlot === 'a' ? audioA.current : audioB.current;
    const inAudio  = inSlot  === 'a' ? audioA.current : audioB.current;
    activeSlot.current = inSlot;

    const src = MUSIC_CATEGORIES[category][songIndex]?.src;

    // If outgoing audio isn't audibly playing (first mount, or StrictMode remount after
    // cleanup paused everything), skip crossfade and start immediately at target volume.
    const outIsPlaying = !outAudio.paused && outAudio.volume > 0;

    if (!outIsPlaying) {
      if (src) {
        inAudio.src = src;
        inAudio.loop = true;
        inAudio.volume = musicVolumeRef.current;
        void inAudio.play().catch(() => {});
      }
      return;
    }

    // Song switch: equal-power crossfade
    cancelFades.current.push(fadeOut(outAudio, FADE_MS, () => outAudio.pause()));
    if (src) {
      inAudio.src = src;
      inAudio.loop = true;
      inAudio.volume = 0;
      void inAudio.play().catch(() => {});
      cancelFades.current.push(fadeIn(inAudio, musicVolumeRef.current, FADE_MS));
    }

    return () => {
      cancelFades.current.forEach(f => f());
      cancelFades.current = [];
    };
  }, [category, songIndex]);

  // ── master volume — update active slot only, no crossfade ───────
  useEffect(() => {
    const active = activeSlot.current === 'a' ? audioA.current : audioB.current;
    active.volume = musicVolume;
  }, [musicVolume]);

  // ── cleanup on unmount ───────────────────────────────────────────
  useEffect(() => {
    return () => {
      audioA.current.pause();
      audioB.current.pause();
    };
  }, []);

  // ── sfx playback ─────────────────────────────────────────────────
  useEffect(() => {
    SFX_TRACKS.forEach(track => {
      const vol = sfxVolumes[track.id] ?? 0;
      if (!sfxRefs.current[track.id]) {
        sfxRefs.current[track.id] = new Audio(track.src);
        sfxRefs.current[track.id].loop = true;
      }
      const audio = sfxRefs.current[track.id];
      audio.volume = vol;
      if (vol > 0 && track.src) audio.play().catch(() => {}); else audio.pause();
    });
  }, [sfxVolumes]);

  // ── handlers ─────────────────────────────────────────────────────
  function handleCategoryClick(cat: CategoryKey) {
    const nextIndex = cat === category ? (songIndex + 1) % MUSIC_CATEGORIES[cat].length : 0;
    setCategory(cat); setSongIndex(nextIndex);
    getSocket().emit('music_change', { instanceId, category: cat, songIndex: nextIndex });
  }

  function handleSfxVolume(sfxId: string, volume: number) {
    setSfxVolumes(prev => ({ ...prev, [sfxId]: volume }));
    getSocket().emit('sfx_change', { instanceId, sfxId, volume });
  }

  const currentSong = MUSIC_CATEGORIES[category][songIndex];

  return (
    <div className="music-panel">

      {/* Row 1 — SFX + local volume */}
      <div className="music-panel__row music-panel__sfx-row">
        {SFX_TRACKS.map(track => {
          const vol = sfxVolumes[track.id] ?? 0;
          return (
            <div key={track.id} className="sfx-ctrl">
              <button
                className={`sfx-ctrl__btn${vol > 0 ? ' sfx-ctrl__btn--on' : ''}`}
                title={track.label}
                onClick={() => setOpenSfx(p => p === track.id ? null : track.id)}
              >
                <SfxIcon id={track.id} />
              </button>
              <AnimatePresence>
                {openSfx === track.id && (
                  <motion.div className="sfx-ctrl__popup" variants={popupVariants} initial="hidden" animate="visible" exit="exit">
                    <span className="sfx-ctrl__popup-label">{track.label}</span>
                    <input type="range" className="sfx-ctrl__slider" min={0} max={1} step={0.01} value={vol}
                      onChange={e => handleSfxVolume(track.id, parseFloat(e.target.value))} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        <div className="sfx-ctrl music-panel__vol-ctrl">
          <button
            className={`sfx-ctrl__btn${showVol ? ' sfx-ctrl__btn--on' : ''}`}
            title="My volume (not synced)"
            onClick={() => setShowVol(p => !p)}
          >
            <VolumeIcon muted={musicVolume === 0} />
          </button>
          <AnimatePresence>
            {showVol && (
              <motion.div className="sfx-ctrl__popup" variants={popupVariants} initial="hidden" animate="visible" exit="exit">
                <span className="sfx-ctrl__popup-label">My Volume</span>
                <input type="range" className="sfx-ctrl__slider" min={0} max={1} step={0.01} value={musicVolume}
                  onChange={e => setMusicVolume(parseFloat(e.target.value))} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="music-panel__divider" />

      {/* Row 2 — Category icons */}
      <div className="music-panel__row music-panel__cat-row">
        {CATEGORY_KEYS.map(cat => (
          <button
            key={cat}
            className={`cat-btn${cat === category ? ' cat-btn--active' : ''}`}
            onClick={() => handleCategoryClick(cat)}
            title={cat === category ? `${CATEGORY_LABELS[cat]} — next song` : CATEGORY_LABELS[cat]}
          >
            <CategoryIcon id={cat} />
          </button>
        ))}
      </div>

      <div className="music-panel__divider" />

      {/* Row 3 — Now playing */}
      <div className="music-panel__row music-panel__now-playing">
        <span className="music-panel__np-label">Now Playing</span>
        <span className="music-panel__np-title">
          <NoteIcon />
          {currentSong?.title ?? '—'}
          {!currentSong?.src && <em className="music-panel__np-placeholder"> · placeholder</em>}
        </span>
      </div>

    </div>
  );
}
