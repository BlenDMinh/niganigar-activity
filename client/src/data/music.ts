export interface Song {
  title: string;
  // YouTube video id. Empty until a real link is assigned — the panel
  // silently skips songs with no id, same as it used to for empty src.
  youtubeId: string;
  // Seconds to skip into the video before playing/looping (e.g. to skip a
  // silent intro). Defaults to 0 when omitted.
  offsetSeconds?: number;
}

export interface SfxTrack {
  id: string;
  label: string;
  src: string;
  categorySrc?: Partial<Record<CategoryKey, string>>;
}

export const CATEGORY_KEYS = [
  "tavern",
  "adventure",
  "combat",
  "mystery",
  "rest",
] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  tavern: "Tavern",
  adventure: "Adventure",
  combat: "Combat",
  mystery: "Mystery",
  rest: "Rest",
};

export const MUSIC_CATEGORIES: Record<CategoryKey, Song[]> = {
  tavern: [
    { title: "The Wandering Bard", youtubeId: "kcIm2t6-qNs" },
    { title: "Hearth & Mead", youtubeId: "-foKvBw51HM" },
    { title: "Merchant Quarter", youtubeId: "gxZ2BRabb7Y" },
    { title: "Skyrim - The Bannered Mare", youtubeId: "uYDThGTph98" },
  ],
  adventure: [
    { title: "Road to the Unknown", youtubeId: "agiDB2q8KaE" },
    { title: "Through the Valley", youtubeId: "6XJCRO50ZUo" },
    { title: "Open Horizon", youtubeId: "hG-aIwMnk98" },
    { title: "Skyrim - Ancient Stones", youtubeId: "ys21nMW2oyc" },
  ],
  combat: [
    {
      title: "Limbus Company OST - Canto IX Boss 1 Battle Theme 2",
      youtubeId: "XsAml9lKf2U",
    },
    {
      title: "Bloodborne - Cleric Beast OST",
      youtubeId: "8LOR9JXK1Og",
    },
    {
      title: "Arknights  Zwillingstürme im Herbst OST - Der Hexenkönig",
      youtubeId: "r6IYN6X7-Dg",
    },
    {
      title: "Bloodborne Soundtrack OST - Ludwig, The Accursed & Holy Blade",
      youtubeId: "ALbVEmzY5S4",
    },
    {
      title: "Bloodborne Soundtrack OST - Lady Maria",
      youtubeId: "8mByDcrNSV0",
    },
    {
      title: "TES V Skyrim Soundtrack - Steel on Steel",
      youtubeId: "X7PDqUbcgeU",
    },
    {
      title: "Gwyn, Lord of Cinder - Motoi Sakuraba",
      youtubeId: "3bqLGebDRIY",
    },
  ],
  mystery: [
    {
      title: "Devilish Mystery - Jigoku No Sata Mo Kaneshidai",
      youtubeId: "Y-KcnrEK9p0",
    },
    {
      title: "Playful Mystery - Kuchinawa",
      youtubeId: "bbeDCFxHyFU",
    },
    {
      title: "Skyrim - Beneath the Ice",
      youtubeId: "apEe9-o5DXI",
    },
  ],
  rest: [
    {
      title: "Starlit Meadow",
      youtubeId: "AmNfNoPtsaI",
    },
    {
      title: "Bloodborne Soundtrack OST - Dream Refuge",
      youtubeId: "NQJIbdg_SQc",
    },
  ],
};

export const SFX_TRACKS: SfxTrack[] = [
  {
    id: "rain",
    label: "Rain",
    src: "/audio/rain.mp3",
    categorySrc: {
      tavern: "/audio/rain-muffled.mp3",
      rest: "/audio/rain-muffled.mp3",
    },
  },
  { id: "fire", label: "Fire", src: "/audio/crackling-fire.mp3" },
  { id: "wind", label: "Wind", src: "/audio/wind.mp3" },
  { id: "swords", label: "Swords", src: "/audio/sword-clash.mp3" },
];
