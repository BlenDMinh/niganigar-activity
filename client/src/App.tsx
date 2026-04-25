import { useEffect, useRef, useState, useCallback } from "react";
import { DiscordSDK, patchUrlMappings } from "@discord/embedded-app-sdk";
import {
  AnimatePresence,
  motion,
  useAnimate,
  useMotionValue,
  useSpring,
} from "motion/react";
import { getSocket } from "./socket/client";
import { StoreProvider, useStore } from "./state/store";
import { PlayerBar } from "./organisms/PlayerBar";
import { RollToast } from "./organisms/RollToast";
import { RollLogModal } from "./organisms/RollLogModal";
import { DiceMenu } from "./organisms/DiceMenu";
import { MusicPanel } from "./organisms/MusicPanel";
import { TapIndicator } from "./atoms/TapIndicator";
import type { RollEntry } from "./types";
import "./styles/ui.css";

type VideoPhase = "background" | "dice-ready" | "reveal" | "reveal-critical";

interface JoinPrompt {
  rollId: string;
  username: string;
  dice: string;
}

const discordSdk = new DiscordSDK(
  import.meta.env.VITE_DISCORD_CLIENT_ID as string,
);

function ActivityApp() {
  const { state, dispatch } = useStore();
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [appStatus, setAppStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [videoPhase, setVideoPhase] = useState<VideoPhase>("background");
  const [clickCount, setClickCount] = useState(0);
  const [joinPrompt, setJoinPrompt] = useState<JoinPrompt | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Tracks which rollId the current user is watching (as roller or watcher)
  const watchingRollId = useRef<string | null>(null);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const woodHitRef = useRef<HTMLAudioElement | null>(null);
  const diceRollRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const hit = new Audio("/audio/wood-hit.mp3");
    hit.load();
    woodHitRef.current = hit;

    const roll = new Audio("/audio/dice-roll.mp3");
    roll.load();
    diceRollRef.current = roll;
  }, []);

  // useAnimate for page-shake effect
  const [appScope, animateApp] = useAnimate();

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

  // Drive the video element whenever the phase changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const isLoop = videoPhase === "background";
    const src =
      videoPhase === "background"
        ? "/background-video.mp4"
        : videoPhase === "dice-ready"
          ? "/dice-ready.mp4"
          : videoPhase === "reveal"
            ? "/dice-reveal.mp4"
            : "/dice-reveal-critical.mp4";

    video.src = src;
    video.loop = isLoop;
    video.load();
    video.play().catch(() => {});

    const freeze = () => {
      if (!isLoop) video.pause();
    };
    video.addEventListener("ended", freeze);
    return () => video.removeEventListener("ended", freeze);
  }, [videoPhase]);

  // 5-tap reveal mechanic with escalating page shake on each tap
  const handleVideoClick = useCallback(() => {
    if (videoPhase !== "dice-ready" || !myPendingRoll || !instanceId) return;

    if (woodHitRef.current) {
      (woodHitRef.current.cloneNode() as HTMLAudioElement).play().catch(() => {});
    }

    setClickCount((prev) => {
      const next = prev + 1;
      // Shake intensity scales with tap number (4, 6.5, 9, 11.5, 16 px)
      const amp = 4 + next * 2.5;
      void animateApp(
        appScope.current,
        {
          x: [-amp, amp, -(amp * 0.65), amp * 0.65, -(amp * 0.3), amp * 0.3, 0],
        },
        { duration: 0.38, ease: [0.36, 0.07, 0.19, 0.97] },
      );

      if (next >= 5) {
        if (diceRollRef.current) {
          (diceRollRef.current.cloneNode() as HTMLAudioElement).play().catch(() => {});
        }
        getSocket().emit("roll_reveal", {
          instanceId,
          rollId: myPendingRoll.rollId,
        });
        return 0;
      }
      return next;
    });
  }, [videoPhase, myPendingRoll, instanceId, appScope, animateApp]);

  // Watcher opts in to see a roll
  const handleJoin = useCallback(() => {
    if (!joinPrompt || !instanceId) return;
    getSocket().emit("roll_join", { instanceId, rollId: joinPrompt.rollId });
    watchingRollId.current = joinPrompt.rollId;
    setVideoPhase("dice-ready");
    setJoinPrompt(null);
  }, [joinPrompt, instanceId]);

  const handleDismiss = useCallback(() => setJoinPrompt(null), []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        await discordSdk.ready();
        if (cancelled) return;

        const serverHost = (import.meta.env.VITE_SERVER_URL as string).replace(/^https?:\/\//, '');
        patchUrlMappings([{ prefix: '/server', target: serverHost }]);

        const { code } = await discordSdk.commands.authorize({
          client_id: import.meta.env.VITE_DISCORD_CLIENT_ID as string,
          response_type: "code",
          state: "",
          prompt: "none",
          scope: ["identify", "guilds", "applications.commands"],
        });
        if (cancelled) return;

        const res = await fetch(`${import.meta.env.VITE_SERVER_URL}/api/discord-auth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
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
          if (payload.userId === auth.user.id) {
            // Current user is the roller — immediately watch
            watchingRollId.current = payload.rollId;
            setVideoPhase("dice-ready");
            setClickCount(0);
          } else {
            // Someone else rolled — offer to join
            setJoinPrompt({
              rollId: payload.rollId,
              username: payload.username,
              dice: payload.dice,
            });
          }
        });

        // Only switch to reveal video if this user was watching the roll
        socket.on("roll_revealed", (payload) => {
          dispatch({ type: "ROLL_REVEALED", payload });
          if (watchingRollId.current === payload.entry.id) {
            const entry: RollEntry = payload.entry;
            const isD20 = entry.dice.endsWith("d20");
            const isCritical =
              isD20 && entry.results.some((r) => r === 1 || r === 20);
            setVideoPhase(isCritical ? "reveal-critical" : "reveal");

            if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
            revealTimerRef.current = setTimeout(
              () => setVideoPhase("background"),
              5000,
            );
          }
          watchingRollId.current = null;
          setJoinPrompt(null);
          setClickCount(0);
        });

        socket.on("roll_cancelled", (payload) => {
          dispatch({ type: "ROLL_CANCELLED", payload });
          if (watchingRollId.current === payload.rollId) {
            if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
            setVideoPhase("background");
            watchingRollId.current = null;
          }
          setJoinPrompt((prev) =>
            prev?.rollId === payload.rollId ? null : prev,
          );
          setClickCount(0);
        });

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
  }, [dispatch]);

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

  const isClickable = videoPhase === "dice-ready" && !!myPendingRoll;

  return (
    <div className="app-root" ref={appScope} onMouseMove={handleMouseMove}>
      {/* Full-screen video background */}
      <div
        className={`video-stage${isClickable ? " video-stage--clickable" : ""}`}
        onClick={handleVideoClick}
      >
        {videoPhase === "background" ? (
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
            <motion.div
              className="bg-parallax"
              style={{ x: bgX, y: bgY }}
            >
              <img
                src="/img/temp_background.jpg"
                className="bg-image"
                alt=""
                draggable={false}
              />
            </motion.div>
          </motion.div>
        ) : (
          <video
            ref={videoRef}
            className="video-stage__video"
            autoPlay
            loop
            muted
            playsInline
          />
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
                {Array.from({ length: 5 }).map((_, i) => (
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
