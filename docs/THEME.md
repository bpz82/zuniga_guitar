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

## The app shell (2026-10-31; navigation 2026-11-03)

One screen shows at a time; the code hides the others with `hidden`. The page is:

- `shell` (everything) → `topbar` (the `h1`, and `nav` holding the menu), `status`, `pager`, `screens`, then the app popups (dialogs).
- **The menu (2026-11-03)** replaces the bottom tab bar, its More sheet, the laptop side nav and the gear. `nav` holds one button, `menu` (a hamburger icon and the label "Menu"; at least 44 by 44, in the top bar's right corner on every screen size), and its list `menu-list`, top to bottom: `tab-today` ("Home"), `tab-teach`, `tab-record`, `tab-songs`, `tab-ear` ("Ear training"), `tab-goals`, `tab-cards`, `menu-settings`.
- Every menu item is an inline `<svg>` icon then a `<span>` label. Icons are drawn with `stroke="currentColor"`, so they follow the item's `color`; select them as `[data-zg="menu-list"] svg`. Replace them only with the same approach (inline, currentColor).
- State to style: the item for the screen shown has `aria-current="page"`. `menu` has `aria-expanded="true"` while the list is open; the open list has `data-open`.
- Badges: `nav-badge-today` (in Home) and `nav-badge-cards` (in Cards) sit inside their items, after the label; select both with `[data-zg^="nav-badge-"]`. They show a number or "99+" and are hidden (by the code) at zero.
- **Page dots (2026-11-03):** `pager`, under the top bar, shown only on Home and Teach: two links, `pager-today` ("Home") and `pager-teach` ("Teach"), each an empty `span` (the dot) then the label; the current one has `aria-current="page"`. They are the visible way to do what a sideways swipe does.
- Placement in `base.css` (all `:where()`, overridable): the top bar is a row (title left, menu right); `nav` is the list's anchor; the list drops down from the button, right-aligned, one column; the dots sit side by side, centred. `base.css` also lets Home and Teach swipe (`touch-action: pan-y pinch-zoom` on their screens, no sideways overscroll on the page): behavior, not look; leave it alone.
- `screens` holds `screen-today` (Home), `screen-teach`, `screen-songs`, `screen-ear`, `screen-record`, `screen-goals`, `screen-cards`, `screen-settings`.
- **Home (2026-11-03)** is the day's deck: `home` (a small head card: "Today's deck", `home-goal` saying what it works toward, the button `today-objectives` to see the popup again), then `now` (cards and songs), `plan` (goal tasks) and `metronome`.
- **Home's popup**, `sheet-objectives`, opens when the app opens: the header, then `today` (the wood goal card: a small "Your goal" line, `goal-focus` (an h3), `goal-focus-when`, `goal-focus-why`, the link `goal-focus-link`), then `today-plan` (`today-now`, the bullet list `today-blocks` with items `today-block` (goal blocks), `today-objective` (songs, the deck) and `today-lesson` (the Teach lesson), each with `data-kind` and, when done, `data-done`; then `today-reminder`), then the button `today-start` (focused on opening). Its backdrop is opaque on purpose: nothing behind the popup shows.
- **Teach (2026-11-03):** `teach` (head card: "Teach", `teach-progress`, the button `teach-objectives`), `lesson` (the reading, as before: `lesson-reading`, `lesson-title`, `lesson-text`), then `teach-deck` (`teach-status`, then `teach-card` with `teach-question`, `teach-answer`, `teach-choices` (buttons `teach-choice`), `teach-feedback`, `teach-reveal`, and `teach-rate` with `teach-r-again` to `teach-r-easy`). The Teach card is styled with the same rules as Home's card.
- **Teach's popup**, `sheet-teach-objectives`: `teach-chapter`, `teach-lesson` (an h3), the bullet list `teach-goals` (items `teach-objective`), the button `teach-start`. Opaque backdrop, like Home's.
- **Entrances** the code marks, for the theme to animate (and to drop under `prefers-reduced-motion`): a screen gets `data-enter="deck"` when a popup closes into its deck, and `data-enter="from-right"` or `"from-left"` when Home and Teach slide into each other. The attribute is removed after about a second.
- Settings: notifications (`settings-notify`), practice times (`settings-times`: `quiet-start`, `quiet-end`, `save-quiet`, `use-zone`), account, band, backup, and `dev`, a closed `<details>` with setup tools (connection, raw settings).
- **Band members (2026-11-03).** Settings' `band` section: `band-role` (a line saying what this account is), then `band-manage` (owners only): the note box `band-invite-note`, the button `band-invite`, `band-invite-made` (shown once a link is made: the read-only box `band-invite-link` and `band-invite-copy`), `band-note` (status line), then the lists `band-invites` (rows `band-invite-row`, each with `data-status` open, used, revoked or expired, and when open a `band-invite-revoke` button) and `band-members` (rows `band-member-row` with `data-status` active or removed; buttons `band-member-remove`, `band-member-delete`). The confirm popup `sheet-band-delete` (outside the screens, like the other app popups): `close-band-delete`, `band-delete-who`, `band-delete-confirm` (the dangerous one), `band-delete-cancel` ("Keep it", focused on opening). The sign-in popup has `signin-invite`, shown when the person came from an invite link.
- **A band member's app** hides every menu item but Songs and Settings, and hides `songs-new-label` (the title box's label, so it hides with the box), `songs-add`, `open-songs-paste`, `songs-archive`, `settings-notify`, `settings-times` and `dev`. Songs starts with `songs-band` (`songs-band-title`, `songs-band-note`). His song rows are `song` rows (with `data-card`): the title, `song-tab`, `song-due` (when it is next due for him, or "Not rated yet"), then four `song-rate` buttons with `data-rating`, styled like the baseline ratings.
- **Putting the app on his phone (2026-11-03):** the popup `sheet-install` (outside the screens): `close-install`, `install-intro`, the numbered list `install-steps` (items `install-step`, three per device: iPhone, Android or a computer), a small note, and `install-done` ("Got it", focused on opening). It opens by itself once, right after a band member first opens the app signed in, in a browser. `install-open`, in Settings' account section, opens it again (hidden for owners and inside the Home Screen app).

(Superseded 2026-11-03: the five-slot bottom bar with the large centre Record, the More sheet, the side nav from 800px and the ⚙ gear. Their styles are gone from theme.css.)

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

`goal-focus`, `goal-focus-when`, `goal-focus-why`, `goal-focus-link`, `lesson`, `lesson-reading`, `lesson-title`, `lesson-text`, `menu`, `menu-list`, `menu-settings`, `pager`, `home`, `home-goal`, `today-objectives`, `teach`, `teach-progress`, `teach-objectives`, `teach-deck`, `teach-status`, `teach-card`, `teach-question`, `teach-answer`, `teach-choices`, `teach-feedback`, `teach-reveal`, `teach-rate`, `teach-chapter`, `teach-lesson`, `teach-goals`, `teach-start`, `card-tab`, `mx-note`, `mx-anyway`, `songs-baseline`, `baseline-status`, `baseline-list`, `songtab-file`, `songtab-title`, `songtab-view`, `songtab-open`, `theory-lessons`, `theory-extras`, `theory-extras-label`, `open-signin`, `signin-note`, `signin-later`, `today-plan`, `now`, `plan`, `mx-display`, `songs-archive`, `takes-archive`, `ear-stage`, `rec-stage`, `shell`, `topbar`, `nav`, `screens`, `dev`, `today`, `today-now`, `today-start`, `today-blocks`, `today-reminder`, `quiet-start`, `quiet-end`, `save-quiet`, `status`, `session`, `card`, `question`, `answer`, `reveal`, `practice`, `rate`, `blocks`, `played`, `mc-choices`, `card-feedback`, `theory`, `goals`, `goals-list`, `goal-kind`, `goal-what`, `goal-why`, `goal-deadline`, `goal-songs`, `goal-tasks`, `goal-write-minutes`, `goal-write-takes`, `goal-write-prompt`, `goal-improv-takes`, `goal-improv-minutes`, `goal-improv-ramp-to`, `goal-improv-ramp-days`, `goal-feel`, `goal-recall`, `goal-minutes`, `goal-memo`, `goal-save`, `recorder`, `rec-status`, `rec-timer`, `rec-title`, `rec-start`, `rec-stop`, `improv-prompt`, `improv-takes`, `improv-minutes`, `improv-start`, `take-player`, `takes-list`, `takes-archived`, `ear`, `ear-level`, `ear-prompt`, `ear-play`, `ear-choices`, `ear-tap`, `ear-feedback`, `ear-resolve`, `ear-next`, `ear-unlock`, `songs`, `songs-new`, `songs-add`, `songs-paste`, `songs-paste-add`, `songs-list`, `songs-archived`, `metronome`, `mx-position`, `mx-exercise`, `mx-new`, `mx-add`, `mx-start`, `mx-tap`, `mx-allowDuringQuietHours`, `mx-result`, `mx-summary`, `mx-clean`, `mx-sloppy`, `mx-skip`, `notify-all`, `notify-morning-always`, `notify-windows`, `enable-push`, `use-zone`, `settings`, `save-settings`, `account`, `connection`, `cfg-url`, `cfg-key`, `cfg-vapid`, `save-config`, `email`, `sign-in`, `code`, `verify`, `sign-out`, `sync`, `export`, `import`

Generated groups: `sheet-<name>`, `open-<name>` and `close-<name>` for each sheet (`mx-settings`, `songs-paste`, `improv`, `goal-new`), `sheet-<name>` and `close-<name>` for the app sheets (`signin`, `songtab`, `objectives`, `teach-objectives`), `tab-<screen>` for each menu item, `screen-<screen>` for each screen, `pager-today` and `pager-teach`, `nav-badge-today` and `nav-badge-cards` (see above), `mx-<setting>` for each metronome setting (`mx-bpm`, `mx-groove`, ...), `mx-vol-<voice>` for each volume slider, `r-again`, `r-hard`, `r-good`, `r-easy`, and Teach's `teach-r-again`, `teach-r-hard`, `teach-r-good`, `teach-r-easy`.

Created by the code on rows it adds: `block`, `block-done`, `block-ladder`, `notify-window`, `song`, `song-rename`, `song-archive`, `song-restore`, `ear-choice` (one per answer button; its `data-choice` names the answer), `take`, `take-play`, `take-rename`, `take-archive`, `take-restore`, `goal-song`, `goal`, `goal-checkin`, `goal-checkin-save`, `goal-archive`, `block-record`, `mc-choice`, `today-block`, and (2026-11-02) `today-lesson`, `theory-chapter` (a chapter heading row), `theory-lesson` (with `data-status` `graduated`, `current` or `locked`), `baseline-song`, `baseline-rate` (with `data-rating`), `song-tab`, `song-tab-attach`, `songtab-content`, and (2026-11-03) `today-objective`, `teach-objective`, `teach-choice`.

Removed 2026-11-02 (Blake's changes 3 and 7): `card-source`, `theory-topics`, `theory-topic`, `screen-practice`, `tab-practice`, `nav-badge-practice` (now `nav-badge-today`).

Renamed or removed 2026-11-03 (Blake's changes 4 and 5): `nav-more` is now `menu`, `more-sheet` is now `menu-list`, `more-settings` is now `menu-settings`; `gear` is removed (Settings is in the menu).

Setup page (`setup-keys.html`): `key-pub`, `key-priv`, `key-cron`; warnings use `[data-zg-tone="warning"]`.

## Checks that guard this

`test/hooks.test.ts` (part of `npm test`) fails if a hook is missing, duplicated, renamed or unknown; if code looks elements up any other way or sets inline styles; if the theme holds non-look files or restyles `[hidden]`; or if a page loads styles out of order (tokens, theme, then base) or has inline styles.
