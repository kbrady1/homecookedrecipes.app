// Read-only, signed-out client for the HomeCooked API.
// The API returns only public recipes to callers without an `Authorization` header.

import { parseRecipe, viaCloudfront } from "./recipe.js";

const baseUrl = window.HC_CONFIG.apiBaseUrl;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function get(path, query = {}) {
  const url = new URL(`${baseUrl}/${path.map(encodeURIComponent).join("/")}`, location.href);
  Object.entries(query).forEach(([key, value]) => {
    if (value != null) url.searchParams.set(key, value);
  });

  let response;
  try {
    response = await fetch(url);
  } catch {
    throw new ApiError(0, "No Internet Connection");
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, body?.readable_message || "An Error Occurred");
  }
  return body;
}

// The search index: a compact entry for every public recipe. The backend keeps it up to date (see search_index.py).
// Returns recipe summaries, the shape that recipe rows and cards show, plus the description for matching.
export async function getSearchIndex() {
  const body = await get(["recipes", "search_index"]);
  return (body?.recipes || [])
    .filter((entry) => typeof entry?.id === "string" && typeof entry.title === "string" && entry.title.trim())
    .map((entry) => ({
      id: entry.id,
      title: entry.title.trim(),
      description: typeof entry.desc === "string" ? entry.desc : "",
      thumbnailUrl: viaCloudfront(entry.thumbnail_url),
      minutes: Number(entry.minutes) || 0,
      ingredientCount: Number(entry.ingredient_count) || 0,
      tags: Array.isArray(entry.tags) ? entry.tags.filter((tag) => typeof tag === "string") : [],
      creatorName: typeof entry.creator_name === "string" ? entry.creator_name : null,
      type: typeof entry.type === "string" ? entry.type : null,
    }));
}

// Port of `Client.getRecipe(byId:)`.
export async function getRecipe(id) {
  return parseRecipe(await get(["recipes", id]));
}
