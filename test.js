const search = require("./search");

async function slave(language) {
    let variables = { language : language, showSpawnables: true }
    variables.q = 'ass'
    let cards = await search.getCards(variables)
    console.log(cards)
    if (cards.counter) {
        let files = search.getFiles(cards, language)
        console.log(files)
    }
    else console.log('nothing...')

}

slave('en').catch((e) => {throw e}).finally(async () =>
    {
        console.log('Promise finalized')
    })

