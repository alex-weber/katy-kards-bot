
const riapi = require("random-image-api")

const {
    getUser,
    updateUser,
    createMessage,
    getMessages,
    getSynonym,
    createSynonym
} = require('./db')
const search = require("./search");
const { searchLanguages }= require('./language.js')

async function main() {


    let command = 'leo'
    //for (const [, language] of Object.entries(searchLanguages)) {
        let variables = {
            "language": 'en',
            "q": command,
            "showSpawnables": true,
        }
        let response = await search.getCards(variables)
        const counter = response.data.data.cards.pageInfo.count
        let cards = response.data.data.cards.edges[0]
        console.log('cards found: ' + counter, cards.node.json)

        return
        for (let i = 0; i < 2; i = i+20)
        {
            let variables = {
                "language": 'en',
                "q": '',
                "showSpawnables": true,
                "offset": i,
            }
            let response = await search.getCards(variables)
            let cards = response.data.data.cards.edges
            for (const [, item] of Object.entries(cards))
            {
                let card = item.node
                card.title = card.json.title['en-EN']

                console.log(card)
            }
        }


   // }

}

async function cat()
{


    let catImage = await riapi.nekos("meow")
    console.log(catImage)

}

cat().catch((e) => {throw e})
    .finally(async () =>
    {
        console.log('Promise finalized')
    })