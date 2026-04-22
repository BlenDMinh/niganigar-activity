import { useEffect, useState } from 'react';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import { getSocket } from './socket/client';
import { StoreProvider, useStore } from './state/store';
import { UserList } from './ui/UserList';
import { RollHistory } from './ui/RollHistory';
import { DicePicker } from './ui/DicePicker';
import './styles/ui.css';

const discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID as string);

function ActivityApp() {
  const { dispatch } = useStore();
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

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
        socket.on('roll_history', payload => dispatch({ type: 'ROLL_HISTORY', payload }));
        socket.on('user_joined', payload => dispatch({ type: 'USER_JOINED', payload }));
        socket.on('user_left', payload => dispatch({ type: 'USER_LEFT', payload }));
        socket.on('roll_started', payload => dispatch({ type: 'ROLL_STARTED', payload }));
        socket.on('roll_revealed', payload => dispatch({ type: 'ROLL_REVEALED', payload }));
        socket.on('roll_cancelled', payload => dispatch({ type: 'ROLL_CANCELLED', payload }));

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

        console.log('[ActivityApp] Auth complete, joined session', iid);
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        console.error('[ActivityApp] Setup failed:', e);
        setStatus('error');
      }
    }

    void run();
    return () => { cancelled = true; };
  }, [dispatch]);

  if (status === 'loading') {
    return (
      <div className="auth-screen">
        <div className="auth-sigil">⚄</div>
        <p className="auth-word">Entering the realm…</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="auth-screen">
        <div className="auth-sigil">✦</div>
        <p className="auth-err">
          The arcane connection failed.<br />Reload to try again.
        </p>
      </div>
    );
  }

  return (
    <div className="app-root">
      <video className="bg-video" autoPlay loop muted playsInline>
        <source src="/background.webm" type="video/webm" />
        <source src="/background.mp4" type="video/mp4" />
      </video>
      <div className="bg-overlay" />
      <div className="stage">
        <UserList />
        <RollHistory />
        {instanceId && <DicePicker instanceId={instanceId} />}
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
