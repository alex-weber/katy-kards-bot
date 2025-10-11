const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const {redis, cachePrefix} = require('../controller/redis')
const expiration = parseInt(process.env.CACHE_PAGE_EXPIRE) || 60*5
/**
 * @returns {Promise<*>}
 */
async function getAllSynonyms()
{

    const cacheKey = cachePrefix + 'page:commands'
    const cached = await redis.json.get(cacheKey, '$')

    if (cached) return cached

    const synonyms = await prisma.synonym.findMany({
        orderBy: {
            key: 'asc'
        }
    })

    await redis.json.set(cacheKey, '$', synonyms)
    await redis.expire(cacheKey, expiration)

    await prisma.$disconnect()

    return synonyms
}

/**
 *
 * @param key
 * @returns {Promise<*>}
 */
async function getSynonym(key)
{

    return await prisma.synonym.findUnique({
        where: {
            key: key,
        },
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
}

/**
 *
 * @param id
 * @returns {Promise<*>}
 */
async function getSynonymById(id)
{

    return await prisma.synonym.findUnique({
        where: {
            id: parseInt(id),
        },
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
}

/**
 *
 * @param key
 * @param value
 * @returns {Promise<*>}
 */
async function createSynonym(key, value)
{
    if (typeof key !== 'string' || typeof value !== 'string') return

    return await prisma.synonym.create({
        data: {
            key: key,
            value: value,
        },
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
}

/**
 *
 * @param key
 * @param value
 * @returns {Promise<*>}
 */
async function updateSynonym(key, value)
{
    if (typeof value !== 'string') return

    return await prisma.synonym.update({
        where: { key: key },
        data: {
            value: value,
        },
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
}

/**
 *
 * @param key
 * @returns {Promise<*>}
 */
async function deleteSynonym(key)
{

    return await prisma.synonym.delete({
        where: { key: key }
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
}

module.exports = {
    createSynonym,
    updateSynonym,
    deleteSynonym,
    getAllSynonyms,
    getSynonym,
    getSynonymById,
}