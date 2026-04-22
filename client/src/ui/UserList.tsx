import { useStore } from '../state/store';

export function UserList() {
  const { state } = useStore();
  const currentUserId = state.currentUser?.userId;

  return (
    <div className="panel adventurers-panel">
      <div className="panel-title">Adventurers</div>
      {state.users.map(user => {
        const isCurrent = user.userId === currentUserId;
        return (
          <div key={user.userId} className={`user-row${isCurrent ? ' is-current' : ''}`}>
            <div className="avatar">
              {user.avatar ? (
                <img
                  src={`https://cdn.discordapp.com/avatars/${user.userId}/${user.avatar}.png?size=64`}
                  alt={user.username}
                />
              ) : (
                user.username[0].toUpperCase()
              )}
            </div>
            <span className="username">{user.username}</span>
            {isCurrent && <span className="you-badge">You</span>}
          </div>
        );
      })}
    </div>
  );
}
