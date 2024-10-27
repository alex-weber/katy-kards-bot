const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()


/**
 * @returns {Promise<*>}
 */
async function getAllSynonyms()
{

    return await prisma.synonym.findMany({
        orderBy: {
            key: 'asc'
        }
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
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

module.exports = {createSynonym, updateSynonym, deleteSynonym, getAllSynonyms, getSynonym}