// HomeCooked website: public recipe search and the recipe page.
// Signed-in features (saving, favorites, Cook Mode) open the "Get the app" sheet.

import { ApiError, getRecipe, getSearchIndex } from "./api.js";
import { h, icon, recipeImage } from "./dom.js";
import { recentlyViewed, recordView } from "./recent.js";
import {
  durationLabel,
  formattedIngredientAmount,
  ingredientLabel,
  instructionIngredientNames,
  saveCountLabel,
  tagNames,
  toStructuredData,
  toSummary,
  totalMinutes,
} from "./recipe.js";

const app = document.getElementById("app");
const MIN_SEARCH_LENGTH = 2;
const MAX_SEARCH_RESULTS = 50;

// MARK: Routing
// Routes: / (home) and /recipe/<id> (recipe). Search is a dropdown in the header, not a page.
// Each recipe has its own URL so that search engines index it. GitHub Pages has no page at /recipe/<id>;
// the site's Cloudflare Worker (site-worker/) serves index.html there, with that recipe's link preview tags.

const RECIPE_PATH = /^\/recipe\/([^/]+)\/?$/;

function currentRoute() {
  const match = location.pathname.match(RECIPE_PATH);
  if (match) return { name: "recipe", id: decodeURIComponent(match[1]) };
  return { name: "home" };
}

const homeHref = "/";
const recipeHref = (id) => `/recipe/${encodeURIComponent(id)}`;
const isSitePath = (pathname) => pathname === "/" || RECIPE_PATH.test(pathname);

// Entries that the site pushes carry { inApp: true }, so the back button knows that history.back() stays in the site.
function navigate(href, { replace = false } = {}) {
  history[replace ? "replaceState" : "pushState"]({ inApp: true }, "", href);
  render();
}

function goBack() {
  if (history.state?.inApp) history.back();
  else navigate(homeHref, { replace: true });
}

// Links inside the site change pages without a reload. Modified clicks (new tab, and so on) keep the browser default.
document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link || link.target || event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (link.origin !== location.origin || !isSitePath(link.pathname)) return;
  event.preventDefault();
  if (searchPanel.contains(link)) clearSearchField();
  closeSearchPanel();
  navigate(link.href);
});

window.addEventListener("popstate", render);

// Earlier versions used #/ routes, a ?q= search page, and ?recipe=<id> recipe URLs. People also type
// /recipes/<id>, the API's path. Move those links to the current URLs. Returns the search query from an old link, if any.
const PLURAL_RECIPE_PATH = /^\/recipes\/([^/]+)\/?$/;

function redirectOldRoute() {
  const [path, queryString] = location.hash.slice(1).split("?");
  const parts = path.split("/").filter(Boolean);
  const params = new URLSearchParams(location.search);
  const oldQuery = parts[0] === "search" ? new URLSearchParams(queryString).get("q") : params.get("q");
  const plural = location.pathname.match(PLURAL_RECIPE_PATH);
  if (plural) history.replaceState(null, "", recipeHref(decodeURIComponent(plural[1])));
  else if (parts[0] === "recipe" && parts[1]) history.replaceState(null, "", recipeHref(decodeURIComponent(parts[1])));
  else if (params.get("recipe")) history.replaceState(null, "", recipeHref(params.get("recipe")));
  else if (location.hash.startsWith("#/") || oldQuery != null) history.replaceState(null, "", homeHref);
  return oldQuery || "";
}

function render() {
  const route = currentRoute();
  document.body.dataset.page = route.name;
  setRecipeHead(null);

  if (route.name === "recipe") renderRecipePage(route.id);
  else renderHomePage();
}

// MARK: Get the app sheet

const GET_APP_MESSAGES = {
  app: ["Get HomeCooked", "Save your own recipes, collect recipes from friends, and cook hands-free on iPhone and iPad."],
  cook: ["Cook Mode is in the app", "Follow each step hands-free with hand gestures, scale servings, and keep your screen awake while you cook."],
  save: ["Save recipes in the app", "Download HomeCooked to save this recipe to your collection and find it again anytime."],
  favorite: ["Favorite recipes in the app", "Download HomeCooked to favorite this recipe and organize your collection with tags."],
};

function showGetApp(feature) {
  const [title, message] = GET_APP_MESSAGES[feature];
  document.getElementById("get-app-title").textContent = title;
  document.getElementById("get-app-message").textContent = message;
  document.getElementById("get-app").showModal();
}

// Clicking the dimmed area outside a sheet closes it.
document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});

// MARK: Toast

let toastTimer;
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2500);
}

// MARK: Shared components

// Port of `Color.chipColors`. The app picks a color from the tag's hash.
const CHIP_COLORS = ["BCCFDC", "BFDCBB", "DCD7BC", "BBDCD0", "BBBEDC", "DCBBDB", "DCBBBB", "DCCDBC"];

function hashString(value) {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.codePointAt(0)) | 0;
  return Math.abs(hash);
}

function tagChip(name) {
  const hex = CHIP_COLORS[hashString(name) % CHIP_COLORS.length];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  // Port of `TagChip.foregroundColor`: the background darkened to 40%.
  const foreground = `rgb(${r * 0.4} ${g * 0.4} ${b * 0.4})`;
  return h("span", { class: "tag-chip", style: { background: `#${hex}`, color: foreground } }, name);
}

function tagChips(names, max) {
  const shown = names.slice(0, max);
  const remaining = names.length - shown.length;
  return [shown.map(tagChip), remaining > 0 ? h("span", { class: "tag-more" }, `+${remaining}`) : null];
}

// Port of `RecipeCard`: the horizontal cards on the home screen.
function recipeCard(summary) {
  const minutes = durationLabel(summary.minutes);
  const ingredients = ingredientLabel(summary.ingredientCount);
  return h("a", { class: "recipe-card", href: recipeHref(summary.id) },
    h("div", { class: "recipe-card-image" },
      recipeImage(summary.thumbnailUrl, "recipe-card-photo"),
      minutes ? h("span", { class: "time-badge" }, icon("timer"), minutes) : null,
    ),
    h("div", { class: "recipe-card-title" }, summary.title),
    h("div", { class: "recipe-card-meta" },
      ingredients ? h("span", {}, ingredients) : null,
      ingredients && summary.tags.length ? h("b", {}, "·") : null,
      tagChips(summary.tags, 2),
    ),
  );
}

// Port of `RecipeRow` as search shows it, with the creator name.
function recipeRow(summary) {
  const minutes = durationLabel(summary.minutes);
  const meta = [
    summary.creatorName ? h("span", { class: "row-creator" }, summary.creatorName) : null,
    summary.ingredientCount > 0 ? h("span", { class: "row-stat" }, icon("carrot"), summary.ingredientCount) : null,
    minutes ? h("span", { class: "row-stat" }, icon("timer"), minutes) : null,
  ].filter(Boolean);

  return h("a", { class: "recipe-row", href: recipeHref(summary.id) },
    recipeImage(summary.thumbnailUrl, "recipe-row-photo"),
    h("div", { class: "recipe-row-body" },
      h("div", { class: "recipe-row-title" }, summary.title),
      meta.length ? h("div", { class: "recipe-row-meta" }, meta.flatMap((item, i) => (i ? [h("b", {}, "·"), item] : [item]))) : null,
      summary.tags.length ? h("div", { class: "recipe-row-tags" }, tagChips(summary.tags, 3)) : null,
    ),
  );
}

const errorMessage = (error) => (error instanceof ApiError ? error.message : "An Error Occurred");

const spinner = () => h("div", { class: "spinner", role: "progressbar", "aria-label": "Loading" });

// MARK: Site header
// A floating glass header on every page. Pages render below it in #app.

const searchInput = h("input", {
  type: "search",
  placeholder: "Search all recipes",
  "aria-label": "Search all recipes",
  role: "combobox",
  "aria-autocomplete": "list",
  "aria-expanded": "false",
  "aria-controls": "search-panel",
  autocomplete: "off",
  autocorrect: "off",
  autocapitalize: "off",
  spellcheck: "false",
  enterkeyhint: "search",
});
const clearButton = h("button", { class: "search-clear", type: "button", "aria-label": "Clear search", hidden: true }, icon("close"));
const searchPanel = h("div", { id: "search-panel", class: "search-panel glass-surface", role: "listbox", "aria-label": "Search results", hidden: true });

function siteHeader() {
  const searchBox = h("div", { class: "search-box" },
    h("form", { class: "search-bar", role: "search", onSubmit: (event) => event.preventDefault() },
      icon("search"), searchInput, clearButton,
    ),
  );

  searchInput.addEventListener("focus", openSearchPanel);
  searchInput.addEventListener("input", () => {
    clearButton.hidden = searchInput.value === "";
    openSearchPanel();
    runSearch(searchInput.value.trim());
  });
  searchInput.addEventListener("keydown", onSearchKeydown);
  clearButton.addEventListener("click", () => {
    clearSearchField();
    searchInput.focus();
  });
  // Pressing anywhere outside the search box and the panel closes the panel.
  document.addEventListener("pointerdown", (event) => {
    if (!searchBox.contains(event.target) && !searchPanel.contains(event.target)) closeSearchPanel();
  });

  return h("header", { class: "site-header glass-surface" },
    h("div", { class: "header-start" },
      h("button", { class: "header-back", type: "button", "aria-label": "Back", onClick: goBack }, icon("back")),
      h("a", { class: "brand", href: homeHref, "aria-label": "HomeCooked home" },
        h("img", { class: "brand-icon", src: "/assets/app-icon.png", alt: "", width: 34, height: 34 }),
        h("span", { class: "brand-name" }, "HomeCooked"),
      ),
    ),
    searchBox,
    h("button", { class: "header-button", type: "button", onClick: () => showGetApp("app") }, "Get the app"),
  );
}

function clearSearchField() {
  searchInput.value = "";
  clearButton.hidden = true;
  runSearch("");
}

// Keeps --header-bottom equal to the bottom edge of the floating header, so pages start below it.
function trackHeaderBottom(header) {
  const update = () => document.documentElement.style.setProperty("--header-bottom", `${header.getBoundingClientRect().bottom}px`);
  new ResizeObserver(update).observe(header);
  window.addEventListener("resize", update);
  update();
}

// MARK: Home page
// Promotes the app, and shows real community recipes from the search index.

const APP_STORE_URL = "https://apps.apple.com/app/id1526071006";

// Hand-picked public recipes for the hero, chosen for their photos. The photos are the full-size images.
// If one is deleted or made private, fillWithCommunityRecipes replaces its card with a community pick.
const HERO_RECIPES = [
  { id: "E3459863-1067-42E6-B8C5-D5F215CAB205", title: "Fish Tacos", photo: "https://dw2mlt0zbk1xq.cloudfront.net/E3459863-1067-42E6-B8C5-D5F215CAB205.jpeg" },
  { id: "A363EABA-B80C-4897-9B21-FE8B112D80E1", title: "Ratatouille", photo: "https://dw2mlt0zbk1xq.cloudfront.net/A363EABA-B80C-4897-9B21-FE8B112D80E1.jpeg" },
  { id: "180D7CF7-6558-4AF6-98DF-327356DA4822", title: "Greek Yogurt Pancakes", photo: "https://dw2mlt0zbk1xq.cloudfront.net/180D7CF7-6558-4AF6-98DF-327356DA4822.jpeg" },
];

// Photo for the "Recipes from a photo" feature card, and the recipe in the share card's link preview.
// Teriyaki Chicken (38A34A5A-…). Its photo has no source watermark.
const FEATURE_PHOTO = "https://dw2mlt0zbk1xq.cloudfront.net/38A34A5A-5CAC-4745-9597-1E98D2070BC0.jpeg";
const SHARE_PREVIEW = HERO_RECIPES[0];

function renderHomePage() {
  document.title = "HomeCooked";
  window.scrollTo(0, 0);

  const heroCards = h("div", { class: "hero-cards", "aria-hidden": "true" },
    HERO_RECIPES.map((recipe) => heroCard({ id: recipe.id, title: recipe.title, thumbnailUrl: recipe.photo })));
  const discoverCards = h("div", { class: "card-scroller" });
  const discover = h("section", { class: "home-section", hidden: true },
    h("div", { class: "section-heading" },
      h("h2", { class: "section-title" }, "Discover recipes"),
      h("p", { class: "section-subtitle" }, "Shared by cooks on HomeCooked."),
    ),
    discoverCards,
  );

  app.replaceChildren(h("div", { class: "page home" },
    heroSection(heroCards),
    recentSection(),
    featuresSection(),
    discover,
    closingSection(),
  ));
  fillWithCommunityRecipes(heroCards, discoverCards, discover);
}

function heroSection(heroCards) {
  return h("section", { class: "hero-promo" },
    h("div", { class: "hero-copy" },
      h("p", { class: "eyebrow" }, "HomeCooked for iPhone and iPad"),
      h("h1", {}, "Every recipe you love, in one home."),
      h("p", { class: "hero-lede" }, "Save recipes from any website, PDF, photo, or Instagram reel. HomeCooked turns them into clean, step-by-step recipes that you can cook hands-free and share with friends."),
      h("div", { class: "hero-actions" },
        h("a", { class: "store-button", href: APP_STORE_URL, target: "_blank", rel: "noopener" }, "Download on the App Store"),
        h("button", { class: "secondary-button", type: "button", onClick: () => searchInput.focus() }, icon("search"), "Search recipes"),
      ),
    ),
    heroCards,
  );
}

// A small tilted recipe card for the hero.
function heroCard(summary) {
  return h("a", { class: "hero-card", href: recipeHref(summary.id), tabindex: "-1" },
    recipeImage(summary.thumbnailUrl, "hero-card-photo"),
    h("div", { class: "hero-card-title" }, summary.title),
  );
}

// Recipes with photos, in an order that changes once a day. Everyone sees the same picks on the same day.
// Image and PDF recipes are scans of recipe cards, so their photos show text, not food.
function dailyPicks(entries) {
  const day = new Date().toISOString().slice(0, 10);
  return entries
    .filter((entry) => entry.thumbnailUrl && entry.type !== "image" && entry.type !== "pdf")
    .map((entry) => ({ entry, key: hashString(day + entry.id) }))
    .sort((a, b) => a.key - b.key)
    .map((pick) => pick.entry);
}

function fillWithCommunityRecipes(heroCards, discoverCards, discover) {
  loadSearchIndex()
    .then((index) => {
      const heroIds = new Set(HERO_RECIPES.map((recipe) => recipe.id));
      const picks = dailyPicks(index.map((item) => item.entry)).filter((entry) => !heroIds.has(entry.id));

      // A hero recipe that is no longer public gets a community pick in its place.
      const publicIds = new Set(index.map((item) => item.entry.id));
      const spare = picks.slice(12);
      HERO_RECIPES.forEach((recipe, position) => {
        if (!publicIds.has(recipe.id) && spare.length) heroCards.children[position]?.replaceWith(heroCard(spare.shift()));
      });

      discoverCards.replaceChildren(...picks.slice(0, 12).map(recipeCard));
      discover.hidden = picks.length === 0;
    })
    .catch(() => {}); // The page works without them. Search shows the error if the index cannot load.
}

function recentSection() {
  const recipes = recentlyViewed();
  if (recipes.length === 0) return null;
  return h("section", { class: "home-section" },
    h("div", { class: "section-heading" }, h("h2", { class: "section-title" }, "Recently viewed")),
    h("div", { class: "card-scroller" }, recipes.map(recipeCard)),
  );
}

function featuresSection() {
  const card = (name, iconName, title, text, ...extras) =>
    h("div", { class: `bento-card bento-${name}` },
      h("span", { class: "bento-icon" }, icon(iconName)),
      h("h3", {}, title),
      h("p", {}, text),
      extras,
    );

  return h("section", { class: "home-section" },
    h("div", { class: "section-heading" },
      h("h2", { class: "section-title" }, "Everything for your kitchen"),
      h("p", { class: "section-subtitle" }, "What you get with the HomeCooked app."),
    ),
    h("div", { class: "bento" },
      card("save", "link", "Save from anywhere",
        "Import recipes from websites, PDFs, photos, and Instagram reels, or write your own. Every recipe lives in one place.",
        h("div", { class: "bento-chips" }, ["Websites", "PDFs", "Photos", "Instagram reels", "Your own"].map((label) => h("span", {}, label)))),
      card("ai", "sparkles", "AI Superpowers",
        "Turn web pages, reels, and scanned recipe cards into step-by-step recipes, with the ingredients filled in."),
      h("div", { class: "bento-card bento-photo", style: { backgroundImage: `url("${FEATURE_PHOTO}")` } },
        h("span", { class: "bento-icon" }, icon("camera")),
        h("h3", {}, "Recipes from a photo"),
        h("p", {}, "Snap a dish. HomeCooked finds matching recipes, or writes one for you."),
      ),
      card("cook", "hand", "Hands-free Cook Mode",
        "No touching the screen with messy hands. Raise a hand and swipe through the air to change steps, or pinch to see the ingredients.",
        h("span", { class: "bento-badge" }, "Hand tracking"),
        h("div", { class: "cook-steps", "aria-hidden": "true" },
          h("span", { class: "cook-step-label" }, "Step 2 of 6"),
          h("span", { class: "cook-dots" }, [0, 1, 2, 3, 4, 5].map((i) => h("i", { class: i === 1 ? "active" : null }))),
        )),
      card("tags", "tag", "Tags and search",
        "Mark favorites, group recipes with your own tags, and find any recipe in seconds.",
        h("div", { class: "bento-tag-row", "aria-hidden": "true" }, ["Dinner", "Quick", "Vegetarian", "Baking", "Family favorites", "Date night"].map(tagChip))),
      card("share", "share", "Share with friends",
        "Send any recipe as a link. Friends open it in the app, or right here on the web.",
        h("div", { class: "link-preview", "aria-hidden": "true" },
          h("img", { src: SHARE_PREVIEW.photo, alt: "", loading: "lazy" }),
          h("span", {}, h("strong", {}, SHARE_PREVIEW.title), h("small", {}, "homecookedrecipes.app")),
        )),
    ),
  );
}

function closingSection() {
  return h("section", { class: "closing-cta" },
    h("img", { src: "/assets/app-icon.png", alt: "", width: 72, height: 72 }),
    h("h2", {}, "Bring your recipes home."),
    h("p", {}, "HomeCooked is free on the App Store for iPhone and iPad."),
    h("a", { class: "store-button", href: APP_STORE_URL, target: "_blank", rel: "noopener" }, "Download on the App Store"),
  );
}

// MARK: Search panel
// Search runs in the browser over the search index of public recipes. The index loads once, on first use.

const search = { query: null, results: [], loading: false, error: null };
let activeOption = -1;
let searchIndex = null; // The entries, once loaded.
let searchIndexRequest = null;

// Lowercase, without accents, so that "creme" matches "Crème".
const normalize = (text) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function loadSearchIndex() {
  searchIndexRequest ??= getSearchIndex()
    .then((entries) => {
      searchIndex = entries.map((entry) => ({
        entry,
        title: normalize(entry.title),
        tags: normalize(entry.tags.join(" ")),
        other: normalize(`${entry.description} ${entry.creatorName || ""}`),
      }));
      return searchIndex;
    })
    .catch((error) => {
      searchIndexRequest = null; // The next search tries again.
      throw error;
    });
  return searchIndexRequest;
}

// Every word must appear in the title, the tags, the description, or the creator. Title matches rank first.
function matchRecipes(index, query) {
  const phrase = normalize(query.trim());
  const words = phrase.split(/\s+/).filter(Boolean);
  const matches = [];
  for (const item of index) {
    if (!words.every((word) => item.title.includes(word) || item.tags.includes(word) || item.other.includes(word))) continue;
    const rank = item.title.startsWith(phrase) ? 0
      : item.title.includes(phrase) ? 1
        : words.every((word) => item.title.includes(word)) ? 2
          : words.some((word) => item.tags.includes(word)) ? 3
            : 4;
    matches.push({ entry: item.entry, rank });
  }
  matches.sort((a, b) => a.rank - b.rank || a.entry.title.localeCompare(b.entry.title));
  return matches.map((match) => match.entry);
}

async function runSearch(query) {
  // A newer search can start while an older one waits for the index. The older one then stops without rendering,
  // so every search resets the state it reads.
  Object.assign(search, { query, results: [], loading: false, error: null });
  if (query.length < MIN_SEARCH_LENGTH) {
    renderSearchResults();
    return;
  }
  if (searchIndex) {
    search.results = matchRecipes(searchIndex, query);
    renderSearchResults();
    return;
  }

  search.loading = true;
  renderSearchResults();
  try {
    const index = await loadSearchIndex();
    if (search.query === query) search.results = matchRecipes(index, query);
  } catch (error) {
    if (search.query === query) search.error = error;
  }
  if (search.query !== query) return; // A newer search already rendered.
  search.loading = false;
  renderSearchResults();
}

function openSearchPanel() {
  // Start loading the index now, so that results are ready by the time the person has typed a word.
  loadSearchIndex().catch(() => {});
  if (search.query !== searchInput.value.trim()) runSearch(searchInput.value.trim());
  else renderSearchResults();
  positionSearchPanel();
  searchPanel.hidden = false;
  searchInput.setAttribute("aria-expanded", "true");
}

// The panel is a sibling of the header, not a child. A blur inside the header could only blur the header,
// so the page would show through sharp. On phones the panel spans the header. On wider screens it spans the search bar.
function positionSearchPanel() {
  const anchor = window.matchMedia("(max-width: 699px)").matches
    ? header
    : searchInput.closest(".search-box");
  const rect = anchor.getBoundingClientRect();
  searchPanel.style.left = `${rect.left}px`;
  searchPanel.style.width = `${rect.width}px`;
}

window.addEventListener("resize", () => {
  if (!searchPanel.hidden) positionSearchPanel();
});

function closeSearchPanel() {
  searchPanel.hidden = true;
  searchInput.setAttribute("aria-expanded", "false");
  setActiveOption(-1);
}

function onSearchKeydown(event) {
  const options = [...searchPanel.querySelectorAll('[role="option"]')];
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (searchPanel.hidden) openSearchPanel();
    if (options.length === 0) return;
    const step = event.key === "ArrowDown" ? 1 : -1;
    setActiveOption((activeOption + step + options.length) % options.length);
  } else if (event.key === "Enter") {
    event.preventDefault();
    const option = options[activeOption] || (options.length === 1 ? options[0] : null);
    if (option) {
      clearSearchField();
      closeSearchPanel();
      searchInput.blur();
      navigate(option.href);
    }
  } else if (event.key === "Escape") {
    if (!searchPanel.hidden) closeSearchPanel();
    else searchInput.blur();
  }
}

function setActiveOption(index) {
  const options = [...searchPanel.querySelectorAll('[role="option"]')];
  activeOption = index;
  options.forEach((option, i) => option.setAttribute("aria-selected", String(i === index)));
  if (options[index]) {
    searchInput.setAttribute("aria-activedescendant", options[index].id);
    options[index].scrollIntoView({ block: "nearest" });
  } else {
    searchInput.removeAttribute("aria-activedescendant");
  }
}

// One row in the panel. Each row is a link, so it also works with a middle click or a long press.
function searchOption(summary, index) {
  const row = recipeRow(summary);
  row.id = `search-option-${index}`;
  row.setAttribute("role", "option");
  row.setAttribute("aria-selected", "false");
  return row;
}

function renderSearchResults() {
  setActiveOption(-1);
  const query = search.query || "";

  if (query.length < MIN_SEARCH_LENGTH) {
    const recents = recentlyViewed().slice(0, 6);
    searchPanel.replaceChildren(recents.length
      ? h("div", {}, h("div", { class: "panel-label" }, "Recently viewed"), recents.map(searchOption))
      : h("div", { class: "panel-message" }, "Search all public recipes by name or description."));
    return;
  }

  if (search.loading) {
    searchPanel.replaceChildren(spinner());
    return;
  }
  if (search.error) {
    searchPanel.replaceChildren(h("div", { class: "panel-message" },
      h("strong", {}, "Something went wrong"),
      h("span", {}, errorMessage(search.error)),
    ));
    return;
  }
  if (search.results.length === 0) {
    searchPanel.replaceChildren(h("div", { class: "panel-message" }, `No recipes match "${query}".`));
    return;
  }
  const shown = search.results.slice(0, MAX_SEARCH_RESULTS);
  const more = search.results.length - shown.length;
  searchPanel.replaceChildren(
    ...shown.map(searchOption),
    ...(more > 0 ? [h("div", { class: "panel-label" }, `${more} more. Keep typing to narrow the results.`)] : []),
  );
}

// MARK: Recipe page
// Port of `RecipeView`.

let recipeToken = 0;

async function renderRecipePage(id) {
  const token = ++recipeToken;
  window.scrollTo(0, 0);
  setRecipeColor(null);
  app.replaceChildren(recipeSkeleton());

  try {
    const recipe = await getRecipe(id);
    if (token !== recipeToken) return;
    document.title = `${recipe.title} · HomeCooked`;
    app.replaceChildren(recipePage(recipe));
    setRecipeHead(recipe);
    recordView(toSummary(recipe));
    sampleColor(recipe.thumbnailUrl).then((color) => {
      if (token === recipeToken) setRecipeColor(color);
    });
  } catch (error) {
    if (token !== recipeToken) return;
    document.title = "HomeCooked";
    app.replaceChildren(recipeError(error));
  }
}

function recipeSkeleton() {
  return h("div", { class: "recipe-page loading" },
    h("div", { class: "recipe-layout" },
      h("div", { class: "hero" }, h("div", { class: "hero-photo image-frame" }, h("div", { class: "placeholder-mark" }))),
      h("div", { class: "recipe-content" },
        h("div", { class: "title-block" }, h("div", { class: "skeleton skeleton-title" })),
        h("div", { class: "summary" },
          h("div", { class: "skeleton skeleton-line" }),
          h("div", { class: "skeleton skeleton-line short" }),
        ),
      ),
    ),
  );
}

function recipeError(error) {
  const missing = error instanceof ApiError && (error.status === 404 || error.status === 403);
  return h("div", { class: "recipe-missing" },
    h("img", { class: "missing-icon", src: "/assets/app-icon.png", alt: "", width: 72, height: 72 }),
    h("h1", {}, missing ? "Recipe not found" : "Something went wrong"),
    h("p", {}, missing
      ? "This recipe is private or no longer exists."
      : errorMessage(error)),
    h("a", { class: "outline-button", href: homeHref }, "Search recipes"),
  );
}

function recipePage(recipe) {
  const isNative = recipe.type === "native";
  const tags = tagNames(recipe);
  const tagLine = tags.length ? h("p", { class: "tag-line" }, tags.map((name) => `#${name}`).join(" ")) : null;

  return h("div", { class: `recipe-page ${isNative ? "native" : "linked"}` },
    h("div", { class: "recipe-layout" },
      h("div", { class: "hero" }, heroImage(recipe)),
      h("div", { class: "recipe-content" },
        h("div", { class: "title-block" }, h("h1", { class: "recipe-title" }, recipe.title)),
        h("div", { class: "summary" },
          actionItems(recipe),
          actionButton(recipe),
          recipeDetails(recipe),
          recipe.description ? h("p", { class: "description" }, recipe.description) : null,
        ),
        isNative
          ? [
            h("div", { class: "ingredients-block" }, tagLine, ingredientsSection(recipe)),
            h("div", { class: "instructions-block" }, instructionsSection(recipe), openOriginal(recipe)),
          ]
          : h("div", { class: "linked-tags" }, tagLine),
      ),
    ),
  );
}

function heroImage(recipe) {
  const frame = recipeImage(recipe.imageUrl || recipe.thumbnailUrl, "hero-photo");
  // Show the thumbnail while the full image loads, like the app's nested `AsyncImage`.
  if (recipe.imageUrl && recipe.thumbnailUrl) {
    const thumbnail = h("img", { class: "hero-thumbnail", src: recipe.thumbnailUrl, alt: "" });
    thumbnail.addEventListener("error", () => thumbnail.remove());
    frame.insertBefore(thumbnail, frame.querySelector("img"));
  }
  const photo = frame.querySelector("img:not(.hero-thumbnail)");
  photo?.addEventListener("load", () => fitHeroToPhoto(photo));
  return frame;
}

// The phone hero fills the photo to the full width and 63% of the screen height, like the app.
// A small photo then gets stretched and looks grainy. Cap the hero so that the photo shows at no more
// than its own pixel size (one photo pixel per CSS pixel), but never below 320px so the title still fits.
function fitHeroToPhoto(photo) {
  const page = photo.closest(".recipe-page");
  if (!page || !photo.naturalWidth) return;
  const width = document.documentElement.clientWidth;
  // Filling the width already scales the photo by width / naturalWidth. A hero up to this height needs no more.
  const sharpHeight = Math.max(photo.naturalHeight, (width * photo.naturalHeight) / photo.naturalWidth);
  page.style.setProperty("--hero-height", `clamp(320px, ${Math.round(sharpHeight)}px, var(--hero-full-height))`);
}

function actionItem(label, iconName, onClick) {
  return h("button", { class: "action-item glass", type: "button", onClick }, icon(iconName), h("span", {}, label));
}

function actionItems(recipe) {
  return h("div", { class: "action-items" },
    actionItem("Favorite", "heart", () => showGetApp("favorite")),
    actionItem("Save", "save", () => showGetApp("save")),
    actionItem("Share", "share", () => share(recipe)),
  );
}

async function share(recipe) {
  const url = location.href;
  if (navigator.share) {
    try {
      await navigator.share({ title: recipe.title, text: "Try out this recipe from HomeCooked!", url });
    } catch {
      // The person closed the share sheet.
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast("Link copied");
  } catch {
    showToast("Unable to copy the link");
  }
}

function actionButton(recipe) {
  const externalUrls = [recipe.externalUrl, ...recipe.additionalExternalUrls].filter(Boolean);
  const button = (iconName, label, onClick) =>
    h("button", { class: "action-button glass", type: "button", onClick }, icon(iconName), h("span", {}, label));
  const link = (iconName, label, href) =>
    h("a", { class: "action-button glass", href, target: "_blank", rel: "noopener noreferrer" }, icon(iconName), h("span", {}, label));

  switch (recipe.type) {
    case "native":
      return button("hand", "Open Cook Mode", () => showGetApp("cook"));
    case "url":
      return recipe.externalUrl ? link("compass", "View recipe online", recipe.externalUrl) : null;
    case "pdf":
      return recipe.externalUrl ? link("doc", "View recipe", recipe.externalUrl) : null;
    case "image":
      return externalUrls.length ? button("photo", "View recipe", () => showPhotos(externalUrls)) : null;
    default:
      return null;
  }
}

function showPhotos(urls) {
  document.getElementById("photos-list").replaceChildren(...urls.map((url) => h("img", { src: url, alt: "Recipe photo", loading: "lazy" })));
  document.getElementById("photos").showModal();
}

function recipeDetails(recipe) {
  const created = recipe.dateCreated?.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const stats = [
    ["downloads", saveCountLabel(recipe)],
    ["carrot", ingredientLabel(recipe.ingredients.length)],
    ["timer", durationLabel(totalMinutes(recipe))],
  ].filter(([, label]) => label);

  return h("div", { class: "recipe-details" },
    h("div", { class: "created-by" },
      recipe.creatorName ? h("div", { class: "creator-name" }, recipe.creatorName) : null,
      created ? h("div", { class: "created-at" }, `Created ${created}`) : null,
    ),
    h("div", { class: "recipe-stats" }, stats.map(([iconName, label]) => h("div", {}, icon(iconName), label))),
  );
}

function ingredientsSection(recipe) {
  if (recipe.ingredients.length === 0) return null;
  return h("section", {},
    h("h2", { class: "block-title" }, "Ingredients"),
    h("ul", { class: "ingredients" }, recipe.ingredients.map((ingredient) =>
      h("li", {},
        h("span", { class: "ingredient-amount" }, formattedIngredientAmount(ingredient)),
        h("span", { class: "ingredient-name" }, ingredient.name),
      ))),
  );
}

// Port of `InstructionCard`.
function instructionsSection(recipe) {
  if (recipe.instructions.length === 0) return null;
  return h("section", {},
    h("h2", { class: "block-title" }, "Instructions"),
    h("ol", { class: "instructions" }, recipe.instructions.map((instruction) => {
      const ingredients = instructionIngredientNames(instruction, recipe.ingredients);
      const time = durationLabel(instruction.timeEstimate || 0);
      return h("li", { class: "instruction-card" },
        h("div", { class: "instruction-header" },
          h("span", { class: "step-number" }, instruction.order),
          ingredients.length ? h("span", { class: "step-ingredients" }, icon("carrot"), h("span", {}, ingredients.join(" · "))) : null,
          time ? h("span", { class: "step-time" }, icon("timer"), time) : null,
        ),
        h("p", { class: "instruction-text" }, instruction.text),
      );
    })),
  );
}

function openOriginal(recipe) {
  if (!recipe.externalUrl) return null;
  return h("div", { class: "open-original" },
    h("a", { class: "outline-button", href: recipe.externalUrl, target: "_blank", rel: "noopener noreferrer" },
      icon("compass"), "Open original recipe"),
  );
}

// The recipe page puts its canonical URL and its schema.org Recipe JSON-LD in <head>. Other pages have neither.
function setRecipeHead(recipe) {
  document.getElementById("recipe-canonical")?.remove();
  document.getElementById("recipe-structured-data")?.remove();
  if (!recipe) return;
  const url = new URL(recipeHref(recipe.id), location.href).href;
  document.head.append(
    h("link", { id: "recipe-canonical", rel: "canonical", href: url }),
    h("script", { id: "recipe-structured-data", type: "application/ld+json" }, toStructuredData(recipe, url)),
  );
}

// MARK: Recipe color
// Port of `RecipeViewModel.getBackgroundColor`: the thumbnail's average color, kept between 20 and 180.
// The canvas can read the thumbnail only when the image host sends CORS headers.
// Without them, the page keeps the default color, like the app before the color loads.

// A failed read means the image host sends no CORS headers. Every later read would fail too and log a console
// error, so the page stops trying for the rest of the visit.
let colorSamplingBlocked = false;

function sampleColor(url) {
  if (!url || colorSamplingBlocked) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 16;
        const context = canvas.getContext("2d");
        context.drawImage(img, 0, 0, 16, 16);
        const data = context.getImageData(0, 0, 16, 16).data;
        const sum = [0, 0, 0];
        for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += data[i + c];
        resolve(boundAverageColor(sum.map((value) => value / (data.length / 4))));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => {
      colorSamplingBlocked = true;
      resolve(null);
    };
    img.src = url;
  });
}

// Port of `Color.boundAvgColor(min:max:)`.
function boundAverageColor([r, g, b]) {
  const average = Math.max((r + g + b) / 3, 1);
  const factor = average < 20 ? 20 / average : average > 180 ? 180 / average : 1;
  return [r, g, b].map((value) => Math.min(255, Math.round(value * factor)));
}

function setRecipeColor(color) {
  if (color) document.documentElement.style.setProperty("--recipe-rgb", color.join(" "));
  else document.documentElement.style.removeProperty("--recipe-rgb");
}

const header = siteHeader();
document.body.insertBefore(header, app);
document.body.insertBefore(searchPanel, app);
trackHeaderBottom(header);
const oldQuery = redirectOldRoute();
render();
if (oldQuery) {
  searchInput.value = oldQuery;
  clearButton.hidden = false;
  searchInput.focus();
}
