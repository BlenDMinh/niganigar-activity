export interface Song {
  title: string;
  src: string;
}

export interface SfxTrack {
  id: string;
  label: string;
  src: string;
}

export const CATEGORY_KEYS = ['tavern', 'adventure', 'combat', 'mystery', 'rest'] as const;
export type CategoryKey = typeof CATEGORY_KEYS[number];

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  tavern:    'Tavern',
  adventure: 'Adventure',
  combat:    'Combat',
  mystery:   'Mystery',
  rest:      'Rest',
};

export const MUSIC_CATEGORIES: Record<CategoryKey, Song[]> = {
  tavern: [
    { title: 'The Wandering Bard',    src: '' },
    { title: 'Hearth & Mead',         src: '' },
    { title: 'Merchant Quarter',      src: '' },
  ],
  adventure: [
    { title: 'Road to the Unknown',   src: '' },
    { title: 'Through the Valley',    src: '' },
    { title: 'Open Horizon',          src: '' },
  ],
  combat: [
    { title: 'Limbus Company OST - Canto IX Boss 1 Battle Theme 2', src: '/audio/combat_01.mp3' },
    { title: 'No Mercy',              src: '' },
    { title: 'Final Stand',           src: '' },
  ],
  mystery: [
    { title: 'Secrets of the Vault',  src: '' },
    { title: 'Whispers in the Dark',  src: '' },
    { title: 'The Hidden Chamber',    src: '' },
  ],
  rest: [
    { title: 'Starlit Meadow',        src: '' },
    { title: 'Embers & Dreams',       src: '' },
    { title: 'Gentle Rain',           src: '' },
  ],
};

export const SFX_TRACKS: SfxTrack[] = [
  { id: 'rain',   label: 'Rain',   src: '' },
  { id: 'fire',   label: 'Fire',   src: '' },
  { id: 'wind',   label: 'Wind',   src: '' },
  { id: 'crowd',  label: 'Crowd',  src: '' },
  { id: 'forest', label: 'Forest', src: '' },
  { id: 'ocean',  label: 'Ocean',  src: '' },
  { id: 'swords', label: 'Swords', src: '' },
];
