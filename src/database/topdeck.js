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
    const users = await prisma.user.findMany({
        where: {
            tdGames: {
                gt: 0,
            }
        },
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })

    if (!users) return false

    let answer = 'TD Ranking\n\n'
    answer += '(Wins x 2 + Draws - Loses x 2)\n\n'
    let ranking = []
    for (const [, user] of Object.entries(users))
    {
        user.score = user.tdWins*2 + user.tdDraws - user.tdLoses*2
        user.winRatio = (user.tdWins / user.tdGames).toFixed(2)
        ranking.push(user)
    }
    ranking.sort((a, b) => b.score - a.score)
    let counter = 1
    ranking.forEach((user) => {
        if (counter > 20) return
        answer += counter +'. ' +
            `${user.name} (${user.score}) W:${user.tdWins} L:${user.tdLoses} D:${user.tdDraws} WR:${user.winRatio}\n`
        counter++
    })

    return answer
}

module.exports = {getRandomCard, getOpenTopDeck, getTopDeckStats, updateTopDeck, createTopDeck}