# Release Report: Changes Since v4.2.0

Comparison range: `v4.2.0..HEAD`
Current HEAD: `v4.6.0` (`375301a`)
Included tags: `v4.3.0`, `v4.4.0`, `v4.4.1`, `v4.4.2`, `v4.5.0`, `v4.6.0`

This report is based on the git history after `v4.2.0`. The first section covers current working-tree changes that have not been tagged yet.

## v4.6.1

### Features

- Added a Commands count column to the Users page.
- Updated Users page sorting to order by role hierarchy first (`GOD`, `VIP`, `SPECIAL`, `STANDARD`, `PRISONER`) and then by total command count descending within each role.
- Updated the Guilds page to use the same sticky page header pattern as Log and Custom Commands, with the table scrolling with the page.
- Changed the dashboard yearly period label from `Last 5 years` to `All-time`.
- Updated yearly dashboard buckets to start at the year of the first message in the database and continue through the current year, while preserving yearly accumulation.
- Updated Cards page faction labels to uppercase and sorted faction chart/table data by share descending.

### Bug Fixes

- Removed nested table scrolling from the Guilds page.
- Kept Users page sorting aligned with the visible Commands count column.
- Fixed all-time yearly dashboard behavior so it is no longer limited to five years.

## v4.6.0

### Features

- Redesigned the web UI with a modern dark panel system across dashboard, Cards, Servers, Top Deck, Messages, Profile, Roles, Users, Custom Commands, Auth, and Uptime pages (`ca2e303`).
- Rebuilt the start page Top 100 Commands and Top 100 Users sections as modern leaderboard panels with rank badges, activity bars, formatted counts, sticky table headers, and responsive layouts (`ca2e303`).
- Updated Cards page visualization from a bar chart to a pie chart.
- Split Cards faction count data into Main Nations and Ally Nations tables.
- Kept faction table badges synchronized with chart slice colors.
- Added compact Cards page 50/50 desktop layout, with chart on the left and faction tables on the right.
- Updated Profile page last-24-hours command timestamps to use relative labels such as `Today` and `Yesterday`.
- Added responsive page-level panel, table, chart, stat-card, filter, profile, and uptime styles in `src/views/style.css`.

### Bug Fixes

- Fixed Pug template warning introduced during redesign (`b29a458`).
- Removed redundant CSS width property from redesigned UI styles (`f232728`).
- Fixed Top Deck chart canvas stretching/cropping by sizing canvases to their chart containers.
- Fixed Log and Custom Commands nested scrolling by removing inner table scroll wrappers.
- Removed timezone suffixes such as `CEST` from Profile history timestamps.
- Preserved mobile responsiveness across redesigned nav, dashboard panels, data tables, charts, and Cards faction layout.

## v4.5.0

### Features

- Added web-based user management with filtering, pagination, editable user mode/custom reply, role assignment, status toggles, and admin badges (`202a859`).
- Added a public Top Deck stats/ranking page with player ranking, score totals, outcomes, activity/win-ratio charts, and profile links (`202a859`).
- Added role management and command-limit enforcement for roles (`1cd76cb`).
- Added role rule configuration for daily command limits, hourly command limits, daily deck screenshot limits, and attachment limits (`1cd76cb`).
- Added role rule UI at `/roles` for GOD-level administration (`1cd76cb`).
- Added GOD/VIP/admin permission handling for web user edits and role assignments (`1cd76cb`, `202a859`).
- Added translated role-limit messages in German, English, and Russian (`1cd76cb`).
- Added CSRF protection for web forms and session-backed actions (`6350e08`).
- Added web rate limiting for routes (`6350e08`).
- Added custom command/synonym cache with a 30-day default expiration and invalidation on update/delete (`e0fc3be`).
- Refactored the main navigation into a mobile-friendly Bootstrap navbar with grouped public/admin navigation and responsive collapse behavior (`2fa0243`).
- Added tests covering roles, user management, router access rules, Top Deck ranking, user DB behavior, and synonym cache behavior.

### Bug Fixes

- Fixed role enum handling and role rule cache behavior (`c2df2cc`).
- Improved role rules cache consistency after updates (`c2df2cc`).
- Protected admin/user edit behavior through role-aware permission checks (`1cd76cb`, `202a859`).
- Fixed custom command cache invalidation on update/delete (`e0fc3be`).
- Updated login/logout flow to preserve CSRF requirements and safer session handling (`6350e08`).

## v4.4.2

### Features

- Added better stats caching and period-aware dashboard filtering (`1f9e674`).
- Optimized frontend data caching for dashboard/API calls (`d5447a5`).
- Added API dispatch tests, message bucketing tests, message DB tests, stats cache tests, and router tests around cached dashboard data (`d5447a5`, `bf6465c`).
- Added avatar resolution/caching helper for public profile display (`1f9e674`).
- Refactored old tests and added additional focused tests to reduce regression risk (`bf6465c`).

### Bug Fixes

- Fixed stats cache rollover issue where yesterday's data disappeared when today's live cache rolled over (`874a3b2`).
- Optimized and corrected `top-messages` and `top-users` cache/query behavior (`baa28a2`).
- Enforced LF line endings for all files (`63a608a`).
- Removed dead code (`c5e9ba5`).
- Fixed punctuation in displayed output (`58e8ad2`).

## v4.4.1

### Features

- Continued stats caching work from the `feat/stats` branch.
- Added improved frontend/backend cache boundaries for dashboard period data.

### Bug Fixes

- Fixed query/cache behavior for dashboard top-message and top-user calculations.
- Fixed line-ending consistency before the follow-up `v4.4.2` tag.

## v4.4.0

### Features

- Added profile stats and settings handlers for Discord and Telegram users (`41a495a`).
- Added profile rendering helpers and profile stats text generation (`41a495a`).
- Added profile language/reaction controls and settings handling (`41a495a`, `61d8ec1`).
- Added an "activate DM" button to the profile dashboard (`61d8ec1`).
- Documented the `!profile` command in the help message (`cc15b42`).
- Added special bot reactions to user messages or bot-sent messages (`dec4ae2`).
- Added reactions for custom commands (`b2095ce`).
- Added reusable reaction helper logic (`41a495a`).
- Refactored the Discord handler into command modules:
  - `deckCommands.js`
  - `infoCommands.js`
  - `searchCommand.js`
  - `synonymCommands.js`
  - `topDeckCommand.js`
  (`1ee5a55`)
- Added reusable message context and message cache controller helpers (`1ee5a55`).
- Refactored Telegram command handling, including reaction handling and command resolution (`d79f4f0`).
- Added ephemeral Discord command-list responses (`d84656c`).
- Added Redis cache expiration/settings support (`73cbf0e`).
- Added ANZAC and forecast dictionary/translation support (`b1df28c`, `01354dc`).
- Added ANZAC support to deck-code regex parsing (`9aff41d`).
- Added a release script to `Procfile` to push Prisma database schema changes when detected (`b0c5818`).
- Changed web cache storage prefix handling (`5e0f2ae`).
- Added direct-message caching by user id (`357cfb6`).

### Bug Fixes

- Fixed UTC time handling for stats (`3235b7c`).
- Fixed command handling to always return a wrong-message response to the sender in relevant failure cases (`56dfed1`).
- Fixed user-command key handling so user entities are not overwritten by command records (`7c83ca5`).
- Fixed processing guard to check whether title and text exist before using them (`9d367c0`).
- Fixed permissions check behavior (`060e376`).
- Removed unused `GuildMembers` intent (`2cd0cb4`).
- Fixed ANZAC and neutral card colors in overview charts (`db31aa8`).
- Added and then removed the temporary ANZAC deck-code hotfix once the upstream website bug was resolved (`5dcf948`, `da9b811`).
- Refactored Discord and Telegram handlers to reduce command-dispatch bugs and centralize command context (`1ee5a55`, `d79f4f0`).

## v4.3.0

### Features

- Upgraded deployment target to Heroku-26 (`a65d1f8`).
- Added reserved keyword translations (`1f4c9a5`).
- Added Telegram command logging with user and chat details (`d67bbfe`).
- Added CDN-based handling for image attachments (`df6143e`).
- Added special bot reactions to user messages or bot-sent messages (`dec4ae2`).
- Added total counts to the dashboard chart (`f59fbbc`).
- Added reactions to custom commands (`b2095ce`).
- Added Discord message caching and forwarding from cache when a message is reused in the same guild (`562ee5b`).

### Bug Fixes

- Fixed cleanup of generated files and in-memory answers after processing (`13faa04`).
- Fixed Telegram command logging (`2e6cbe9`).
- Fixed Telegram custom command text output formatting (`dab69ac`).
- Fixed attachment handling by using Discord proxy URLs/CDN-hosted URLs instead of unstable Discord links (`7df4534`, `b15954c`, `df6143e`).
- Fixed deck screenshot filename collisions by using unique filenames (`1d453f1`).
