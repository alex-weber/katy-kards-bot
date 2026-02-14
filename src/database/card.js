const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const APILanguages = require('../tools/language')

const cardStats = {
    created: 0,
    updated: 0,
}

function getCardStatsMessage() {

    if (!cardStats.created && !cardStats.updated) return 'No changes detected'

    return `Created: ${cardStats.created}\nUpdated: ${cardStats.updated}`
}


/**
 *
 * @param card
 * @returns {Promise<*>}
 */
async function createCard(card) {
    normalizeCardJson(card.json)

    const text = buildText(card.json)
    const fullText = buildFullText(card.json)
    const exile = card.json.exile ? card.json.exile : ''

    const data = buildCardData(card, text, fullText, exile)

    const existing = await prisma.card.findUnique({ where: { cardId: card.cardId } })

    if (existing) {
        if (hasChanges(existing, data)) {
            await prisma.card.update({
                where: { cardId: card.cardId },
                data
            })
            cardStats.updated++
        }
        return
    }

    await prisma.card.create({ data })
    cardStats.created++
}

/* --- helpers --- */

function normalizeCardJson(json) {
    if (json.type === 'order' || json.type === 'countermeasure') {
        json.attack = null
        json.defense = null
        json.operationCost = null
    }
    if (!json.hasOwnProperty('attributes')) {
        json.attributes = ''
    }
}

function buildText(json) {
    if (json.hasOwnProperty('text') && json.text.hasOwnProperty('en-EN')) {
        return json.text['en-EN'].toLowerCase()
    }
    return ''
}

function buildFullText(json) {
    let fullText = ''

    // deduplicate locale codes
    const locales = [...new Set(Object.values(APILanguages.APILanguages))]

    for (const locale of locales) {
        if (json.title?.[locale]) {
            fullText += json.title[locale] + ' '
        }
        if (json.text?.[locale]) {
            fullText += json.text[locale] + ' '
        }
    }

    if (json.type) {
        fullText += json.type.toLowerCase() + ' '
    }

    if (json.attributes) {
        fullText += json.attributes.toString().toLowerCase() + ' '
    }

    if (json.hasOwnProperty('exile')) {
        fullText += 'exile изгнание '
    }


    return fullText.trim()
}


function buildCardData(card, text, fullText, exile) {
    return {
        cardId: card.cardId,
        importId: card.importId,
        imageURL: card.imageUrl,
        thumbURL: card.thumbUrl,
        title: card.json.title['en-EN'],
        text,
        fullText,
        set: card.json.set.toLowerCase(),
        type: card.json.type.toLowerCase(),
        attack: card.json.attack,
        defense: card.json.defense,
        kredits: card.json.kredits,
        operationCost: card.json.operationCost,
        rarity: card.json.rarity.toLowerCase(),
        faction: card.json.faction.toLowerCase(),
        attributes: card.json.attributes.toString().toLowerCase(),
        exile: exile.toLowerCase(),
        reserved: card.reserved
    }
}

function hasChanges(existing, data) {
    for (const key of Object.keys(data)) {
        if (existing[key] !== data[key]) {
            return true
        }
    }
    return false
}

/**
 *
 * @param data
 * @param skip
 * @returns {Promise<*>}
 */
async function getCardsDB(data, skip = 0)
{

    return await prisma.card.findMany({
        where: data,
        skip: skip,
        orderBy: {
            kredits: 'asc',
        },
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
}

async function getCardsByFaction()
{
    const groupedCards = await prisma.card.groupBy({
        by: ['faction'], // group by faction
        _count: {
            faction: true // count the number of records in each faction group
        },
        orderBy: {
            _count: {
                faction: 'desc' // order by the count of faction in descending order
            }
        },
    })

    return groupedCards.map(group => ({
        faction: group.faction,
        count: group._count.faction
    }))

}

module.exports = {
    getCardsByFaction,
    createCard,
    getCardsDB,
    getCardStatsMessage,
}