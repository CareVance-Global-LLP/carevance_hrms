export const ROLE_COLORS: Record<string, {
  border: string;
  bg: string;
  avatar: string;
  badge: string;
  hex: string;
  label: string;
}> = {
  rose:    { border: 'border-rose-300',    bg: 'bg-rose-50',    avatar: 'bg-rose-100 text-rose-700',    badge: 'text-rose-700',    hex: '#F43F5E', label: 'Rose' },
  orange:  { border: 'border-orange-300',  bg: 'bg-orange-50',  avatar: 'bg-orange-100 text-orange-700',  badge: 'text-orange-700',  hex: '#F97316', label: 'Orange' },
  amber:   { border: 'border-amber-300',   bg: 'bg-amber-50',   avatar: 'bg-amber-100 text-amber-700',   badge: 'text-amber-700',   hex: '#F59E0B', label: 'Amber' },
  lime:    { border: 'border-lime-300',    bg: 'bg-lime-50',    avatar: 'bg-lime-100 text-lime-700',     badge: 'text-lime-700',    hex: '#84CC16', label: 'Lime' },
  emerald: { border: 'border-emerald-300', bg: 'bg-emerald-50', avatar: 'bg-emerald-100 text-emerald-700', badge: 'text-emerald-700', hex: '#10B981', label: 'Emerald' },
  teal:    { border: 'border-teal-300',    bg: 'bg-teal-50',    avatar: 'bg-teal-100 text-teal-700',     badge: 'text-teal-700',    hex: '#14B8A6', label: 'Teal' },
  sky:     { border: 'border-sky-300',     bg: 'bg-sky-50',     avatar: 'bg-sky-100 text-sky-700',       badge: 'text-sky-700',     hex: '#0EA5E9', label: 'Sky' },
  blue:    { border: 'border-blue-300',    bg: 'bg-blue-50',    avatar: 'bg-blue-100 text-blue-700',     badge: 'text-blue-700',    hex: '#3B82F6', label: 'Blue' },
  indigo:  { border: 'border-indigo-300',  bg: 'bg-indigo-50',  avatar: 'bg-indigo-100 text-indigo-700', badge: 'text-indigo-700',  hex: '#6366F1', label: 'Indigo' },
  violet:  { border: 'border-violet-300',  bg: 'bg-violet-50',  avatar: 'bg-violet-100 text-violet-700', badge: 'text-violet-700',  hex: '#8B5CF6', label: 'Violet' },
  purple:  { border: 'border-purple-300',  bg: 'bg-purple-50',  avatar: 'bg-purple-100 text-purple-700', badge: 'text-purple-700',  hex: '#A855F7', label: 'Purple' },
  fuchsia: { border: 'border-fuchsia-300', bg: 'bg-fuchsia-50', avatar: 'bg-fuchsia-100 text-fuchsia-700', badge: 'text-fuchsia-700', hex: '#D946EF', label: 'Fuchsia' },
  pink:    { border: 'border-pink-300',    bg: 'bg-pink-50',    avatar: 'bg-pink-100 text-pink-700',     badge: 'text-pink-700',    hex: '#EC4899', label: 'Pink' },
  slate:   { border: 'border-slate-300',   bg: 'bg-slate-50',   avatar: 'bg-slate-100 text-slate-700',   badge: 'text-slate-700',   hex: '#64748B', label: 'Slate' },
};

// Get color for a role
export const getRoleColor = (colorName: string | null | undefined, hierarchyLevel?: number) => {
  // Use the stored color, unless it's the 'slate' placeholder (meaning "unset")
  if (colorName && colorName !== 'slate' && ROLE_COLORS[colorName]) {
    return ROLE_COLORS[colorName];
  }

  // Fallback: derive from hierarchy level
  if (hierarchyLevel != null) {
    return ROLE_COLORS[defaultColorForLevel(hierarchyLevel)] ?? ROLE_COLORS.slate;
  }

  return ROLE_COLORS.slate;
};

// Mirror of backend Role::defaultColorForLevel — auto-assign by level (cycles over 13 colors)
export const defaultColorForLevel = (level: number): string => {
  const palette: Record<number, string> = {
    1: 'rose', 2: 'pink', 3: 'fuchsia', 4: 'purple', 5: 'violet',
    6: 'indigo', 7: 'blue', 8: 'sky', 9: 'teal', 10: 'emerald',
    11: 'lime', 12: 'amber', 13: 'orange',
  };
  const idx = ((level - 1) % 13 + 13) % 13 + 1; // handles negatives
  return palette[idx] ?? 'slate';
};
