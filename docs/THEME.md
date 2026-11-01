# Theme: what the graphics lead may edit

The app's look lives in one folder. Everything else is behavior, timing or structure and is off limits for the graphics pass (Blake, 2026-10-31).

## You may edit (only these)

| Path | What it is |
|---|---|
| `harness/static/theme/tokens.css` | Design tokens: colors (`--zg-color-*`), spacing (`--zg-space-*`, `--zg-page-width`), type (`--zg-font-*`). Change values freely; add tokens if needed. |
| `harness/static/theme/theme.css` | All visual styling. Use the tokens. |
| `harness/static/theme/icons/` | App icons. Keep the file names `icon-192.png` and `icon-512.png` (same pixel sizes); add others as needed. |
| `harness/static/theme/fonts/` | Web fonts (woff2). Declare them in `theme.css`. Every font must be licensed for commercial redistribution and listed in `THIRD_PARTY.md`. |

Only CSS, images (png, svg, webp, ico), fonts (woff2, woff) and notes (md) may live in `theme/`. A test refuses anything else.

## Do not edit

- Any HTML (`harness/static/*.html`): layout structure is fixed.
- `harness/static/base.css`: keeps hidden elements hidden (it must win over the theme), and places the app shell (tab bar at the bottom on phones, side nav from 800px). Its shell rules are wrapped in `:where()`, zero specificity, so any theme rule overrides them; restyle or re-place the bar and nav freely from the theme.
- Any `.ts` or `.js` file, `sw.js`, `manifest.webmanifest`, the sounds, or anything outside `theme/`.
- Behavior and timing: nothing in the theme may react to the beat or the metronome. Beat-tied animation is behavior and stays in code.

Need a wrapper element, a new hook, or a change to the two colors kept outside the theme (`theme_color`/`background_color` in `manifest.webmanifest` and the `theme-color` meta tag)? Ask the engineering builder.

## How to select elements

Style by tag (`button`, `label`, `section`...) or by hook: `[data-zg="mx-start"]`. Hooks never change, so these selectors are stable. Do not style or rely on anything else in the HTML.

Rules for the theme:
- Never rename, add or remove `data-zg` attributes (that is HTML, and a test fails).
- Never restyle `[hidden]` (a test fails); the code shows and hides elements with it.
- No `content:` text that changes meaning, and no CSS that hides controls the code needs.

## The app shell (2026-10-31; tab bar 2026-11-01)

One screen shows at a time; the code hides the others with `hidden`. The page is:

- `shell` (everything) → `topbar` (the `h1` and the `gear` link to Settings), `status`, `nav`, `screens`.
- `nav`, phone bar left to right: `tab-today`, `tab-practice`, `tab-record` (the larger centre action; its icon is 32px, the others 24px), `tab-songs`, and the button `nav-more`. Then `more-sheet`, holding `tab-ear` ("Ear training"), `tab-goals`, `tab-cards`, `more-settings`.
- Every nav item is an inline `<svg>` icon then a `<span>` label. Icons are drawn with `stroke="currentColor"`, so they follow the item's `color`; select them as `[data-zg="nav"] svg`. Replace them only with the same approach (inline, currentColor).
- State to style: the active item has `aria-current="page"` (on Settings both `gear` and `more-settings` do). `nav-more` has `aria-expanded="true"` while its sheet is open, and `data-current` while the screen shown lives in the sheet. The open sheet has `data-open`.
- Badges: `nav-badge-practice` and `nav-badge-cards` sit inside their links, after the label; select both with `[data-zg^="nav-badge-"]`. They show a number or "99+" and are hidden (by the code) at zero.
- Placement in `base.css` (all `:where()`, overridable): phone bar fixed to the bottom, five equal slots, icon over label; badge on the icon's top-right corner; the sheet absolutely positioned just above the bar as a 2-column grid. From 800px: one side column, no More button, the sheet's links joining the column. Keep the sheet positioned against the bar: do not give `nav` a `transform` or `filter` that changes how it is placed.
- `screens` holds `screen-today`, `screen-practice` (Now + metronome), `screen-songs`, `screen-ear`, `screen-record`, `screen-goals`, `screen-cards`, `screen-settings`.
- Today: `today` (section), `today-now`, `today-start` (a link styled as the main button), `today-blocks` (rows `today-block`), `today-reminder`.
- Settings: notifications, practice times (`quiet-start`, `quiet-end`, `save-quiet`, `use-zone`), account, backup, and `dev`, a closed `<details>` with setup tools (connection, raw settings).

For the graphics pass: `nav-more` is a `<button>`, so the theme's global `button` style (padding, margin, raised look) currently applies to it; it needs resetting to match the other slots (it is now wider than them and sits 4px low). The bar, sheet, badges and the raised centre Record are otherwise unstyled; the bar and sheet have a plain system background only so content never shows through. The gear is a plain ⚙ character.

## The hooks

Static hooks, each once in `index.html` (the full list is in `harness/hooks.ts`):

`shell`, `topbar`, `gear`, `nav`, `nav-more`, `more-sheet`, `more-settings`, `screens`, `dev`, `today`, `today-now`, `today-start`, `today-blocks`, `today-reminder`, `quiet-start`, `quiet-end`, `save-quiet`, `status`, `session`, `card`, `question`, `answer`, `reveal`, `practice`, `rate`, `blocks`, `played`, `mc-choices`, `card-feedback`, `card-source`, `theory`, `theory-topics`, `goals`, `goals-list`, `goal-kind`, `goal-what`, `goal-why`, `goal-deadline`, `goal-songs`, `goal-tasks`, `goal-write-minutes`, `goal-write-takes`, `goal-write-prompt`, `goal-improv-takes`, `goal-improv-minutes`, `goal-improv-ramp-to`, `goal-improv-ramp-days`, `goal-feel`, `goal-recall`, `goal-minutes`, `goal-memo`, `goal-save`, `recorder`, `rec-status`, `rec-timer`, `rec-title`, `rec-start`, `rec-stop`, `improv-prompt`, `improv-takes`, `improv-minutes`, `improv-start`, `take-player`, `takes-list`, `takes-archived`, `ear`, `ear-level`, `ear-prompt`, `ear-play`, `ear-choices`, `ear-tap`, `ear-feedback`, `ear-resolve`, `ear-next`, `ear-unlock`, `songs`, `songs-new`, `songs-add`, `songs-paste`, `songs-paste-add`, `songs-list`, `songs-archived`, `metronome`, `mx-position`, `mx-exercise`, `mx-new`, `mx-add`, `mx-start`, `mx-tap`, `mx-allowDuringQuietHours`, `mx-result`, `mx-summary`, `mx-clean`, `mx-sloppy`, `mx-skip`, `notify-all`, `notify-morning-always`, `notify-windows`, `enable-push`, `use-zone`, `settings`, `save-settings`, `account`, `connection`, `cfg-url`, `cfg-key`, `cfg-vapid`, `save-config`, `email`, `sign-in`, `code`, `verify`, `sign-out`, `sync`, `export`, `import`

Generated groups: `tab-<screen>` for each tab, `screen-<screen>` for each screen, `nav-badge-practice` and `nav-badge-cards` (see above), `mx-<setting>` for each metronome setting (`mx-bpm`, `mx-groove`, ...), `mx-vol-<voice>` for each volume slider, `r-again`, `r-hard`, `r-good`, `r-easy`.

Created by the code on rows it adds: `block`, `block-done`, `block-ladder`, `notify-window`, `song`, `song-rename`, `song-archive`, `song-restore`, `ear-choice` (one per answer button; its `data-choice` names the answer), `take`, `take-play`, `take-rename`, `take-archive`, `take-restore`, `goal-song`, `goal`, `goal-checkin`, `goal-checkin-save`, `goal-archive`, `block-record`, `mc-choice`, `theory-topic`, `today-block`.

Setup page (`setup-keys.html`): `key-pub`, `key-priv`, `key-cron`; warnings use `[data-zg-tone="warning"]`.

## Checks that guard this

`test/hooks.test.ts` (part of `npm test`) fails if a hook is missing, duplicated, renamed or unknown; if code looks elements up any other way or sets inline styles; if the theme holds non-look files or restyles `[hidden]`; or if a page loads styles out of order (tokens, theme, then base) or has inline styles.
