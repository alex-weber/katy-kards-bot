const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

/**
 *
 * @param data
 * @returns {Promise<*>}
 */
async function createUser(data)
{

    return await prisma.user.create({
        data: data
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
}

/**
 *
 * @param discordId
 * @returns {Promise<*>}
 */
async function getUser(discordId)
{
    let User = await prisma.user.findUnique({
        where: {
            discordId: discordId,
        },
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
    if (!User) {
        User = await createUser({
            discordId: discordId,
            language: 'en',
            status: 'active',
            tdGames: 0,
            tdWins: 0,
            tdDraws: 0,
            tdLoses: 0,
        }).
        catch((e) => { throw e }).
        finally(async () => { await prisma.$disconnect() })
    }

    return User
}

/**
 *
 * @param User
 * @returns {Promise<*>}
 */
async function updateUser(User)
{

    return await prisma.user.update({
        where: { id: User.id },
        data: User
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
}

module.exports = {createUser, getUser, updateUser}