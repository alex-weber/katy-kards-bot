const { prisma } = require('./prisma')
const dictionary = require('../tools/dictionary')

const cardStats = {
    created: 0,
    updated: 0,
}

function getCardStatsMessage() {

    if (!cardStats.created && !cardStats.updated) return 'No changes detected'

    return `Created: ${cardStats.created}\nUpdated: ${cardStats.updated}`
}

/**
 * The same counters as getCardStatsMessage(), unformatted — the system page
 * widget stores and renders the numbers itself.
 *
 * @returns {{created: number, updated: number}}
 */
function getCardStats() {
    return {...cardStats}
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
    const locales = ['en-EN', 'ru-RU', 'ja-JP', 'ko-KR', 'zh-Hant', 'zh-Hans']

    for (const locale of locales) {
        if (json.title?.[locale]) {
            fullText += json.title[locale] + ' '
        }
        if (json.text?.[locale]) {
            fullText += json.text[locale] + ' '
        }
    }
    //add abbreviation to full text
    fullText += getAbbreviation(json.title?.['en-EN']) + ' '

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

/**
 *
 * @param title
 * @returns {string}
 */
function getAbbreviation(title) {

    if (!title) return ''

    const words = title.split(' ')
    if (words.length < 2) return ''

    const disallowed = /^\d+$/ // only digits

    const filtered = words.
        filter(word => word.length > 1).
        filter(word => !disallowed.test(word))
    if (filtered.length < 2) return ''

    const abbreviation = filtered
        .map(word => word.charAt(0))
        .join('')
    //the length of the abbreviation should be at least 3 letters
    if (abbreviation.length < 3) return ''

    return abbreviation
}


function buildCardData(card, text, fullText, exile) {
    return {
        cardId: card.cardId,
        importId: card.importId,
        imageURL: card.imageUrl,
        thumbURL: card.thumbUrl,
        title: card.json?.title?.['en-EN'] || '',
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
    })
}

async function getCardsByFaction()
{
    // Grouped by reserve status too, so the overview can show active/reserved totals.
    const groupedCards = await prisma.card.groupBy({
        by: ['faction', 'reserved'],
        _count: { _all: true },
    })

    const byFaction = new Map()
    for (const group of groupedCards) {
        const entry = byFaction.get(group.faction) || { faction: group.faction, count: 0, active: 0, reserved: 0 }
        entry.count += group._count._all
        entry[group.reserved ? 'reserved' : 'active'] += group._count._all
        byFaction.set(group.faction, entry)
    }

    return [...byFaction.values()].sort((a, b) => b.count - a.count)
}

function zeroCounts(keys) {
    return Object.fromEntries(keys.map(key => [key, 0]))
}

function emptyCardStats() {
    return {
        total: 0,
        rarity: zeroCounts(dictionary.rarity),
        type: zeroCounts(dictionary.type),
        attribute: zeroCounts(dictionary.attribute),
    }
}

function countInto(counts, key) {
    if (Object.hasOwn(counts, key)) counts[key]++
}

/**
 * Rarity, type and attribute counts for one faction, computed for all cards and
 * again for active and reserved ones, so the page can switch between them
 * without another request. Only the attribute keywords listed in dictionary.js
 * are counted — stored values like "veteranof:*" or "heavyarmor1" are ignored.
 *
 * @param faction
 * @returns {Promise<{all: object, active: object, reserved: object}>}
 */
async function getFactionCardStats(faction)
{
    const cards = await prisma.card.findMany({
        where: { faction },
        select: { rarity: true, type: true, attributes: true, reserved: true },
    })

    const stats = {
        all: emptyCardStats(),
        active: emptyCardStats(),
        reserved: emptyCardStats(),
    }

    for (const card of cards) {
        const attributes = new Set((card.attributes || '').split(',').map(attribute => attribute.trim()))
        const buckets = [stats.all, card.reserved ? stats.reserved : stats.active]

        for (const bucket of buckets) {
            bucket.total++
            countInto(bucket.rarity, card.rarity)
            countInto(bucket.type, card.type)
            for (const attribute of attributes) countInto(bucket.attribute, attribute)
        }
    }

    return stats
}

module.exports = {
    getCardsByFaction,
    getFactionCardStats,
    createCard,
    getCardsDB,
    getCardStats,
    getCardStatsMessage,
}