const { createCard } = require('./db')
const search = require("./search");

async function syncDB()
{
  let language = 'en'
  for (let i = 0; i < 10000; i = i+20)
  {
    console.log('cards done: '+ i)

    let variables = {
      "language": language,
      "q": '',
      "showSpawnables": true,
      "offset": i,
    }
    let response = await search.getCards(variables)
    //console.log(response)
    let cards = response.cards
    if (!cards.length) break
    for (const [, item] of Object.entries(cards))
    {
      let card = item.node
      card.language = language
      await createCard(card)
    }

  }
}

syncDB().catch((e) => {throw e}).finally(async () =>
{
  console.log('DB sync done')
})