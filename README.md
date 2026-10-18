# HomeCooked website

This folder is the website at `https://homecookedrecipes.app`. Everything here is public.

`.github/workflows/publish-site.yml` publishes this folder. On each push to `master` that changes `docs/`, the workflow copies the folder to the public repo `kbrady1/homecookedrecipes.app` as one new commit on `gh-pages`, and GitHub Pages serves that repo. The workflow pushes with the deploy key in the `SITE_DEPLOY_KEY` secret. `CNAME` sets the custom domain. Cloudflare holds the domain and the DNS.

`.well-known/apple-app-site-association` turns on Universal Links. Recipe URLs (`/recipe/<id>`, and older `/?recipe=<id>` links) open the app. The app ID is `4YZHCN2XQC.com.kentbrady.Recipes`. The main app's entitlements list `applinks:homecookedrecipes.app`. `.nojekyll` must stay, or GitHub Pages skips the `.well-known` folder.

The website is a static, signed-out version of the app: public recipe search and the recipe page. No build step.

- `index.html`, `styles.css`: the page and the design tokens (from `HomeCooked/sources/Colors.xcassets`).
- `config.js`: the API base URL.
- `js/api.js`: read-only API client. Sends no `Authorization` header. Search loads the search index (`GET /recipes/search_index`) once and matches in the browser.
- `js/recipe.js`: recipe parsing and formatting. Ports `Recipe(dict:)` and `ServingSizeCalculator`. Also builds the schema.org Recipe JSON-LD.
- `js/app.js`: routes (`/` and `/recipe/<id>`), the site header with the search dropdown, the pages, and the "Get the app" sheet. Old `?recipe=<id>`, `?q=` and `#/` links redirect to these URLs. Asset paths are root-relative so that they load under `/recipe/<id>`.
- `js/recent.js`: recently viewed recipes, in `localStorage`.

Each recipe has its own URL, `/recipe/<id>`. The recipe page adds a canonical link and schema.org Recipe JSON-LD to `<head>`, in the format Google documents for recipes.

Saving, favorites, and Cook Mode open the "Get the app" sheet. The site has no sign-in, editing, or user pages.

## Backend requirement

The API must allow signed-out `GET /recipes/search_index` and `GET /recipes/<id>` for public recipes, and send `Access-Control-Allow-Origin`. See `api/main/src/handler.py` and `api/main/src/search_index.py`.

## Run locally

Serve this folder with any static server, for example `python3 -m http.server -d docs`.
