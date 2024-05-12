# Katyusha KARDS Bot

## Overview

This bot provides search results from **kards.com** to Discord and Telegram.

## Required Environment Variables

- `DATABASE_URL`: URL for an SQL database connection.
- `DISCORD_TOKEN`: Token for authenticating the Discord API.
- `REDISCLOUD_URL`: URL for REDIS database connection.
- `DISCORD_CLIENT_ID`: Discord Bot ID.
- `DISCORD_AUTH_URL`: The Auth URL from Discord Dev Portal
- `IMG_UPLOAD_API_KEY`: ibb.co API key for image hosting
- `SESSION_SECRET`: A secret string for web session encoding

## Optional Environment Variables
- `TELEGRAM_TOKEN`: Token for authenticating for the Telegram API.
- `PORT`: Port number for the Node.js server.
- `LIMIT`: Limit for message attachments (maximum 10).

 *Custom Prefix for a Server*

You can set a different prefix, 
for example for the server with the ID 12345, 
set the env var `PREFIX_12345` = `?`.
The bot on this server now listens only to messages starting with `?`
The other servers recognize commands with the default prefix `!`

# Install Dependencies
`npm install`

# Set up Environment Variables

Rename `.env.example` to `.env` and set the required ones, remove the unused. 
Alternatively set them directly in your environment.

# Generate Prisma Client
``npx prisma generate``

# Create the database
`npx prisma db push`

# Test the Application
`npm start`

Navigate to `http://localhost:PORT/`. 
You should see the bot's home page.

Add bot to a server.
Send `!help` in a chat and see if the bot answers.


