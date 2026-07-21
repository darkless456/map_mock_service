export type MapEditProfile = 'split' | 'merge';

const DEFAULT_MAP_EDIT_PROFILE: MapEditProfile = 'split';

export function resolveMapEditProfile(
  value = process.env.MAP_EDIT_PROFILE,
): MapEditProfile {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return DEFAULT_MAP_EDIT_PROFILE;
  if (normalized === 'split' || normalized === 'merge') return normalized;
  throw new Error(
    `Unsupported MAP_EDIT_PROFILE "${value}"; expected "split" or "merge"`,
  );
}

export function mapListFixturePath(profile: MapEditProfile): string {
  return profile === 'merge'
    ? 'maps/profiles/merge/map_list.json'
    : 'maps/map_list.json';
}

export function semanticAssetPath(profile: MapEditProfile): string {
  return profile === 'merge'
    ? 'maps/profiles/merge/full_semanticmap.png'
    : 'maps/assets/full_semanticmap.png';
}

export function realsceneAssetPath(profile: MapEditProfile): string {
  return profile === 'merge'
    ? 'maps/profiles/merge/full_rgbmap.png'
    : 'maps/assets/full_rgbmap.png';
}
