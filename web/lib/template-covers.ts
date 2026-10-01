/// Each template's cover: card art, like a book cover, in one paper-cut style. `ground` is the flat
/// colour of the cover's calm lower third, which the card carries on below the picture; `alt`
/// describes the picture for the image sitemap and screen readers.
export type Cover = { ground: string; alt: string };

export const COVERS: Record<string, Cover> = {
  "habit-tracker": { ground: "#92a36f", alt: "Paper-cut running shoes and a glass of water at the foot of a winding hill path" },
  "meeting-notes": { ground: "#ec7751", alt: "Paper-cut meeting table from above, with coffee cups, sticky notes and a notebook" },
  "daily-standup": { ground: "#9783ba", alt: "Paper-cut desk in the morning, with a coffee mug, a closed laptop and a wall clock" },
  "meal-plan": { ground: "#fbb433", alt: "Paper-cut shopping basket with bread, greens, tomatoes and a lemon" },
  "reading-list": { ground: "#3f5c86", alt: "Paper-cut stack of books under a warm desk lamp, beside a trailing plant" },
  "mood-energy-log": { ground: "#2f7572", alt: "Paper-cut evening window with a crescent moon, a setting sun over hills and a plant" },
  "job-hunt": { ground: "#69b5e9", alt: "Paper-cut briefcase with a paper airplane flying toward the sun" },
  "trip-plan": { ground: "#2e5339", alt: "Paper-cut suitcase, folded map and straw hat in front of pine-covered mountains" },
  "study-flashcards": { ground: "#f69261", alt: "Paper-cut stack of flashcards with a pencil, an apple and a small cactus" },
  "decision-log": { ground: "#754024", alt: "Paper-cut signpost where a path splits in two, with a compass in the grass at dusk" },
  "workout-log": { ground: "#5b5f27", alt: "Paper-cut kettlebell, dumbbells, jump rope, water bottle and towel seen from above" },
  "budget-log": { ground: "#5b5651", alt: "Paper-cut piggy bank with stacks of coins, a wallet and a receipt" },
  "one-on-one-notes": { ground: "#2e346d", alt: "Paper-cut armchairs on either side of a small table with two mugs, under a floor lamp" },
  "book-notes": { ground: "#b13053", alt: "Paper-cut open book with page flags, reading glasses and a pencil" },
  "bug-triage": { ground: "#e9a82a", alt: "Paper-cut ladybird on a leaf beside a magnifying glass and a toolbox" },
  "weekly-review": { ground: "#e5837f", alt: "Paper-cut lake at sunrise with a journal and a mug of tea on a wooden jetty" },
  "recipe-box": { ground: "#2b5ba1", alt: "Paper-cut recipe box with a whisk, a mixing bowl, herbs and eggs" },
  "content-calendar": { ground: "#7a171f", alt: "Paper-cut pinboard of cards joined by red string, with a camera and a coffee cup" },
  "home-maintenance": { ground: "#e4ba8b", alt: "Paper-cut house with a wrench, a paint roller, a step ladder and a toolbox" },
  "gift-ideas": { ground: "#7cbf91", alt: "Paper-cut wrapped gift boxes with ribbons, a gift tag and confetti" },
};

export const coverPath = (slug: string) => `/templates/covers/${slug}.webp`;

/// Ink or cream for words on a cover's ground, whichever reads better.
export function inkOn(hex: string): "dark" | "light" {
  const lum = (h: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  return contrast(hex, INK) >= contrast(hex, CREAM) ? "dark" : "light";
}
export const INK = "#2a1d10";
export const CREAM = "#fff4e6";
