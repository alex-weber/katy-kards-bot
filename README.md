# Katyusha KARDS Bot

## Overview

This bot provides search results from **kards.com** to Discord and Telegram.

## Required Environment Variables

- `DATABASE_URL`: URL for an SQL database connection.
- `DISCORD_TOKEN`: Token for authenticating the Discord API.
- `REDISCLOUD_URL`: URL for REDIS database connection.

## Optional Environment Variables
- `TELEGRAM_TOKEN`: Token for authenticating for the Telegram API.
- `PORT`: Port number for the Node.js server.
- `LIMIT`: Limit for Discord API attachments (maximum 10).

## Custom Prefix for Servers

You can set a different prefix for a server using the following pattern:

`PREFIX_${ServerID}`

# Install Dependencies
`npm install`

# Set up Environment Variables

Rename `.env.example` and set them. Or set them on the server.
Configure the necessary environment variables, such as `DATABASE_URL`, which should point to your database connection string.

# Generate Prisma Client
``npx prisma generate``

# Create the database:
`npx prisma db push`

# Test the Application
`npm start`


