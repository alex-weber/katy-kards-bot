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

    const data = {
        cardId:         card.cardId,
        importId:       card.importId,
        imageURL:       card.imageUrl,
        thumbURL:       card.thumbUrl,
        title:          card.json.title['en-EN'] + '%%' + card.json.title['ru-RU'],
        text:           text,
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

module.exports = {createCard, getCardsDB}