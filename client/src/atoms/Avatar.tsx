interface Props {
  userId: string;
  avatar: string | null;
  username: string;
  size?: number;
}

export function Avatar({ userId, avatar, username, size = 30 }: Props) {
  return (
    <div
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {avatar ? (
        <img
          src={`https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=64`}
          alt={username}
        />
      ) : (
        <span>{username[0].toUpperCase()}</span>
      )}
    </div>
  );
}
