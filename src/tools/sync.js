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
        let count = 0
        for (const [, item] of Object.entries(cards))
        {
            let card = item.node
            card.language = language
            createCard(card)
            count++
        }
        console.log(count, 'cards updated')

        //if (process.send) process.send('sync done')

    } catch (e) {
        console.log(e)
        return false
    }

    return true
}
//update all cards
syncDB().
catch((e) => {throw e}).
finally(async () => console.log('DB sync done'))