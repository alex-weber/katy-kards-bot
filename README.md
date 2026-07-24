# Katyusha KARDS Bot

## Overview

This bot provides search results from **kards.com** to Discord and Telegram.

On Discord the bot is driven by **slash commands** (`/search`, `/deck`, `/help`, …), which are
registered automatically for every guild the bot is in. The legacy `!` prefix commands still work
and remain the only interface on Telegram, but on Discord they are deprecated: Discord is removing
the Message Content Intent they depend on, and users invoking them get an occasional notice
pointing at the slash equivalent.

## Required Environment Variables

- `DATABASE_URL`: URL for an SQL database connection.
- `DISCORD_TOKEN`: Token for authenticating the Discord API.
- `DISCORD_CLIENT_ID`: Discord Bot ID.
- `DISCORD_AUTH_URL`: The Auth URL from Discord Dev Portal
- `REDISCLOUD_URL`: URL for REDIS database connection.
- `SESSION_SECRET`: A secret string for web session encoding

`DISCORD_CLIENT_ID` is also what the bot registers its slash commands against.

## Optional Environment Variables
- `TELEGRAM_TOKEN`: Token for authenticating for the Telegram API.
- `PORT`: Port number for the Node.js server.
- `LIMIT`: Limit for message attachments (maximum 10).
- `WEB_BASE_URL`: Public base URL of the web app.
- `KARDS_API_URL`: kards.com GraphQL endpoint (defaults to the public one).
- `IMG_UPLOAD_API_KEY` / `IMG_UPLOAD_API_ENDPOINT`: Image host credentials. Both must be set, or
  image re-hosting is skipped — this covers Discord attachments and admin-uploaded images for
  custom commands.
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
for example for the server with the ID 12345,
set the env var `PREFIX_12345` = `?`.
The bot on this server now listens only to messages starting with `?`
The other servers recognize commands with the default prefix `!` (or `DEFAULT_PREFIX`).

This applies only to the deprecated text commands — slash commands are always invoked with `/`.

# Install Dependencies
`npm install`

# Set up Environment Variables

Rename `.env.example` to `.env` and set the required ones, remove the unused.
Alternatively, set them directly in your environment.

# Generate Prisma Client
``npx prisma generate``

# Create the database
`npx prisma db push`

# Test the Application
`npm start`

Navigate to `http://localhost:PORT/`.
You should see the bot's home page.

Add this bot to a server.
Send `/help` in a chat and see if the bot answers.
Slash commands are registered for the guild when the bot starts up or joins, so they may take a
moment to appear in Discord's command list.

# Sync the database with kards.com
GOD and VIP users are able to sync the database.
`!sync` is the command for it — this one has no slash equivalent and is still invoked with the
prefix.


