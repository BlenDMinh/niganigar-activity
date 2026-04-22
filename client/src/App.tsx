import { useEffect, useRef, useState, useCallback } from 'react';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import { getSocket } from './socket/client';
import { StoreProvider, useStore } from './state/store';
import { UserList } from './ui/UserList';
import { RollHistory } from './ui/RollHistory';
import { DicePicker } from './ui/DicePicker';
import type { RollEntry } from './types';
import './styles/ui.css';

type VideoPhase = 'background' | 'dice-ready' | 'reveal' | 'reveal-critical';

interface JoinPrompt {
  rollId: string;
  username: string;
  dice: string;
}

const discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID as string);

function ActivityApp() {
  const { state, dispatch } = useStore();
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [appStatus, setAppStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [videoPhase, setVideoPhase] = useState<VideoPhase>('background');
  const [clickCount, setClickCount] = useState(0);
  const [joinPrompt, setJoinPrompt] = useState<JoinPrompt | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Tracks which rollId the current user is watching (as roller or watcher)
  const watchingRollId = useRef<string | null>(null);

  const currentUserId = state.currentUser?.userId;
  const myPendingRoll = currentUserId
    ? Object.values(state.pendingRolls).find(p => p.userId === currentUserId)
    : null;

  // Drive the video element whenever the phase changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const isLoop = videoPhase === 'background';
    const src =
      videoPhase === 'background'   ? '/background-video.mp4'
      : videoPhase === 'dice-ready' ? '/dice-ready.mp4'
      : videoPhase === 'reveal'     ? '/dice-reveal.mp4'
      :                               '/dice-reveal-critical.mp4';

    video.src = src;
    video.loop = isLoop;
    video.load();
    video.play().catch(() => {});

    const freeze = () => { if (!isLoop) video.pause(); };
    video.addEventListener('ended', freeze);
    return () => video.removeEventListener('ended', freeze);
  }, [videoPhase]);

  // 5-tap reveal mechanic: only active when current user has a pending roll
  const handleVideoClick = useCallback(() => {
    if (videoPhase !== 'dice-ready' || !myPendingRoll || !instanceId) return;
    setClickCount(prev => {
      const next = prev + 1;
      if (next >= 5) {
        getSocket().emit('roll_reveal', { instanceId, rollId: myPendingRoll.rollId });
        return 0;
      }
      return next;
    });
  }, [videoPhase, myPendingRoll, instanceId]);

  // Watcher opts in to see a roll
  const handleJoin = useCallback(() => {
    if (!joinPrompt || !instanceId) return;
    getSocket().emit('roll_join', { instanceId, rollId: joinPrompt.rollId });
    watchingRollId.current = joinPrompt.rollId;
    setVideoPhase('dice-ready');
    setJoinPrompt(null);
  }, [joinPrompt, instanceId]);

  const handleDismiss = useCallback(() => setJoinPrompt(null), []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        await discordSdk.ready();
        if (cancelled) return;

        const { code } = await discordSdk.commands.authorize({
          client_id: import.meta.env.VITE_DISCORD_CLIENT_ID as string,
          response_type: 'code',
          state: '',
          prompt: 'none',
          scope: ['identify', 'guilds', 'applications.commands'],
        });
        if (cancelled) return;

        const res = await fetch('/api/discord-auth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        if (cancelled) return;

        const { access_token } = (await res.json()) as { access_token: string };
        const auth = await discordSdk.commands.authenticate({ access_token });
        if (cancelled) return;
        if (!auth) throw new Error('authenticate() returned null');

        const iid = discordSdk.instanceId;
        const cid = discordSdk.channelId ?? '';

        dispatch({
          type: 'SET_AUTH',
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
        socket.on('session_users', payload => dispatch({ type: 'SESSION_USERS', payload }));
        socket.on('roll_history',  payload => dispatch({ type: 'ROLL_HISTORY',  payload }));
        socket.on('user_joined',   payload => dispatch({ type: 'USER_JOINED',   payload }));
        socket.on('user_left',     payload => dispatch({ type: 'USER_LEFT',     payload }));

        socket.on('roll_started', payload => {
          dispatch({ type: 'ROLL_STARTED', payload });
          if (payload.userId === auth.user.id) {
            // Current user is the roller — immediately watch
            watchingRollId.current = payload.rollId;
            setVideoPhase('dice-ready');
            setClickCount(0);
          } else {
            // Someone else rolled — offer to join
            setJoinPrompt({ rollId: payload.rollId, username: payload.username, dice: payload.dice });
          }
        });

        // Only switch to reveal video if this user was watching the roll
        socket.on('roll_revealed', payload => {
          dispatch({ type: 'ROLL_REVEALED', payload });
          if (watchingRollId.current === payload.entry.id) {
            const entry: RollEntry = payload.entry;
            const isD20 = entry.dice.endsWith('d20');
            const isCritical = isD20 && entry.results.some(r => r === 1 || r === 20);
            setVideoPhase(isCritical ? 'reveal-critical' : 'reveal');
          }
          watchingRollId.current = null;
          setJoinPrompt(null);
          setClickCount(0);
        });

        socket.on('roll_cancelled', payload => {
          dispatch({ type: 'ROLL_CANCELLED', payload });
          if (watchingRollId.current === payload.rollId) {
            setVideoPhase('background');
            watchingRollId.current = null;
          }
          setJoinPrompt(prev => prev?.rollId === payload.rollId ? null : prev);
          setClickCount(0);
        });

        socket.emit('join', {
          instanceId: iid,
          channelId: cid,
          user: {
            userId: auth.user.id,
            username: auth.user.username,
            avatar: auth.user.avatar ?? null,
          },
        });

        try {
          discordSdk.subscribe('ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE', () => {});
        } catch {
          // not in a voice channel context — safe to ignore
        }

        setAppStatus('ready');
      } catch (e) {
        if (cancelled) return;
        console.error('[ActivityApp] Setup failed:', e);
        setAppStatus('error');
      }
    }

    void run();
    return () => { cancelled = true; };
  }, [dispatch]);

  if (appStatus === 'loading') {
    return (
      <div className="auth-screen">
        <div className="auth-sigil">⚄</div>
        <p className="auth-word">Entering the realm…</p>
      </div>
    );
  }

  if (appStatus === 'error') {
    return (
      <div className="auth-screen">
        <div className="auth-sigil">✦</div>
        <p className="auth-err">
          The arcane connection failed.<br />Reload to try again.
        </p>
      </div>
    );
  }

  const isClickable = videoPhase === 'dice-ready' && !!myPendingRoll;

  return (
    <div className="app-root">
      {/* Center-stage video — the main focus */}
      <div
        className={`video-stage${isClickable ? ' is-clickable' : ''}`}
        onClick={handleVideoClick}
      >
        <video ref={videoRef} className="center-video" autoPlay loop muted playsInline />

        {/* Tap-to-reveal overlay — only shown to the roller */}
        {isClickable && (
          <div className="tap-overlay">
            <p className="tap-hint">Tap to unveil your fate</p>
            <div className="tap-runes">
              {Array.from({ length: 5 }).map((_, i) => (
                <span key={i} className={`tap-rune${i < clickCount ? ' lit' : ''}`}>◈</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* UI panels — absolute overlay, pointer-events managed per-child */}
      <div className="stage">
        <UserList />
        <RollHistory />
        {instanceId && <DicePicker instanceId={instanceId} />}

        {/* Watch prompt — shown to non-rollers when someone starts a roll */}
        {joinPrompt && !myPendingRoll && (
          <div className="join-prompt">
            <div className="join-info">
              <span className="join-roller">{joinPrompt.username}</span>
              <span className="join-text"> is casting </span>
              <span className="join-dice">{joinPrompt.dice}</span>
            </div>
            <div className="join-actions">
              <button className="join-watch-btn" onClick={handleJoin}>Watch</button>
              <button className="join-dismiss-btn" onClick={handleDismiss}>✕</button>
            </div>
          </div>
        )}
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
