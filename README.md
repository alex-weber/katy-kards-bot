# Katyusha KARDS Bot

## Overview

This bot provides search results from **kards.com** to Discord and Telegram.

On Discord the bot is driven by **slash commands** (`/search`, `/deck`, `/help`, …), which are
registered automatically for every guild the bot is in. The legacy `!` prefix commands still work
in Direct Messages (user needs to activate the DM channel in their profile) and in Telegram.

## Required Environment Variables

- `DATABASE_URL`: PostgreSQL connection string (the app connects through `@prisma/adapter-pg`).
- `DISCORD_TOKEN`: Token for authenticating the Discord API.
- `DISCORD_CLIENT_ID`: Discord Bot ID.
- `DISCORD_AUTH_URL`: The Auth URL from Discord Dev Portal
- `REDISCLOUD_URL`: URL for REDIS database connection.
- `SESSION_SECRET`: A secret string for web session encoding

`DISCORD_CLIENT_ID` is also what the bot registers its slash commands against.

## Optional Environment Variables
- `TELEGRAM_TOKEN`: Token for authenticating for the Telegram API.
- `PORT`: Port number for the Node.js server. Default is 3000.
- `LIMIT`: Limit for message attachments (maximum 10).
- `WEB_BASE_URL`: Public base URL of the web app.
- `KARDS_API_URL`: kards.com GraphQL endpoint (defaults to the public one).
- `IMG_UPLOAD_API_KEY` / `IMG_UPLOAD_API_ENDPOINT` / `IMAGE_ALLOWED_HOSTS`: image re-hosting, for
  Discord attachments and admin-uploaded images on custom commands. Either leave all three unset
  and run without re-hosting, or **set all three** — the first two alone are not enough. With the
  credentials set but no `IMAGE_ALLOWED_HOSTS`, an upload reaches the image host and is then
  refused on the way back (`Uploaded, but the bot cannot deliver images from that host`), and
  every later download from it throws `Image host is not allowed`. Set it to the host your
  uploader serves *finished images* from — the host in the URLs it returns, which is often not
  the endpoint's own host. Comma-separated, exact hosts or `*.example.com`. Discord's CDN
  (`cdn.discordapp.com`, `media.discordapp.net`) is always allowed and needs no entry.
- `IMAGE_ALLOWED_INSECURE_HOSTS`: development only, ignored when `NODE_ENV=production`. Lets the
  named `host:port` origins through over plain http and on a non-default port, so an uploader on
  `http://localhost:3200` is reachable. Leave unset in production.
- `BROWSERLESS_API_KEY` / `BROWSERLESS_HOST`: Used for deck screenshots.
- `DEFAULT_PREFIX`: Prefix for the legacy text commands (defaults to `!`).

See `.env.example` for the full list, including cache expiration and memory-monitoring settings.

## Roles
The bot uses a role-based system to manage user permissions and command limits:

- **GOD**: Superadmin with full access to all settings and configurations.
- **VIP**: Admin with management privileges.
- **SPECIAL**: Pro User.
- **STANDARD**: Default user role.
- **PRISONER**: User with limited rights (e.g., lower command limits).

GOD users can configure role rules, such as daily/hourly command limits in the web interface.

 *Custom Prefix for a Server (legacy commands only)*

You can set a different prefix,
for example, for the server with the ID 12345,
set the env var `PREFIX_12345` = `?`.
The bot on this server now listens only to messages starting with `?`
The other servers recognize commands with the default prefix `!` (or `DEFAULT_PREFIX`).

This applies only to the deprecated text commands — slash commands are always invoked with `/`.

## Prerequisites
- Node.js `^24.21.0` and npm `^12.1.0` (see `engines` in `package.json`; Heroku installs 24.21.0 / 12.1.0)
- A PostgreSQL database and a Redis server

## Install Dependencies
`npm install`

This also generates the Prisma client (`postinstall` runs `prisma generate`).

## Set up Environment Variables

Copy `.env.example` to `.env` and set the required ones, remove the unused.
Alternatively, set them directly in your environment.

The running app does **not** load `.env` by itself — it reads `process.env` only. Locally, start
it with `npm run start:local` (see below), which loads `.env` via Node's `--env-file`. The Prisma
CLI loads `.env` on its own through `prisma.config.ts`.

Watch out for the grouped ones: `IMG_UPLOAD_API_KEY`, `IMG_UPLOAD_API_ENDPOINT` and
`IMAGE_ALLOWED_HOSTS` are all-or-nothing. Dropping just the allowlist looks harmless and leaves
image uploads and downloads broken.

## Generate Prisma Client
`npx prisma generate`

Only needed after changing `prisma/schema.prisma`; `npm install` already does it.

## Create the database
`npx prisma db push`

## Run the Application

Locally, with the variables in `.env`:

`npm run start:local`

`npm start` (plain `node src/index.js`) is for production, where the platform injects the
environment variables. Run locally without them, it fails with a Discord `TokenInvalid` error and
an `express-session deprecated req.secret` warning. Use it locally only if you have exported the
variables in your shell yourself.

Navigate to `http://localhost:PORT/`.
You should see the bot's home page.

Add this bot to a server.
Send `/help` in a chat and see if the bot answers.
Slash commands are registered for the guild when the bot starts up or joins, so they may take a
moment to appear in Discord's command list.

## Run the Tests
`npm test`

## Sync the database with kards.com
GOD and VIP users are able to sync the database.
It runs from the web dashboard: **System → Card Database Sync → Sync now**.
The panel shows the progress of a running sync, what the last one changed, and a log of the
previous runs. There is no Discord command for it.

## Website activity log
GOD and VIP users can see what logged-in users did on the website under **Activity**: custom
command changes, role rule, system and guild setting changes, card syncs, logins, and the
admin-made user status/role changes.
