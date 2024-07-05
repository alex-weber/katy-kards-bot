const {createCard} = require('../database/db')
const {getCards} = require("./search")

/**
 *
 * @returns {Promise<boolean>}
 */
async function syncDB()
{
    const language = 'en'
    console.log('starting DB sync...')

    const variables = {
        language: language,
        q: '',
        showSpawnables: true,
        showReserved: true,
        first: 10000
    }
    try {
        let response = await getCards(variables)
        //console.log(response)
        let cards = response.cards
        if (!cards.length) return false
        const cardsPromises = cards.map(async (cardItem) =>
        {
            let card = cardItem.node
            card.language = language
            await createCard(card)
        })

        try {
            let message = cards.length + ' cards total -> updating...'
            console.log(message)
            if (process.send) process.send(message)
            await Promise.all(cardsPromises)
            console.log('All cards created successfully')
        } catch (error) {
            console.error('Error creating cards:', error)
        }


    } catch (e) {
        console.log(e)
        return false
    }

    return true
}
//update all cards
syncDB().catch(console.log)