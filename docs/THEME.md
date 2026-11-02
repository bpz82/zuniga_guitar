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
- `nav`, phone bar left to right: `tab-today`, `tab-goals`, `tab-record` (the larger centre action; its icon is 32px, the others 24px), `tab-songs`, and the button `nav-more`. Then `more-sheet`, holding `tab-ear` ("Ear training"), `tab-cards`, `more-settings`. (2026-11-02: Practice merged into Today; Goals took its slot.)
- Every nav item is an inline `<svg>` icon then a `<span>` label. Icons are drawn with `stroke="currentColor"`, so they follow the item's `color`; select them as `[data-zg="nav"] svg`. Replace them only with the same approach (inline, currentColor).
- State to style: the active item has `aria-current="page"` (on Settings both `gear` and `more-settings` do). `nav-more` has `aria-expanded="true"` while its sheet is open, and `data-current` while the screen shown lives in the sheet. The open sheet has `data-open`.
- Badges: `nav-badge-today` and `nav-badge-cards` sit inside their links, after the label; select both with `[data-zg^="nav-badge-"]`. They show a number or "99+" and are hidden (by the code) at zero.
- Placement in `base.css` (all `:where()`, overridable): phone bar fixed to the bottom, five equal slots, icon over label; badge on the icon's top-right corner; the sheet absolutely positioned just above the bar as a 2-column grid. From 800px: one side column, no More button, the sheet's links joining the column. Keep the sheet positioned against the bar: do not give `nav` a `transform` or `filter` that changes how it is placed.
- `screens` holds `screen-today` (the single page: goal, today, lesson), `screen-songs`, `screen-ear`, `screen-record`, `screen-goals`, `screen-cards`, `screen-settings`.
- Today (2026-11-02), top to bottom: `today`, the wood hero, now the goal (a small "Your goal" line, then `goal-focus` (the h2), `goal-focus-when`, `goal-focus-why`, the link `goal-focus-link`); `today-plan`, the breakdown card (`today-now`, `today-blocks` with rows `today-block` and one row `today-lesson`, `today-reminder`, then the button `today-start`, which moves down to the lesson); `lesson` (heading "Today's lesson" and `lesson-reading`, a `<details>` with `lesson-title` and `lesson-text`); then `now` (cards and songs), `plan` (goal tasks) and `metronome`, as on the old Practice screen.
- Settings: notifications, practice times (`quiet-start`, `quiet-end`, `save-quiet`, `use-zone`), account, backup, and `dev`, a closed `<details>` with setup tools (connection, raw settings).

(Superseded 2026-11-01 by theme v6: the More button is reset to match the other slots, and the bar, sheet, badges and centre Record are styled. Note: because the theme's `button` rule sets `display`, the theme itself hides `nav-more` from 800px.) The gear is still a plain ⚙ character.

## Layout v6 (2026-11-01, Blake: "modern, friendlier")

The engineering builder redesigned the layout of every screen; the theme (v6) was refined to match: lighter warm paper with a faint wood grain (`img/wood.webp`), cream rounded cards, wood (`img/panel.webp`) kept for the Today hero and the metronome display, Zuniga Mission for headings and the main buttons. `img/tabbar.webp` is kept but no longer used.

- **One primary action per screen**, filled amber: Today `today-start`; Practice `reveal` (or `practice` for metronome cards); Record `rec-start` (round, red); Songs `songs-add`; Ear `ear-play` (round); Goals `open-goal-new`. In sheets: `goal-save`, `songs-paste-add`. Everything else is a quiet outline button.
- **Cards**: each `section` is a card. New named cards: `today-plan` (goal blocks and the next reminder), `now` (the flashcard), `plan` (today's plan and "I played"), `mx-display` (the wood tempo display), `ear-stage`, `rec-stage`. Archived songs and takes are collapsed in `songs-archive` and `takes-archive` (`<details>`).
- **App sheets (2026-11-02)** sit outside the screens and are opened by the code: `sheet-signin` (the sign-in popup at launch: `email`, `sign-in`, `code`, `verify`, the message `signin-note`, the button `signin-later`; close `close-signin`) and `sheet-songtab` (the tab viewer: `songtab-title`, `songtab-view` holding one `songtab-content` (an `img`, an `iframe` for PDFs or a `pre` for text), the link `songtab-open`; close `close-songtab`). Same dialog styling as the other sheets.
- **Bottom sheets** hold the long forms: native `<dialog>`s `sheet-mx-settings`, `sheet-songs-paste`, `sheet-improv`, `sheet-goal-new`, each opened by `open-<name>` and closed by `close-<name>`, Escape, a backdrop tap or leaving the screen. Inside: `dialog > div` scrolls; `dialog header` holds the title and close button; `dialog::backdrop` dims the page. They rise from the bottom on a phone and sit centred from 800px. Animations use `@starting-style` and stop under `prefers-reduced-motion`.
- **Touch targets**: every control is at least 44 by 44 (a browser test checks every screen at phone width). Checkboxes are drawn as switches; their whole label row is the target.
- **Motion**: screens fade up on opening, sheets slide, the More sheet rises; nothing is tied to the beat.

## The hooks

Static hooks, each once in `index.html` (the full list is in `harness/hooks.ts`):

`goal-focus`, `goal-focus-when`, `goal-focus-why`, `goal-focus-link`, `lesson`, `lesson-reading`, `lesson-title`, `lesson-text`, `card-tab`, `mx-note`, `mx-anyway`, `songs-baseline`, `baseline-status`, `baseline-list`, `songtab-file`, `songtab-title`, `songtab-view`, `songtab-open`, `theory-lessons`, `theory-extras`, `theory-extras-label`, `open-signin`, `signin-note`, `signin-later`, `today-plan`, `now`, `plan`, `mx-display`, `songs-archive`, `takes-archive`, `ear-stage`, `rec-stage`, `shell`, `topbar`, `gear`, `nav`, `nav-more`, `more-sheet`, `more-settings`, `screens`, `dev`, `today`, `today-now`, `today-start`, `today-blocks`, `today-reminder`, `quiet-start`, `quiet-end`, `save-quiet`, `status`, `session`, `card`, `question`, `answer`, `reveal`, `practice`, `rate`, `blocks`, `played`, `mc-choices`, `card-feedback`, `theory`, `goals`, `goals-list`, `goal-kind`, `goal-what`, `goal-why`, `goal-deadline`, `goal-songs`, `goal-tasks`, `goal-write-minutes`, `goal-write-takes`, `goal-write-prompt`, `goal-improv-takes`, `goal-improv-minutes`, `goal-improv-ramp-to`, `goal-improv-ramp-days`, `goal-feel`, `goal-recall`, `goal-minutes`, `goal-memo`, `goal-save`, `recorder`, `rec-status`, `rec-timer`, `rec-title`, `rec-start`, `rec-stop`, `improv-prompt`, `improv-takes`, `improv-minutes`, `improv-start`, `take-player`, `takes-list`, `takes-archived`, `ear`, `ear-level`, `ear-prompt`, `ear-play`, `ear-choices`, `ear-tap`, `ear-feedback`, `ear-resolve`, `ear-next`, `ear-unlock`, `songs`, `songs-new`, `songs-add`, `songs-paste`, `songs-paste-add`, `songs-list`, `songs-archived`, `metronome`, `mx-position`, `mx-exercise`, `mx-new`, `mx-add`, `mx-start`, `mx-tap`, `mx-allowDuringQuietHours`, `mx-result`, `mx-summary`, `mx-clean`, `mx-sloppy`, `mx-skip`, `notify-all`, `notify-morning-always`, `notify-windows`, `enable-push`, `use-zone`, `settings`, `save-settings`, `account`, `connection`, `cfg-url`, `cfg-key`, `cfg-vapid`, `save-config`, `email`, `sign-in`, `code`, `verify`, `sign-out`, `sync`, `export`, `import`

Generated groups: `sheet-<name>`, `open-<name>` and `close-<name>` for each sheet (`mx-settings`, `songs-paste`, `improv`, `goal-new`), `sheet-<name>` and `close-<name>` for the app sheets (`signin`, `songtab`), `tab-<screen>` for each tab, `screen-<screen>` for each screen, `nav-badge-today` and `nav-badge-cards` (see above), `mx-<setting>` for each metronome setting (`mx-bpm`, `mx-groove`, ...), `mx-vol-<voice>` for each volume slider, `r-again`, `r-hard`, `r-good`, `r-easy`.

Created by the code on rows it adds: `block`, `block-done`, `block-ladder`, `notify-window`, `song`, `song-rename`, `song-archive`, `song-restore`, `ear-choice` (one per answer button; its `data-choice` names the answer), `take`, `take-play`, `take-rename`, `take-archive`, `take-restore`, `goal-song`, `goal`, `goal-checkin`, `goal-checkin-save`, `goal-archive`, `block-record`, `mc-choice`, `today-block`, and (2026-11-02) `today-lesson`, `theory-chapter` (a chapter heading row), `theory-lesson` (with `data-status` `graduated`, `current` or `locked`), `baseline-song`, `baseline-rate` (with `data-rating`), `song-tab`, `song-tab-attach`, `songtab-content`.

Removed 2026-11-02 (Blake's changes 3 and 7): `card-source`, `theory-topics`, `theory-topic`, `screen-practice`, `tab-practice`, `nav-badge-practice` (now `nav-badge-today`).

Setup page (`setup-keys.html`): `key-pub`, `key-priv`, `key-cron`; warnings use `[data-zg-tone="warning"]`.

## Checks that guard this

`test/hooks.test.ts` (part of `npm test`) fails if a hook is missing, duplicated, renamed or unknown; if code looks elements up any other way or sets inline styles; if the theme holds non-look files or restyles `[hidden]`; or if a page loads styles out of order (tokens, theme, then base) or has inline styles.
