import { useStore } from "../state/store";
import { Avatar } from "../atoms/Avatar";

export function PlayerBar() {
  const { state } = useStore();
  const currentUserId = state.currentUser?.userId;

  if (state.users.length === 0) return null;

  return (
    <div className="player-bar">
      {state.users.map((user) => {
        const isYou = user.userId === currentUserId;
        return (
          <div
            key={user.userId}
            className={`player-chip${isYou ? " player-chip--you" : ""}`}
          >
            <Avatar
              userId={user.userId}
              avatar={user.avatar}
              username={user.username}
              size={26}
            />
            <span className="player-chip__name">{user.username}</span>
            {isYou && <span className="player-chip__you">you</span>}
          </div>
        );
      })}
    </div>
  );
}
