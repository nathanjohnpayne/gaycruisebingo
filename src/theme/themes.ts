import type { ThemeId } from '../types';

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  emoji: string;
}

// The eight Atlantis party themes, surfaced in the theme switcher.
export const THEMES: ThemeMeta[] = [
  { id: 'neon-playground', label: 'Neon Playground', emoji: '🌈' },
  { id: 'get-sporty', label: 'Get Sporty', emoji: '🏋️' },
  { id: 'duty-free', label: 'Duty Free', emoji: '✈️' },
  { id: 'glamiators', label: 'Glamiators', emoji: '🏛️' },
  { id: 'summer-white', label: 'Summer White', emoji: '🤍' },
  { id: 'dog-tag', label: 'Dog Tag T-Dance', emoji: '🪖' },
  { id: 'revival-disco', label: 'Revival Disco', emoji: '🪩' },
  { id: 'seriously-pink', label: 'Seriously Pink', emoji: '💖' },
];
