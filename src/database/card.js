const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

/**
 *
 * @param card
 * @returns {Promise<*>}
 */
async function createCard(card)
{
    if (card.json.type === 'order' || card.json.type === 'countermeasure')
    {
        card.json.attack = null
        card.json.defense = null
        card.json.operationCost = null
    }
    if (!card.json.hasOwnProperty('attributes')) card.json.attributes = ''
    let text = ''
    if (card.json.hasOwnProperty('text') && card.json.text.hasOwnProperty('en-EN'))
    {
        //console.log(card.json.text)
        text = card.json.text['en-EN'].toLowerCase() + '%%' + card.json.text['ru-RU'].toLowerCase()
    }
    let exile = ''
    if (card.json.hasOwnProperty('exile')) exile = card.json.exile

    let fullText =
        card.json.title['en-EN'] + ' ' +
        card.json.title['ru-RU'] + ' ' +
        card.json.type.toLowerCase() + ' ' +
        card.json.attributes.toString().toLowerCase()
    if (text.length) fullText += text

    const data = {
        cardId:         card.cardId,
        importId:       card.importId,
        imageURL:       card.imageUrl,
        thumbURL:       card.thumbUrl,
        title:          card.json.title['en-EN'] + '%%' + card.json.title['ru-RU'],
        text:           text,
        fullText:       fullText,
        set:            card.json.set.toLowerCase(),
        type:           card.json.type.toLowerCase(),
        attack:         card.json.attack,
        defense:        card.json.defense,
        kredits:        card.json.kredits,
        operationCost:  card.json.operationCost,
        rarity:         card.json.rarity.toLowerCase(),
        faction:        card.json.faction.toLowerCase(),
        attributes:     card.json.attributes.toString().toLowerCase(),
        exile:          exile.toLowerCase(),
        reserved:       card.reserved,
    }

    if (await cardExists(card))
    {

        return await prisma.card.update({ where: { cardId: card.cardId}, data: data }).
        catch((e) => { throw e }).finally(async () =>
        {
            //await prisma.$disconnect()
            console.log('card ' + card.cardId + ' updated')
        })
    }

    return await prisma.card.create({ data: data }).
    catch((e) => { throw e }).finally(async () =>
    {
        //await prisma.$disconnect()
        console.log('card ' + card.cardId + ' created')
    })
}

/**
 *
 * @param card
 * @returns {Promise<*>}
 */
async function cardExists(card) {

    return await prisma.card.findUnique({
        where: {
            cardId: card.cardId,
        },
    }).
    catch((e) => { throw e })
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

module.exports = {getCardsByFaction, createCard, getCardsDB}