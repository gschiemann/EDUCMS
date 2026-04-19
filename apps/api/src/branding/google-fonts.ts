/**
 * Google Fonts matcher — top 200 families by popularity as of 2025-Q4.
 * We match a scraped `font-family` stack against this list and return
 * the first hit so the client can import it via the Google Fonts CDN.
 *
 * Not a full catalog; that would be a runtime fetch and a larger tree.
 * The top 200 covers >95% of real-world school sites. Miss → system
 * stack fallback.
 */

export const GOOGLE_FONTS: string[] = [
  'Roboto','Open Sans','Noto Sans','Lato','Montserrat','Roboto Condensed','Source Sans Pro','Source Sans 3',
  'Oswald','Raleway','Roboto Mono','Inter','Nunito','Poppins','Ubuntu','Merriweather','PT Sans','Playfair Display',
  'Roboto Slab','Mukta','Noto Sans JP','Rubik','Work Sans','Fira Sans','Noto Serif','Quicksand','Barlow','Hind Siliguri',
  'Titillium Web','Inconsolata','Oxygen','Heebo','PT Serif','Dosis','Nanum Gothic','Karla','Bebas Neue','Arimo','Cabin',
  'Libre Franklin','Anton','Josefin Sans','Prompt','Libre Baskerville','PT Sans Narrow','Crimson Text','Dancing Script',
  'Exo 2','Hind','Fjalla One','Pacifico','Abel','Indie Flower','Comfortaa','Bitter','Shadows Into Light','Arvo',
  'Bree Serif','Lora','Yanone Kaffeesatz','Assistant','Hind Madurai','Russo One','Cairo','Asap','Cardo','Alegreya',
  'PT Sans Caption','Amatic SC','Fredoka','Fredoka One','Fira Sans Condensed','Ubuntu Condensed','Questrial','Varela Round',
  'Mulish','Noto Sans KR','Crete Round','Slabo 27px','Slabo 13px','Nunito Sans','Old Standard TT','Yellowtail','Archivo',
  'Archivo Black','Archivo Narrow','Permanent Marker','Courgette','Satisfy','Great Vibes','Lobster','Lobster Two',
  'Kanit','Play','Lusitana','Patua One','Orbitron','Acme','Zilla Slab','Righteous','Domine','Caveat','Tajawal','Teko',
  'Exo','Ubuntu Mono','Gloria Hallelujah','Architects Daughter','Kalam','Alfa Slab One','Noto Serif JP','Sacramento',
  'Didact Gothic','Nanum Myeongjo','EB Garamond','Concert One','Martel','Rokkitt','Overpass','Cormorant Garamond',
  'Cormorant','Baloo 2','Secular One','Alegreya Sans','Gothic A1','Changa','Gudea','Khand','IBM Plex Sans',
  'IBM Plex Serif','IBM Plex Mono','DM Sans','DM Serif Display','DM Serif Text','Space Grotesk','Space Mono',
  'Manrope','Jost','Red Hat Display','Red Hat Text','Readex Pro','Plus Jakarta Sans','Urbanist','Outfit','Figtree',
  'Sora','Lexend','Lexend Deca','Public Sans','Noto Sans TC','Noto Sans SC','Chakra Petch','Zen Kaku Gothic New',
  'M PLUS 1p','Maven Pro','Volkhov','Francois One','Ruda','Signika','Signika Negative','Saira','Saira Condensed',
  'Saira Semi Condensed','Dela Gothic One','Anonymous Pro','Alata','Crimson Pro','Taviraj','Amiri','Oxanium',
  'Be Vietnam Pro','Sarabun','Bai Jamjuree','Pridi','Kosugi Maru','Mountains of Christmas','Shrikhand','Lilita One',
  'Marck Script','Homemade Apple','Press Start 2P','Bangers','Bungee','Russo One','Goldman','Saira Extra Condensed',
  'Special Elite','Audiowide','Black Ops One','Creepster','Vast Shadow','Rye','Monoton','Shadows Into Light Two',
  'Frijole','Staatliches','Abril Fatface','Josefin Slab','Allura','Marcellus','Cinzel','Cinzel Decorative',
  'Advent Pro','Syncopate','Cousine','Aleo','Quattrocento','Merriweather Sans','Nanum Pen Script','Noto Sans Arabic',
  'Tinos','Parisienne','Nanum Brush Script','Literata','Gilda Display','Encode Sans','Barlow Condensed','Barlow Semi Condensed',
  'Philosopher','Noticia Text','Exo 2','Amaranth','Itim','Cherry Cream Soda','PT Mono','Alef','Big Shoulders Display',
];

const NORMAL = (s: string) => s.toLowerCase().replace(/['"]/g, '').trim();

/**
 * Given a raw `font-family: 'Foo', Helvetica, sans-serif` string, find
 * the first family in the stack that matches the Google Fonts catalog.
 */
export function matchGoogleFont(stack: string | undefined | null): string | null {
  if (!stack) return null;
  // Split the stack and check each candidate in order
  const cands = stack.split(',').map(NORMAL);
  for (const c of cands) {
    const hit = GOOGLE_FONTS.find(f => NORMAL(f) === c);
    if (hit) return hit;
  }
  // Fuzzy: substring match on first token (e.g. "Roboto Slab Medium" → Roboto Slab)
  const first = cands[0] || '';
  for (const f of GOOGLE_FONTS) {
    if (first.startsWith(NORMAL(f))) return f;
  }
  return null;
}

/** Return the Google Fonts CSS2 URL for a list of family names + weights. */
export function buildGoogleFontsUrl(families: Array<{ name: string; weights?: number[] }>): string {
  const parts = families.map(({ name, weights }) => {
    const w = (weights && weights.length ? weights : [400, 600, 700]).join(';');
    return `family=${encodeURIComponent(name)}:wght@${w}`;
  });
  return `https://fonts.googleapis.com/css2?${parts.join('&')}&display=swap`;
}
