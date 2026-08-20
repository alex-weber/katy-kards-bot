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

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

module.exports = { prisma, Prisma }
