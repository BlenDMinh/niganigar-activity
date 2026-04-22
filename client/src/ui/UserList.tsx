import { useStore } from '../state/store';

export function UserList() {
  const { state } = useStore();
  const currentUserId = state.currentUser?.userId;

  return (
    <div className="slab adventurers-panel">
      <div className="slab-title">
        <span className="slab-title-rune">✦</span>
        <span className="slab-title-text">Adventurers</span>
        <span className="slab-title-rune">✦</span>
      </div>
      <div className="user-list-body">
        {state.users.length === 0 ? (
          <p className="panel-empty">None yet venture forth…</p>
        ) : (
          state.users.map(user => {
            const isYou = user.userId === currentUserId;
            return (
              <div key={user.userId} className={`user-card${isYou ? ' is-you' : ''}`}>
                <div className="portrait">
                  {user.avatar ? (
                    <img
                      src={`https://cdn.discordapp.com/avatars/${user.userId}/${user.avatar}.png?size=64`}
                      alt={user.username}
                    />
                  ) : (
                    user.username[0].toUpperCase()
                  )}
                </div>
                <div className="user-card-info">
                  <span className="user-name">{user.username}</span>
                  {isYou && <span className="you-tag">You</span>}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
