// Crew names for workers that have no configured name. Deterministic: the same seed (project | role | slot) always
// yields the same person, so a project's "second backend worker" is the same name on every run without storing
// anything. Unique among live agents (probes forward past names in use).

const CREW = [
  "Nora", "Jules", "Mina", "Theo", "Ines", "Kai", "Lena", "Omar", "Zoe", "Hugo", "Aiko", "Mateo", "Freya", "Ravi", "Iris",
  "Noor", "Felix", "Yara", "Bram", "Esme", "Tariq", "Lucia", "Soren", "Amara", "Nico", "Petra", "Idris", "Maeve", "Kofi",
  "Hana", "Anders", "Selma", "Rafa", "Elin", "Dario", "Mei", "Tomas", "Ayla", "Callum", "Rosa", "Jonas", "Leila", "Arlo",
  "Sunny", "Emeka", "Greta", "Pablo", "Wren", "Cato", "Dara", "Milo", "Ilse", "Nadia", "Oskar", "Talia", "Vik", "Bea",
  "Cyrus", "Fern", "Gus", "Halle", "Ivo", "Juno", "Kian", "Lior", "Maren", "Niko", "Odette", "Pia", "Quill", "Remy",
  "Saoirse", "Tove", "Ugo", "Vera", "Wes", "Xiu", "Yusuf", "Zara", "Abel", "Brisa", "Cleo", "Dov", "Ember", "Finn",
  "Gia", "Hiro", "Ida", "Jory", "Kira", "Lev", "Moss", "Nell",
] as const;

/** FNV-1a, 32-bit: stable across runs and platforms. */
const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };

/** The crew member for `seed`, skipping names in `taken`. */
export function crewName(seed: string, taken: ReadonlySet<string>): string {
  const start = fnv(seed) % CREW.length;
  for (let n = 0; n < CREW.length; n++) {
    const c = CREW[(start + n) % CREW.length];
    if (!taken.has(c)) return c;
  }
  return `${CREW[start]} ${taken.size}`; // shortcut: pool exhausted; unreachable under the 64-desk cap, upgrade if the cap is raised
}

export const CREW_SIZE = CREW.length;
