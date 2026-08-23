import { useEffect, useRef, useState, useCallback } from "react";
import { DiscordSDK, patchUrlMappings } from "@discord/embedded-app-sdk";
import { AnimatePresence, motion, useMotionValue, useSpring } from "motion/react";
import { getSocket } from "./socket/client";
import { StoreProvider, useStore } from "./state/store";
import { PlayerBar } from "./organisms/PlayerBar";
import { RollToast } from "./organisms/RollToast";
import { RollLogModal } from "./organisms/RollLogModal";
import { DiceMenu } from "./organisms/DiceMenu";
import { MusicPanel } from "./organisms/MusicPanel";
import { TapIndicator } from "./atoms/TapIndicator";
import {
  BACKGROUND_IMAGE,
  ROLLING_VIDEO,
  ROLLING_AUDIO,
  REVEAL1_VIDEO,
  REVEAL1_AUDIO,
  REVEAL2_VIDEO,
  REVEAL2_AUDIO,
  REVEAL3_VIDEO,
  REVEAL3_AUDIO,
  REVEAL3_SKIP_TIME,
  preloadRollAssets,
  type RevealVariant,
} from "./utils/rollAnimations";
import "./styles/ui.css";

// The 3-tap reveal drives one <video> + one <audio> element through this
// sequence: background -> rolling (d20roll clip, plays once) -> dice-ready
// (static background.png, awaiting taps) -> reveal1 -> reveal2 -> reveal3
// -> back to background. Each reveal stage only ever advances on an
// explicit tap (server-authoritative — see roll_advance below); nothing
// auto-chains except rolling -> dice-ready.
type VideoPhase =
  | "background"
  | "rolling"
  | "dice-ready"
  | "reveal1"
  | "reveal2"
  | "reveal3";

interface JoinPrompt {
  rollId: string;
  username: string;
  dice: string;
}

const discordSdk = new DiscordSDK(
  import.meta.env.VITE_DISCORD_CLIENT_ID as string,
);

const REVEAL_HOLD_MS = 3500;

function ActivityApp() {
  const { state, dispatch } = useStore();
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [appStatus, setAppStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [videoPhase, setVideoPhase] = useState<VideoPhase>("background");
  const [revealVariant, setRevealVariant] = useState<RevealVariant | null>(
    null,
  );
  const [clickCount, setClickCount] = useState(0);
  // Set once a reveal1/reveal2 clip has played through on its own (before
  // the next tap arrives) — the static background.png shows in its place
  // while waiting, rather than leaving the clip frozen on its last frame.
  const [stageVideoEnded, setStageVideoEnded] = useState(false);
  // Reveal3's own ending: its last frame dissolves into background.png via
  // a rasterize/pixelate effect instead of a plain cut.
  const [transitioning, setTransitioning] = useState(false);
  const [bgFadeIn, setBgFadeIn] = useState(0);
  const [joinPrompt, setJoinPrompt] = useState<JoinPrompt | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sequenceAudioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Tracks which rollId the current user is watching (as roller or
  // watcher). Kept as a ref (for the socket-handler closures registered
  // once in the setup effect below, which need the always-current value
  // regardless of their own stale closure) mirrored into state (for
  // render — reading a ref during render isn't allowed).
  const watchingRollId = useRef<string | null>(null);
  const [watchedRollIdState, setWatchedRollIdState] = useState<string | null>(
    null,
  );
  const setWatching = useCallback((id: string | null) => {
    watchingRollId.current = id;
    setWatchedRollIdState(id);
  }, []);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rasterizeStartedRef = useRef(false);
  const woodHitRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const hit = new Audio("/audio/wood-hit.mp3");
    hit.load();
    woodHitRef.current = hit;
  }, []);

  // Background parallax
  const bgRawX = useMotionValue(0);
  const bgRawY = useMotionValue(0);
  const bgX = useSpring(bgRawX, { stiffness: 40, damping: 18 });
  const bgY = useSpring(bgRawY, { stiffness: 40, damping: 18 });

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      bgRawX.set(((e.clientX - cx) / cx) * -10);
      bgRawY.set(((e.clientY - cy) / cy) * -10);
    },
    [bgRawX, bgRawY],
  );

  const currentUserId = state.currentUser?.userId;
  const myPendingRoll = currentUserId
    ? Object.values(state.pendingRolls).find((p) => p.userId === currentUserId)
    : null;
  // Render-time-safe: derived from state, not the watchingRollId ref.
  const isRollerOfWatched =
    !!myPendingRoll && myPendingRoll.rollId === watchedRollIdState;

  // Starts a stage's video+audio together from `startTime` (default 0).
  // Always hard-cuts whatever was previously playing — a tap (or an
  // incoming roll_advance) never waits for the current clip to finish.
  const playSequenceStage = useCallback(
    (videoSrc: string, audioSrc: string, startTime = 0) => {
      setStageVideoEnded(false);
      const video = videoRef.current;
      const audio = sequenceAudioRef.current;

      const applyAndPlay = (el: HTMLMediaElement) => {
        if (startTime > 0) {
          const seek = () => {
            el.currentTime = startTime;
            void el.play().catch(() => {});
          };
          if (el.readyState >= 1) seek();
          else el.addEventListener("loadedmetadata", seek, { once: true });
        } else {
          void el.play().catch(() => {});
        }
      };

      if (video) {
        video.pause();
        video.src = videoSrc;
        video.load();
        applyAndPlay(video);
      }
      if (audio) {
        audio.pause();
        audio.src = audioSrc;
        audio.load();
        applyAndPlay(audio);
      }
    },
    [],
  );

  const enterRolling = useCallback(() => {
    // Defensive reset in case a new roll starts while the previous one's
    // rasterize transition (see startRasterizeTransition) was still
    // mid-flight.
    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    rasterizeStartedRef.current = true;
    setTransitioning(false);
    setBgFadeIn(0);
    setVideoPhase("rolling");
    setRevealVariant(null);
    playSequenceStage(ROLLING_VIDEO, ROLLING_AUDIO);
  }, [playSequenceStage]);

  const enterReveal1 = useCallback(() => {
    setVideoPhase("reveal1");
    setRevealVariant(null);
    playSequenceStage(REVEAL1_VIDEO, REVEAL1_AUDIO);
  }, [playSequenceStage]);

  const enterReveal2 = useCallback(
    (variant: "normal" | "gold" | "red") => {
      setVideoPhase("reveal2");
      setRevealVariant(variant);
      playSequenceStage(REVEAL2_VIDEO[variant], REVEAL2_AUDIO[variant]);
    },
    [playSequenceStage],
  );

  // Reveal3's last frame dissolves into background.png via a
  // rasterize/pixelate effect rather than a plain cut — captures the
  // frozen last frame once, then repeatedly redraws it at a shrinking
  // resolution (blown back up with smoothing off, so it reads as
  // pixelation) while crossfading in the plain background image.
  const startRasterizeTransition = useCallback(() => {
    if (rasterizeStartedRef.current) return;
    rasterizeStartedRef.current = true;
    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }

    const finish = () => {
      setTransitioning(false);
      setBgFadeIn(0);
      setVideoPhase("background");
      setRevealVariant(null);
      setWatching(null);
      setClickCount(0);
    };

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) {
      finish();
      return;
    }

    const w = video.videoWidth;
    const h = video.videoHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      finish();
      return;
    }

    // One-time snapshot of the frozen last frame — everything after this
    // redraws from here, not from the (paused) video element.
    const snapshot = document.createElement("canvas");
    snapshot.width = w;
    snapshot.height = h;
    const snapCtx = snapshot.getContext("2d");
    if (!snapCtx) {
      finish();
      return;
    }
    snapCtx.drawImage(video, 0, 0, w, h);

    setTransitioning(true);
    setBgFadeIn(0);

    const DURATION_MS = 650;
    const MAX_BLOCK = 48;
    const start = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      const blockSize = 1 + t * (MAX_BLOCK - 1);
      const smallW = Math.max(1, Math.floor(w / blockSize));
      const smallH = Math.max(1, Math.floor(h / blockSize));

      const tmp = document.createElement("canvas");
      tmp.width = smallW;
      tmp.height = smallH;
      const tmpCtx = tmp.getContext("2d");
      if (tmpCtx) {
        tmpCtx.imageSmoothingEnabled = true;
        tmpCtx.drawImage(snapshot, 0, 0, smallW, smallH);
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(tmp, 0, 0, smallW, smallH, 0, 0, w, h);
      }
      setBgFadeIn(t);

      if (t < 1) requestAnimationFrame(step);
      else finish();
    };
    requestAnimationFrame(step);
  }, [setWatching]);

  const enterReveal3 = useCallback(
    (variant: RevealVariant, frame40: boolean) => {
      rasterizeStartedRef.current = false;
      setVideoPhase("reveal3");
      setRevealVariant(variant);
      playSequenceStage(
        REVEAL3_VIDEO[variant],
        REVEAL3_AUDIO[variant],
        frame40 ? REVEAL3_SKIP_TIME : 0,
      );

      // Safety net in case 'ended' never fires (e.g. autoplay blocked and
      // the clip never actually started).
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
      revealTimerRef.current = setTimeout(
        () => startRasterizeTransition(),
        REVEAL_HOLD_MS,
      );
    },
    [playSequenceStage, startRasterizeTransition],
  );

  // The rolling clip is the only stage that auto-advances on its own
  // (-> the static "awaiting taps" background). reveal1/reveal2 settle on
  // the same static background if their clip finishes before the next tap
  // arrives, but stay on their own phase (still awaiting a tap). reveal3
  // dissolves into the background via the rasterize transition above.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (videoPhase === "rolling") {
      const onEnded = () => setVideoPhase("dice-ready");
      video.addEventListener("ended", onEnded);
      return () => video.removeEventListener("ended", onEnded);
    }
    if (videoPhase === "reveal1" || videoPhase === "reveal2") {
      const onEnded = () => setStageVideoEnded(true);
      video.addEventListener("ended", onEnded);
      return () => video.removeEventListener("ended", onEnded);
    }
    if (videoPhase === "reveal3") {
      const onEnded = () => startRasterizeTransition();
      video.addEventListener("ended", onEnded);
      return () => video.removeEventListener("ended", onEnded);
    }
  }, [videoPhase, startRasterizeTransition]);

  // Tap-to-reveal: only the roller can tap, and only while a stage that
  // accepts a tap is showing. The server decides what happens next (it
  // knows the actual result; the roller doesn't, until the final tap) —
  // this just reports the tap and, for a would-be 3rd tap, whether the
  // current clip was still playing (decides the frame-40 skip).
  const handleVideoClick = useCallback(() => {
    if (!instanceId || !myPendingRoll || !isRollerOfWatched) return;
    if (
      videoPhase !== "dice-ready" &&
      videoPhase !== "reveal1" &&
      videoPhase !== "reveal2"
    ) {
      return;
    }
    if (clickCount >= 3) return;

    if (woodHitRef.current) {
      (woodHitRef.current.cloneNode() as HTMLAudioElement)
        .play()
        .catch(() => {});
    }

    const wasInterrupted =
      videoPhase !== "dice-ready" &&
      !!videoRef.current &&
      !videoRef.current.ended;

    setClickCount((c) => Math.min(c + 1, 3));
    getSocket().emit("roll_tap", {
      instanceId,
      rollId: myPendingRoll.rollId,
      wasInterrupted,
    });
  }, [instanceId, myPendingRoll, isRollerOfWatched, videoPhase, clickCount]);

  // Watcher opts in to see a roll — always starts at the rolling clip,
  // same as the roller, regardless of how far along the actual roll
  // already is; the next roll_advance this client receives will jump it
  // straight to wherever the host currently is.
  const handleJoin = useCallback(() => {
    if (!joinPrompt || !instanceId) return;
    getSocket().emit("roll_join", { instanceId, rollId: joinPrompt.rollId });
    setWatching(joinPrompt.rollId);
    setClickCount(0);
    enterRolling();
    setJoinPrompt(null);
  }, [joinPrompt, instanceId, enterRolling, setWatching]);

  const handleDismiss = useCallback(() => setJoinPrompt(null), []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        await discordSdk.ready();
        if (cancelled) return;

        const serverHost = (import.meta.env.VITE_SERVER_URL as string).replace(
          /^https?:\/\//,
          "",
        );
        patchUrlMappings([{ prefix: "/server", target: serverHost }]);

        const { code } = await discordSdk.commands.authorize({
          client_id: import.meta.env.VITE_DISCORD_CLIENT_ID as string,
          response_type: "code",
          state: "",
          prompt: "none",
          scope: ["identify", "guilds", "applications.commands"],
        });
        if (cancelled) return;

        const res = await fetch(
          `${import.meta.env.VITE_SERVER_URL}/api/discord-auth/token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
          },
        );
        if (cancelled) return;

        const { access_token } = (await res.json()) as { access_token: string };
        const auth = await discordSdk.commands.authenticate({ access_token });
        if (cancelled) return;
        if (!auth) throw new Error("authenticate() returned null");

        const iid = discordSdk.instanceId;
        const cid = discordSdk.channelId ?? "";

        dispatch({
          type: "SET_AUTH",
          payload: {
            user: {
              userId: auth.user.id,
              username: auth.user.username,
              avatar: auth.user.avatar ?? null,
            },
            instanceId: iid,
            channelId: cid,
          },
        });
        setInstanceId(iid);

        const socket = getSocket();
        socket.on("session_users", (payload) =>
          dispatch({ type: "SESSION_USERS", payload }),
        );
        socket.on("roll_history", (payload) =>
          dispatch({ type: "ROLL_HISTORY", payload }),
        );
        socket.on("user_joined", (payload) =>
          dispatch({ type: "USER_JOINED", payload }),
        );
        socket.on("user_left", (payload) =>
          dispatch({ type: "USER_LEFT", payload }),
        );

        socket.on("roll_started", (payload) => {
          dispatch({ type: "ROLL_STARTED", payload });
          // A new roll starting means any grace-period timer left over from
          // this client's previous reveal is stale — if left alone it fires
          // later and forces videoPhase back to "background" mid-roll,
          // stranding the tap-to-reveal overlay for this new roll.
          if (revealTimerRef.current) {
            clearTimeout(revealTimerRef.current);
            revealTimerRef.current = null;
          }
          if (payload.userId === auth.user.id) {
            // Current user is the roller — immediately watch
            setWatching(payload.rollId);
            setClickCount(0);
            enterRolling();
          } else {
            // Someone else rolled — offer to join
            setJoinPrompt({
              rollId: payload.rollId,
              username: payload.username,
              dice: payload.dice,
            });
          }
        });

        // Every tap (from the roller, whoever that is) broadcasts here —
        // hard-cut to whatever stage the host just advanced to, whether
        // this client is the roller or a watcher who joined mid-roll.
        socket.on("roll_advance", (payload) => {
          if (watchingRollId.current !== payload.rollId) return;
          if (payload.stage === 1) {
            enterReveal1();
          } else if (payload.stage === 2 && payload.variant) {
            enterReveal2(payload.variant as "normal" | "gold" | "red");
          } else if (payload.stage === 3 && payload.variant) {
            enterReveal3(payload.variant, !!payload.frame40);
          }
        });

        // Updates roll history / toast — the video itself is already
        // driven by roll_advance's stage-3 event, which always arrives
        // first for the same tap.
        socket.on("roll_revealed", (payload) => {
          dispatch({ type: "ROLL_REVEALED", payload });
          if (watchingRollId.current === payload.entry.id) {
            setWatching(null);
          }
          setJoinPrompt(null);
          setClickCount(0);
        });

        socket.on("roll_cancelled", (payload) => {
          dispatch({ type: "ROLL_CANCELLED", payload });
          if (watchingRollId.current === payload.rollId) {
            if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
            setVideoPhase("background");
            setRevealVariant(null);
            setWatching(null);
          }
          setJoinPrompt((prev) =>
            prev?.rollId === payload.rollId ? null : prev,
          );
          setClickCount(0);
        });

        socket.on("session_music", (payload) =>
          dispatch({ type: "SESSION_MUSIC", payload }),
        );
        socket.on("music_sync", (payload) =>
          dispatch({ type: "MUSIC_SYNC", payload }),
        );
        socket.on("sfx_sync", (payload) =>
          dispatch({ type: "SFX_SYNC", payload }),
        );

        socket.emit("join", {
          instanceId: iid,
          channelId: cid,
          user: {
            userId: auth.user.id,
            username: auth.user.username,
            avatar: auth.user.avatar ?? null,
          },
        });

        try {
          discordSdk.subscribe(
            "ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE",
            () => {},
          );
        } catch {
          // not in a voice channel context — safe to ignore
        }

        // Warm the browser's cache for every roll animation clip now, so
        // the first roll of the session doesn't stutter on a cold fetch.
        preloadRollAssets();

        setAppStatus("ready");
      } catch (e) {
        if (cancelled) return;
        console.error("[ActivityApp] Setup failed:", e);
        setAppStatus("error");
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    dispatch,
    enterRolling,
    enterReveal1,
    enterReveal2,
    enterReveal3,
    setWatching,
  ]);

  if (appStatus === "loading") {
    return (
      <div className="auth-screen">
        <div className="auth-icon">⚄</div>
        <p className="auth-status">Connecting…</p>
      </div>
    );
  }

  if (appStatus === "error") {
    return (
      <div className="auth-screen">
        <div className="auth-icon auth-icon--error">✕</div>
        <p className="auth-error">
          Connection failed.
          <br />
          Reload to try again.
        </p>
      </div>
    );
  }

  const isClickable =
    isRollerOfWatched &&
    clickCount < 3 &&
    (videoPhase === "dice-ready" ||
      videoPhase === "reveal1" ||
      videoPhase === "reveal2");

  return (
    <div className="app-root" onMouseMove={handleMouseMove}>
      {/* Full-screen video background */}
      <div
        className={`video-stage${isClickable ? " video-stage--clickable" : ""}${revealVariant ? ` video-stage--${revealVariant}` : ""}`}
        onClick={handleVideoClick}
      >
        {/* Always mounted (even during "background", fully transparent)
            so videoRef/sequenceAudioRef are never null the instant a roll
            starts — playSequenceStage runs imperatively, synchronously
            with the phase-change call, not from an effect that would wait
            for a fresh mount. */}
        <video
          ref={videoRef}
          className="video-stage__video"
          autoPlay
          playsInline
          style={
            videoPhase === "background" || transitioning
              ? { opacity: 0 }
              : undefined
          }
        />
        <audio ref={sequenceAudioRef} />

        {videoPhase === "background" && (
          <motion.div
            className="bg-ambient"
            animate={{ x: [0, 8, -5, 4, 0], y: [0, -6, 8, -4, 0] }}
            transition={{
              duration: 30,
              repeat: Infinity,
              ease: "easeInOut",
              times: [0, 0.25, 0.5, 0.75, 1],
            }}
          >
            <motion.div className="bg-parallax" style={{ x: bgX, y: bgY }}>
              <img
                src={BACKGROUND_IMAGE}
                className="bg-image"
                alt=""
                draggable={false}
              />
            </motion.div>
          </motion.div>
        )}
        {(videoPhase === "dice-ready" ||
          ((videoPhase === "reveal1" || videoPhase === "reveal2") &&
            stageVideoEnded)) &&
          !transitioning && (
            <img
              src={BACKGROUND_IMAGE}
              className="bg-image roll-static-overlay"
              alt=""
              draggable={false}
            />
          )}
        {transitioning && (
          <>
            <img
              src={BACKGROUND_IMAGE}
              className="bg-image roll-static-overlay"
              alt=""
              draggable={false}
              style={{ opacity: bgFadeIn }}
            />
            <canvas
              ref={canvasRef}
              className="video-stage__video roll-static-overlay"
              style={{ opacity: 1 - bgFadeIn }}
            />
          </>
        )}

        {/* Tap-to-reveal overlay — shown only to the roller */}
        <AnimatePresence>
          {isClickable && (
            <motion.div
              className="tap-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.3 } }}
              transition={{ duration: 0.25 }}
            >
              <p className="tap-overlay__hint">Tap to reveal</p>
              <div className="tap-overlay__dots">
                {Array.from({ length: 3 }).map((_, i) => (
                  <TapIndicator key={i} filled={i < clickCount} />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* HUD overlay — pointer-events: none, children opt in */}
      <div className="hud">
        {/* Top-left: floating player list */}
        <PlayerBar />

        {/* Bottom-center: roll results popup (auto-dismiss, no log button) */}
        <RollToast />

        {/* Top-right: persistent log button */}
        <motion.button
          className="log-btn"
          onClick={() => setLogOpen(true)}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.94 }}
          transition={{ type: "spring", stiffness: 480, damping: 28 }}
        >
          📜 Roll Log
        </motion.button>

        {/* Bottom-left: music panel */}
        {instanceId && <MusicPanel instanceId={instanceId} />}

        {/* Bottom-center: watch prompt */}
        <AnimatePresence>
          {joinPrompt && !myPendingRoll && (
            <motion.div
              className="join-prompt"
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 440, damping: 30 }}
            >
              <div className="join-prompt__info">
                <span className="join-prompt__roller">
                  {joinPrompt.username}
                </span>
                <span> is rolling </span>
                <span className="join-prompt__dice">{joinPrompt.dice}</span>
              </div>
              <div className="join-prompt__actions">
                <button className="join-prompt__watch" onClick={handleJoin}>
                  Watch
                </button>
                <button
                  className="join-prompt__dismiss"
                  onClick={handleDismiss}
                >
                  ✕
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom-right: dice FAB + expandable menu */}
        {instanceId && <DiceMenu instanceId={instanceId} />}

        {/* Full roll log modal with animated entrance/exit */}
        <AnimatePresence>
          {logOpen && <RollLogModal onClose={() => setLogOpen(false)} />}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <ActivityApp />
    </StoreProvider>
  );
}
