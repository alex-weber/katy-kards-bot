const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

/**
 *
 * @param channelID
 * @returns topDeck
 */
async function getOpenTopDeck(channelID)
{

    return await prisma.topdeck.findFirst({
        where: {
            state: 'open',
            channelID: channelID,
        },
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
}

/**
 *
 * @param data
 * @returns {Promise<*>}
 */
async function createTopDeck(data)
{

    return await prisma.topdeck.create({
        data: data
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
}

/**
 *
 * @param td
 * @returns {Promise<*>}
 */
async function updateTopDeck(td)
{
    return await prisma.topdeck.update({
        where: { id: td.id },
        data: {
            player2: td.player2,
            state: td.state,
            winner: td.winner,
            loser: td.loser,
            log: td.log,
        }
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
}

/**
 *
 * @param td
 * @returns Card
 */
async function getRandomCard(td)
{
    let types = ['infantry', 'tank', 'artillery', 'fighter', 'bomber']
    if (td.unitType && types.includes(td.unitType)) {
        types = [td.unitType]
    }
    let data =
        {
            type: { in: types },
            attack: {
                gt: 0,
            },
            kredits: td.kredits
        }
    let cards = await prisma.card.findMany({
        where: data
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
    //shuffle the found cards
    let position = Math.floor(Math.random() * cards.length)

    return cards[position]
}

/**
 *
 * @returns Promise
 */
async function getTopDeckStats()
{
    const ranking = await getTopDeckRanking(20)
    if (!ranking) return false

    let answer = 'TD Ranking\n\n'
    answer += '(Wins x 2 + Draws - Loses x 2)\n\n'
    ranking.forEach((user, index) => {
        answer += index + 1 +'. ' +
            `${user.name} (${user.score}) W:${user.tdWins} L:${user.tdLoses} D:${user.tdDraws} WR:${user.winRatio}\n`
    })

    return answer
}

function buildTopDeckRanking(users, limit = 100)
{
    const ranking = []
    for (const [, user] of Object.entries(users))
    {
        const tdGames = parseInt(user.tdGames, 10) || 0
        const tdWins = parseInt(user.tdWins, 10) || 0
        const tdLoses = parseInt(user.tdLoses, 10) || 0
        const tdDraws = parseInt(user.tdDraws, 10) || 0
        ranking.push({
            id: user.id,
            discordId: user.discordId,
            name: user.name || 'Unknown',
            tdGames,
            tdWins,
            tdLoses,
            tdDraws,
            score: tdWins * 2 + tdDraws - tdLoses * 2,
            winRatio: tdGames ? (tdWins / tdGames).toFixed(2) : '0.00',
        })
    }

    ranking.sort((a, b) => b.score - a.score || b.tdWins - a.tdWins || b.tdGames - a.tdGames)
    return ranking.slice(0, limit)
}

async function getTopDeckRanking(limit = 100)
{
    const users = await prisma.user.findMany({
        where: {
            tdGames: {
                gt: 0,
            }
        },
        select: {
            id: true,
            discordId: true,
            name: true,
            tdGames: true,
            tdWins: true,
            tdLoses: true,
            tdDraws: true,
        }
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })

    if (!users) return false

    return buildTopDeckRanking(users, limit)
}

module.exports = {
    getRandomCard,
    getOpenTopDeck,
    getTopDeckStats,
    getTopDeckRanking,
    buildTopDeckRanking,
    updateTopDeck,
    createTopDeck,
}
