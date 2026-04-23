export interface Song {
  title: string;
  src: string;
}

export interface SfxTrack {
  id: string;
  label: string;
  src: string;
  categorySrc?: Partial<Record<CategoryKey, string>>;
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
    { title: 'The Wandering Bard',    src: '/audio/tavern_01.mp3' },
    { title: 'Hearth & Mead',         src: '/audio/tavern_02.mp3' },
    { title: 'Merchant Quarter',      src: '/audio/tavern_03.mp3' },
  ],
  adventure: [
    { title: 'Road to the Unknown',   src: '/audio/traveling_01.mp3' },
    { title: 'Through the Valley',    src: '/audio/traveling_02.mp3' },
    { title: 'Open Horizon',          src: '/audio/traveling_03.mp3' },
  ],
  combat: [
    { title: 'Limbus Company OST - Canto IX Boss 1 Battle Theme 2', src: '/audio/combat_01.mp3' },
    { title: 'No Mercy',              src: '' },
    { title: 'Final Stand',           src: '' },
  ],
  mystery: [
    { title: 'Devilish Mystery - Jigoku No Sata Mo Kaneshidai',  src: '/audio/mystery_01.mp3' },
    { title: 'Intense Mystery - Kizuna',  src: '/audio/mystery_02.mp3' },
    { title: 'Playful Mystery - Kuchinawa',    src: '/audio/mystery_03.mp3' },
  ],
  rest: [
    { title: 'Starlit Meadow',        src: '' },
    { title: 'Embers & Dreams',       src: '' },
    { title: 'Gentle Rain',           src: '' },
  ],
};

export const SFX_TRACKS: SfxTrack[] = [
  {
    id: 'rain', label: 'Rain', src: '/audio/rain.mp3', categorySrc: {
      tavern: '/audio/rain-muffled.mp3',
      rest: '/audio/rain-muffled.mp3',
    }
  },
  { id: 'fire',   label: 'Fire',   src: '/audio/crackling-fire.mp3' },
  { id: 'wind',   label: 'Wind',   src: '/audio/wind.mp3' },
  { id: 'crowd',  label: 'Crowd',  src: '' },
  { id: 'forest', label: 'Forest', src: '' },
  { id: 'ocean',  label: 'Ocean',  src: '' },
  { id: 'swords', label: 'Swords', src: '/audio/sword-clash.mp3' },
];
