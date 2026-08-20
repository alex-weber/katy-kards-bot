import "dotenv/config"
import { defineConfig, env } from "prisma/config"

// Prisma 7 no longer reads the datasource url from schema.prisma or auto-loads
// .env. The CLI (generate/migrate) gets the connection string here; the running
// app supplies it separately via the driver adapter in src/database/prisma.js.
// `dotenv/config` populates process.env for local CLI runs (the platform sets
// DATABASE_URL directly in production).
export default defineConfig({
    schema: "prisma/schema.prisma",
    migrations: {
        path: "prisma/migrations",
    },
    datasource: {
        url: env("DATABASE_URL"),
    },
})
