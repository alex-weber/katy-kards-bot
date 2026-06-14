# Release Report: Changes Since v4.2.0

Comparison range: `v4.2.0..HEAD`
Current HEAD: `v4.6.0` (`375301a`)
Included tags: `v4.3.0`, `v4.4.0`, `v4.4.1`, `v4.4.2`, `v4.5.0`, `v4.6.0`

This report is based on the git history after `v4.2.0` and includes the current UI refinements in the working tree.

## Features

### Web UI Redesign and Navigation

- Redesigned the web UI with a modern dark panel system across the dashboard, Cards, Servers, Top Deck, Messages, Profile, Roles, Users, Custom Commands, Auth, and Uptime pages (`ca2e303`).
- Rebuilt the start page Top 100 Commands and Top 100 Users sections as modern leaderboard panels with rank badges, activity bars, formatted counts, sticky table headers, and responsive layouts (`ca2e303`).
- Refactored the main navigation into a mobile-friendly Bootstrap navbar with grouped public/admin navigation and responsive collapse behavior (`2fa0243`).
- Added a dedicated admin shield icon for admin-only navigation.
- Added sticky headline/filter treatment for Log and Custom Commands pages, with tables scrolling with the page instead of inside nested scroll containers.
- Updated Cards page visualization from a bar chart to a pie chart.
- Split Cards faction count data into two right-side tables:
  - Main Nations: `GERMANY`, `USA`, `BRITAIN`, `SOVIET UNION`, `JAPAN`.
  - Ally Nations: all remaining factions.
- Sorted Cards page faction chart and faction tables by share descending.
- Kept faction table badges synchronized with the pie-chart slice colors.
- Added uppercase faction display names, including readable labels such as `SOVIET UNION`.
- Added compact Cards page 50/50 desktop layout with chart on the left and faction tables on the right, stacking on smaller screens.
- Updated Profile page last-24-hours history timestamps to use relative day labels such as `Today` and `Yesterday`, and removed timezone suffixes from that table.
- Added responsive page-level panel, table, chart, stat-card, filter, profile, and uptime styles in `src/views/style.css`.

### User Management, Roles, and Admin Controls

- Added a web-based user management page with filtering, pagination, editable user mode/custom reply, role assignment, status toggles, and admin badges (`202a859`).
- Added Top Deck public stats/ranking page with chart data, player ranking, score totals, outcomes, activity/win-ratio charts, and profile links (`202a859`).
- Added role management and command-limit enforcement for roles (`1cd76cb`).
- Added role rule configuration for daily command limits, hourly command limits, daily deck screenshot limits, and attachment limits (`1cd76cb`).
- Added GOD/VIP/admin permission handling for web user edits and role assignments (`1cd76cb`, `202a859`).
- Added role rule UI at `/roles` for GOD-level administration (`1cd76cb`).
- Added translated role-limit messages in German, English, and Russian (`1cd76cb`).
- Added tests covering roles, user management, router access rules, Top Deck ranking, and user DB behavior (`202a859`, `1cd76cb`).

### Security and Web Request Protection

- Added CSRF protection for web forms and session-backed actions (`6350e08`).
- Added web rate limiting for routes (`6350e08`).
- Updated login/logout flow to preserve CSRF requirements and safer session handling (`6350e08`).
- Added CSRF hidden inputs to protected forms, including logout and user/role management forms (`6350e08`).

### Profile, Settings, and Reactions

- Added profile stats and settings handlers for Discord and Telegram users (`41a495a`).
- Added profile rendering helpers and profile stats text generation (`41a495a`).
- Added profile language/reaction controls and settings handling (`41a495a`, `61d8ec1`).
- Added an "activate DM" button to the profile dashboard (`61d8ec1`).
- Documented the `!profile` command in the help message (`cc15b42`).
- Added special bot reactions to user messages or bot-sent messages (`dec4ae2`).
- Added reactions for custom commands (`b2095ce`).
- Added reusable reaction helper logic (`41a495a`).
- Added tests for profile text rendering (`bf6465c`, `41a495a`).

### Discord and Telegram Command Handling

- Refactored the Discord handler into command modules:
  - `deckCommands.js`
  - `infoCommands.js`
  - `searchCommand.js`
  - `synonymCommands.js`
  - `topDeckCommand.js`
  (`1ee5a55`)
- Added reusable message context and message cache controller helpers (`1ee5a55`).
- Refactored Telegram command handling, including reaction handling and command resolution (`d79f4f0`).
- Added Telegram command logging with user and chat details (`d67bbfe`).
- Added ephemeral Discord command-list responses (`d84656c`).
- Added reserved keyword translations (`1f4c9a5`).
- Added `ANZAC` and `forecast` dictionary/translation support (`b1df28c`, `01354dc`).
- Added ANZAC support to deck-code regex parsing (`9aff41d`).

### Message and Attachment Caching

- Added Discord message caching and forwarding from cache when a message is reused in the same guild (`562ee5b`).
- Added direct-message caching by user id (`357cfb6`).
- Added CDN/proxy-based handling for image attachments (`df6143e`, `b15954c`).
- Added Redis cache expiration/settings support (`73cbf0e`).
- Changed web cache storage prefix handling (`5e0f2ae`).
- Added custom command/synonym cache with 30-day default expiration and invalidation on update/delete (`e0fc3be`).
- Added synonym cache tests (`e0fc3be`).

### Stats, Dashboard, and API Caching

- Added total counts to the dashboard chart (`f59fbbc`).
- Added better stats caching and period-aware dashboard filtering (`1f9e674`).
- Optimized frontend data caching for dashboard/API calls (`d5447a5`).
- Added API dispatch tests, message bucketing tests, message DB tests, stats cache tests, and router tests around cached dashboard data (`d5447a5`, `bf6465c`).
- Added avatar resolution/caching helper for public profile display (`1f9e674`).
- Added Top Deck public ranking data API consumption and frontend chart rendering (`202a859`).

### Deployment, Tooling, and Test Coverage

- Upgraded deployment target to Heroku-26 (`a65d1f8`).
- Added a release script to `Procfile` to push Prisma database schema changes when detected (`b0c5818`).
- Added `.editorconfig` and `.gitattributes` for consistent formatting/line endings (`63a608a`).
- Added and expanded focused test coverage across router handlers, API dispatch, avatar resolution, queue behavior, roles, stats cache, synonym cache, Top Deck ranking, users, message bucketing, and message DB behavior (`bf6465c`, `d5447a5`, `202a859`, `1cd76cb`).
- Added Node package changes for CSRF/rate-limiting dependencies (`6350e08`).

## Bug Fixes

### Stats and Dashboard Bugs

- Fixed stats cache rollover issue where yesterday's data disappeared when today's live cache rolled over (`874a3b2`).
- Optimized and corrected `top-messages` and `top-users` cache/query behavior (`baa28a2`).
- Fixed UTC time handling for stats (`3235b7c`).
- Fixed punctuation in displayed output (`58e8ad2`).

### Roles and User Management Bugs

- Fixed role enum handling and role rule cache behavior (`c2df2cc`).
- Improved role rules cache consistency after updates (`c2df2cc`).
- Protected admin/user edit behavior through role-aware permission checks (`1cd76cb`, `202a859`).

### Discord, Telegram, and Command Processing Bugs

- Fixed Telegram command logging (`2e6cbe9`).
- Fixed Telegram custom command text output formatting (`dab69ac`).
- Fixed command handling to always return a wrong-message response to the sender in relevant failure cases (`56dfed1`).
- Fixed user-command key handling so user entities are not overwritten by command records (`7c83ca5`).
- Fixed processing guard to check whether title and text exist before using them (`9d367c0`).
- Fixed permissions check behavior (`060e376`).
- Removed unused `GuildMembers` intent (`2cd0cb4`).
- Refactored Discord and Telegram handlers to reduce command-dispatch bugs and centralize command context (`1ee5a55`, `d79f4f0`).

### Deck, Card, and Attachment Bugs

- Fixed deck screenshot filename collisions by using unique filenames (`1d453f1`).
- Fixed attachment handling by using Discord proxy URLs/cdn-hosted URLs instead of unstable Discord links (`7df4534`, `b15954c`, `df6143e`).
- Fixed cleanup of generated files and in-memory answers after processing (`13faa04`).
- Fixed ANZAC and neutral card colors in overview charts (`db31aa8`).
- Added and then removed the temporary ANZAC deck-code hotfix once the upstream website bug was resolved (`5dcf948`, `da9b811`).
- Fixed Cards page chart/table presentation issues in the current UI refinement:
  - Removed counters from chart labels.
  - Moved faction counts into color-coded tables.
  - Changed the chart to a pie chart.
  - Split faction tables into Main Nations and Ally Nations.
  - Removed inner table scrolling for faction summaries.

### UI and Template Bugs

- Fixed Pug template warning introduced during redesign (`b29a458`).
- Removed redundant CSS width property from redesigned UI styles (`f232728`).
- Fixed Top Deck chart canvas stretching/cropping by sizing canvases to their chart containers.
- Fixed Log and Custom Commands nested scrolling by removing inner table scroll wrappers.
- Fixed Profile history timestamps by removing `CEST` suffixes and adding relative labels.
- Preserved mobile responsiveness across redesigned nav, dashboard panels, data tables, charts, and Cards faction layout.

### Cache and Storage Bugs

- Fixed custom command cache invalidation on update/delete (`e0fc3be`).
- Fixed cache key collisions for user command entries (`7c83ca5`).
- Added explicit Redis expiration settings to reduce stale cache behavior (`73cbf0e`).

### Formatting, Line Endings, and Dead Code

- Enforced LF line endings for all files (`63a608a`).
- Removed dead code (`c5e9ba5`).
- Refactored old tests and added additional focused tests to reduce regression risk (`bf6465c`).

