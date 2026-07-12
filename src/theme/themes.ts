import type { ThemeId } from '../types';

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  emoji: string;
  // Player-facing dress-code blurb (daily-cards-spec § "Theme reference"),
  // shown on the locked-day preview (the tease is the dress code, not just the
  // name) and available to the theme switcher for richness. Copy verbatim from
  // the spec table — do not paraphrase. #206 adds the two new tutorial-theme
  // entries (welcome-aboard / so-long-farewell) with their own descriptions.
  description: string;
}

// The eight Atlantis party themes, surfaced in the theme switcher. Descriptions
// are copied verbatim from daily-cards-spec § "Theme reference".
export const THEMES: ThemeMeta[] = [
  {
    id: 'neon-playground',
    label: 'Neon Playground',
    emoji: '🌈',
    description:
      'Fast, flashy, bright, and silly. Neon, sparkles, and lights for a laser-lit night in the Red Room.',
  },
  {
    id: 'get-sporty',
    label: 'Get Sporty',
    emoji: '🏋️',
    description:
      'Locker-room fantasy, varsity realness, cheer-captain glam—sporty looks that leave very little to the imagination.',
  },
  {
    id: 'duty-free',
    label: 'Duty Free',
    emoji: '✈️',
    description:
      'No borders, no limits, no VAT. National colors, flags, or whatever you find in Duty Free.',
  },
  {
    id: 'glamiators',
    label: 'Glamiators',
    emoji: '🏛️',
    description:
      'Roman toga-chic meets runway excess. Ancient fantasy, body armor, and spectator/judge looks welcome.',
  },
  {
    id: 'summer-white',
    label: 'Summer White',
    emoji: '🤍',
    description:
      "Atlantis's pinnacle party. Dress up or down in white for a sexy, creative, irreverent night under the stars.",
  },
  {
    id: 'dog-tag',
    label: 'Dog Tag T-Dance',
    emoji: '🪖',
    description:
      'The longest-running signature party, inspired by men in small uniforms. Souvenir dog tags provided.',
  },
  {
    id: 'revival-disco',
    label: 'Revival Disco',
    emoji: '🪩',
    description:
      "A '70s disco afternoon—artificial fabrics, facial hair, oversized shoes, obnoxious accessories.",
  },
  {
    id: 'seriously-pink',
    label: 'Seriously Pink',
    emoji: '💖',
    description:
      'A hot afternoon of pink silliness, Barbie energy, and frivolous dolled-up fun.',
  },
];
