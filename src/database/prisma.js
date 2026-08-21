// Single shared Prisma client for the whole app.
//
// Prisma 7 replaced the bundled Rust query engine with driver adapters: the
// adapter (here node-postgres) owns the connection pool, and PrismaClient can
// no longer be constructed without one. One client / one pool is the correct
// shape — every src/database/*.js module imports this instance rather than
// constructing its own. The pool is closed once on shutdown via disconnect()
// in db.js (wired to SIGINT/SIGTERM in src/index.js); individual queries must
// NOT call prisma.$disconnect(), which would tear down the pool and break
// every subsequent query.
const { PrismaClient, Prisma } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')

const connectionString = process.env.DATABASE_URL
// Prisma 6's Rust engine negotiated SSL automatically; the pg driver adapter
// does not. Heroku/RDS Postgres requires SSL and presents a self-signed cert,
// so an unencrypted connection is rejected — Prisma surfaces this as P1010
// ("User was denied access"), which looks like a credentials error but isn't.
// NODE_ENV is unset on the Heroku app, so gate on the host: SSL for anything
// that isn't a local database.
const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString ?? '')
const ssl = isLocal ? undefined : { rejectUnauthorized: false }
const adapter = new PrismaPg({ connectionString, ssl })
const prisma = new PrismaClient({ adapter })

module.exports = { prisma, Prisma }
