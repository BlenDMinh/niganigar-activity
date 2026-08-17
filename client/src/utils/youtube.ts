const BARE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

export interface ParsedYoutubeLink {
  id: string;
  offsetSeconds: number;
}

// Parses YouTube's `t=`/`start=` timestamp format: either plain seconds
// ("90") or the compound "1h2m3s" shorthand (any of the three parts
// optional). Returns 0 for anything unparseable.
function parseTimestamp(raw: string | null): number {
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);

  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (!match) return 0;
  const [, h, m, s] = match;
  return (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0);
}

// Accepts a bare 11-char YouTube video id or any of the common URL shapes
// (watch, youtu.be, embed, shorts, live, music.youtube.com — with or
// without extra query params) and returns the video id plus any start-time
// offset from a `t=`/`start=` param, or null if nothing could be extracted.
export function parseYoutubeLink(input: string): ParsedYoutubeLink | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (BARE_ID_RE.test(trimmed)) return { id: trimmed, offsetSeconds: 0 };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");
  const offsetSeconds = parseTimestamp(
    url.searchParams.get("t") ?? url.searchParams.get("start"),
  );

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return BARE_ID_RE.test(id) ? { id, offsetSeconds } : null;
  }

  if (host === "youtube.com" || host === "music.youtube.com" || host === "m.youtube.com") {
    const vParam = url.searchParams.get("v");
    if (vParam && BARE_ID_RE.test(vParam)) return { id: vParam, offsetSeconds };

    const match = /^\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{11})/.exec(
      url.pathname,
    );
    if (match) return { id: match[1], offsetSeconds };
  }

  return null;
}
