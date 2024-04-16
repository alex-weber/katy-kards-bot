const {createCard} = require('../database/db')
const {getCards} = require("./search")

/**
 *
 * @returns {Promise<void>}
 */
async function syncDB()
{
    let language = 'en'
    console.log('starting DB sync...')
    for (let i = 0; i < 10000; i = i + 20)
    {
        console.log('cards done: ' + i)

        let variables = {
            language: language,
            q: '',
            showSpawnables: true,
            showReserved: true,
            offset: i,
        }
        try {
            let response = await getCards(variables)
            //console.log(response)
            let cards = response.cards
            if (!cards.length) break
            for (const [, item] of Object.entries(cards))
            {
                let card = item.node
                card.language = language
                await createCard(card)
            }
        } catch (e) {
            i = i -20
            continue
        }
    }
}
//update all cards
syncDB().catch((e) => {throw e}).finally(async () =>
{
    console.log('DB sync done')
})