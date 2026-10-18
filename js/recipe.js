// Recipe model and display formatting.
// Ports `Recipe(dict:)`, `ServingSizeCalculator`, and the label helpers from the iOS app.

const FAVORITE_TAG_ID = "favorite";

// The API encodes DynamoDB decimals as strings, so every number arrives as a number or a string.
function toNumber(value) {
  const number = typeof value === "string" ? parseFloat(value) : value;
  return Number.isFinite(number) ? number : null;
}

// Only http(s) URLs reach `href` and `src`. Recipe data is user-written.
export function safeUrl(value) {
  if (typeof value !== "string" || value === "") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

// Port of `URL.viaCloudfront`.
export function viaCloudfront(value) {
  const url = safeUrl(value);
  if (!url) return null;
  return url.href.replace(
    "https://s3-us-west-2.amazonaws.com/home-cooked-photos",
    "https://dw2mlt0zbk1xq.cloudfront.net",
  );
}

// "yyyy-MM-dd'T'HH:mm:ssZ", for example 2024-06-27T10:00:00+0000.
function parseDate(value) {
  if (typeof value !== "string") return null;
  const date = new Date(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseRecipe(dict) {
  if (!dict || typeof dict.id !== "string" || typeof dict.title !== "string") {
    throw new Error("Invalid recipe information returned");
  }

  const ingredients = (Array.isArray(dict.ingredients) ? dict.ingredients : [])
    .filter((ingredient) => ingredient && typeof ingredient.name === "string")
    .map((ingredient) => ({
      id: ingredient.id,
      name: ingredient.name,
      amount: toNumber(ingredient.amount),
      isUnit: ingredient.unit === true,
      altUnit: ingredient.altUnit ? { short: ingredient.altUnit.short || "", long: ingredient.altUnit.long || "" } : null,
    }));

  const instructions = (Array.isArray(dict.instructions) ? dict.instructions : [])
    .filter((instruction) => instruction && typeof instruction.text === "string")
    .map((instruction) => ({
      id: instruction.id,
      order: toNumber(instruction.order) ?? 0,
      text: instruction.text,
      timeEstimate: toNumber(instruction.time_estimate),
      associatedIngredients: Array.isArray(instruction.associated_ingredients) ? instruction.associated_ingredients : [],
    }))
    .sort((a, b) => a.order - b.order)
    .map((instruction, index) => ({ ...instruction, order: index + 1 }));

  return {
    id: dict.id,
    title: dict.title,
    description: typeof dict.desc === "string" && dict.desc.trim() !== "" ? dict.desc : null,
    ingredients,
    instructions,
    imageUrl: viaCloudfront(dict.image_url),
    thumbnailUrl: viaCloudfront(dict.thumbnail_url),
    tags: (Array.isArray(dict.tags) ? dict.tags : []).filter((tag) => tag && typeof tag.name === "string"),
    ownerId: dict.owner_id,
    creatorId: dict.creator_id,
    creatorName: typeof dict.creator_name === "string" ? dict.creator_name : null,
    externalUrl: viaCloudfront(dict.external_url),
    additionalExternalUrls: (Array.isArray(dict.additional_external_urls) ? dict.additional_external_urls : [])
      .map(viaCloudfront)
      .filter(Boolean),
    type: ["native", "url", "image", "pdf"].includes(dict.type) ? dict.type : "native",
    numSaves: toNumber(dict.num_saves) ?? 0,
    dateCreated: parseDate(dict.date_created),
  };
}

// MARK: Labels

// Port of `Int.minsAndHoursFormatted`.
export function minsAndHoursFormatted(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return [
    hours === 0 ? null : `${hours} hr${hours > 1 ? "s" : ""}`,
    minutes === 0 ? null : `${minutes} min${minutes > 1 ? "s" : ""}`,
  ].filter(Boolean).join(" ");
}

export function totalMinutes(recipe) {
  return recipe.instructions.reduce((sum, instruction) => sum + (instruction.timeEstimate || 0), 0);
}

export function durationLabel(minutes) {
  return minutes > 0 ? minsAndHoursFormatted(minutes) : null;
}

export function ingredientLabel(count) {
  return count > 0 ? `${count} ingredient${count > 1 ? "s" : ""}` : null;
}

// Port of `RecipeViewModel.saveCountLabel`. Only the original copy shows its save count.
export function saveCountLabel(recipe) {
  if (recipe.numSaves <= 0 || recipe.ownerId !== recipe.creatorId) return null;
  return `${recipe.numSaves} download${recipe.numSaves > 1 ? "s" : ""}`;
}

export function tagNames(recipe) {
  return recipe.tags.filter((tag) => tag.id !== FAVORITE_TAG_ID).map((tag) => tag.name);
}

export function instructionIngredientNames(instruction, ingredients) {
  const byId = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient.name]));
  return instruction.associatedIngredients.map((id) => byId.get(id)).filter(Boolean);
}

// The fields that a recipe row or a recipe card shows. Recently viewed recipes store this shape.
export function toSummary(recipe) {
  return {
    id: recipe.id,
    title: recipe.title,
    thumbnailUrl: recipe.thumbnailUrl,
    minutes: totalMinutes(recipe),
    ingredientCount: recipe.ingredients.length,
    tags: tagNames(recipe),
    creatorName: recipe.creatorName,
  };
}

// MARK: Ingredient amounts (port of `ServingSizeCalculator`)

// One unit is one tablespoon.
const TABLESPOON = 1.0;
const TEASPOON = 1.0 / 3.0;
const CUP = 16.0;
const HALF_CUP = CUP / 2;
const QUARTER_TABLE_SPOON = TABLESPOON / 4;
const MAX_TEASPOONS = 5;
const MAX_TABLESPOONS = 3;

const UNITS = {
  teaspoon: { short: "tsp", long: "Teaspoon" },
  tablespoon: { short: "Tbsp", long: "Tablespoon" },
  cup: { short: "cup", long: "Cup" },
};

const isWhole = (num, den) => num % den === 0;

function rationalApproximation(x0, eps = 1.0e-2) {
  let x = x0;
  let a = Math.floor(x);
  let [h1, k1, h, k] = [1, 0, a, 1];
  for (let i = 0; i < 64 && x - a > eps * k * k; i++) {
    x = 1.0 / (x - a);
    a = Math.floor(x);
    [h1, k1, h, k] = [h, k, h1 + a * h, k1 + a * k];
  }
  return { num: h, den: k };
}

function getAmount(amount) {
  if (amount < QUARTER_TABLE_SPOON) {
    return { ...rationalApproximation(amount / TEASPOON), unit: UNITS.teaspoon };
  }
  if (amount < TABLESPOON) {
    const teaspoons = rationalApproximation(amount / TEASPOON);
    if (isWhole(teaspoons.num, teaspoons.den) || teaspoons.den === 2 || teaspoons.den === 4) {
      return { ...teaspoons, unit: UNITS.teaspoon };
    }
    return { ...rationalApproximation(amount / TABLESPOON), unit: UNITS.tablespoon };
  }
  if (amount <= HALF_CUP) {
    const cups = rationalApproximation(amount / CUP);
    const teaspoons = rationalApproximation(amount / TEASPOON);
    const tablespoons = rationalApproximation(amount / TABLESPOON);
    if (isWhole(tablespoons.num, tablespoons.den) && tablespoons.num <= MAX_TABLESPOONS) {
      return { ...tablespoons, unit: UNITS.tablespoon };
    }
    if (isWhole(teaspoons.num, teaspoons.den) && teaspoons.num <= MAX_TEASPOONS) {
      return { ...teaspoons, unit: UNITS.teaspoon };
    }
    if (cups.den === 4 || cups.den === 3 || cups.den === 2) {
      return { ...cups, unit: UNITS.cup };
    }
    return { ...tablespoons, unit: UNITS.tablespoon };
  }
  return { ...rationalApproximation(amount / CUP), unit: UNITS.cup };
}

const FRACTIONS = { "1/2": "½", "1/4": "¼", "3/4": "¾", "2/3": "⅔", "1/3": "⅓" };

function stylizeFraction(num, den) {
  const raw = `${num}/${den}`;
  return FRACTIONS[raw] || raw;
}

function simplify(num, den, unit) {
  if (num === den) return ["1", unit];
  if (num > den) {
    const whole = Math.floor(num / den);
    if (isWhole(num, den)) return [`${whole}`, `${unit}s`];
    return [`${whole} ${stylizeFraction(num - whole * den, den)}`, `${unit}s`];
  }
  return [stylizeFraction(num, den), unit];
}

function trimDecimal(value, places) {
  return value.toFixed(places).replace(/\.?0+$/, "") || "0";
}

const DECIMAL_FRACTIONS = [[0.5, "½"], [0.25, "¼"], [0.75, "¾"], [2 / 3, "⅔"], [1 / 3, "⅓"]];

function stylizeDecimal(value) {
  if (value > 1) {
    const whole = Math.floor(value);
    const part = stylizeDecimal(value - whole);
    if (part.startsWith("0")) return `${whole}${part.slice(1)}`;
    return `${whole} ${part}`;
  }
  const fraction = DECIMAL_FRACTIONS.find(([decimal]) => Math.abs(value - decimal) < 0.01);
  return fraction ? fraction[1] : trimDecimal(value, 2);
}

// Port of `RecipeViewModel.formattedIngredient(for:)`: one serving, short unit names.
export function formattedIngredientAmount(ingredient) {
  if (!ingredient.amount) return "";

  if (ingredient.isUnit) {
    const unit = ingredient.altUnit ? ingredient.altUnit.short.trim() : null;
    const amount = stylizeDecimal(ingredient.amount);
    return [amount, unit && ingredient.amount > 1 ? `${unit}s` : unit].filter(Boolean).join(" ");
  }

  const { num, den, unit } = getAmount(ingredient.amount);
  return simplify(num, den, unit.short).join(" ");
}

// MARK: Structured data
// schema.org Recipe as JSON-LD, the format Google documents for recipe pages:
// https://developers.google.com/search/docs/appearance/structured-data/recipe

// ISO 8601 duration, for example 100 minutes is "PT1H40M".
function isoDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `PT${hours ? `${hours}H` : ""}${rest || !hours ? `${rest}M` : ""}`;
}

export function toStructuredData(recipe, pageUrl) {
  const minutes = totalMinutes(recipe);
  const tags = tagNames(recipe);
  const data = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: recipe.title,
    url: pageUrl,
    image: [recipe.imageUrl, recipe.thumbnailUrl].filter(Boolean),
    description: recipe.description || undefined,
    author: recipe.creatorName ? { "@type": "Person", name: recipe.creatorName } : undefined,
    datePublished: recipe.dateCreated?.toISOString().slice(0, 10),
    totalTime: minutes > 0 ? isoDuration(minutes) : undefined,
    keywords: tags.length ? tags.join(", ") : undefined,
    recipeIngredient: recipe.ingredients.length
      ? recipe.ingredients.map((ingredient) => [formattedIngredientAmount(ingredient), ingredient.name].filter(Boolean).join(" "))
      : undefined,
    recipeInstructions: recipe.instructions.length
      ? recipe.instructions.map((instruction) => ({ "@type": "HowToStep", position: instruction.order, text: instruction.text }))
      : undefined,
    // Recipes saved from a web page or a photo point to the original.
    isBasedOn: recipe.type !== "native" ? recipe.externalUrl || undefined : undefined,
  };
  // JSON.stringify drops the undefined fields. Escaping "<" keeps recipe text from closing the script element.
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
