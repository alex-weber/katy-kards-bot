# Katyusha KARDS Bot

## Overview

This bot provides search results from **kards.com** to Discord and Telegram.

## Required Environment Variables

- `DATABASE_URL`: URL for an SQL database connection.
- `DISCORD_TOKEN`: Token for authenticating the Discord API.
- `REDISCLOUD_URL`: URL for REDIS database connection.
- `DISCORD_CLIENT_ID`: URL for REDIS database connection.

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

Rename `.env.example` to `.env` and set the required ones. Or set them directly in your environment.
Configure the necessary environment variables, such as `DATABASE_URL`, which should point to your database connection string.

# Generate Prisma Client
``npx prisma generate``

# Create the database
`npx prisma db push`

# Test the Application
`npm start`

Navigate to `http://localhost:PORT/`. 
You should see the bot's home page.
Send `!help` in the chat and see if the bot answers.


