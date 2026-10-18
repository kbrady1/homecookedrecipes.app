// Recently viewed recipes. Stored only in this browser.

const KEY = "homecooked.recentlyViewed";
const MAX_RECIPES = 20;

export function recentlyViewed() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(value) ? value.filter((summary) => summary && typeof summary.id === "string") : [];
  } catch {
    return [];
  }
}

export function recordView(summary) {
  const recipes = [summary, ...recentlyViewed().filter((recent) => recent.id !== summary.id)].slice(0, MAX_RECIPES);
  try {
    localStorage.setItem(KEY, JSON.stringify(recipes));
  } catch {
    // Storage is unavailable (private mode or blocked). The home screen shows no recent recipes.
  }
}
