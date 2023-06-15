const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

/**
 *
 * @param data
 * @returns {Promise<*>}
 */
async function createUser(data)
{

  return await prisma.user.create({
    data: data
  }).
  catch((e) => { throw e }).
  finally(async () => { await prisma.$disconnect() })
}

/**
 *
 * @param discordId
 * @returns {Promise<*>}
 */
async function getUser(discordId)
{
  let User = await prisma.user.findUnique({
    where: {
      discordId: discordId,
    },
  }).
  catch((e) => { throw e }).
  finally(async () => { await prisma.$disconnect() })
  if (!User) {
    User = await createUser({
      discordId: discordId,
      language: 'en',
      status: 'active',
      tdGames: 0,
      tdWins: 0,
      tdDraws: 0,
      tdLoses: 0,
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
  }

  return User
}

/**
 *
 * @param User
 * @returns {Promise<*>}
 */
async function updateUser(User)
{

  return await prisma.user.update({
    where: { id: User.id },
    data: User
  }).
  catch((e) => { throw e }).
  finally(async () => { await prisma.$disconnect() })
}

/**
 * @returns {Promise<*>}
 */
async function getAllSynonyms()
{

  return await prisma.synonym.findMany().
  catch((e) => { throw e }).
  finally(async () => { await prisma.$disconnect() })
}

/**
 *
 * @param key
 * @returns {Promise<*>}
 */
async function getSynonym(key)
{

  return await prisma.synonym.findUnique({
    where: {
      key: key,
    },
  }).
  catch((e) => { throw e }).
  finally(async () => { await prisma.$disconnect() })
}

/**
 *
 * @param key
 * @param value
 * @returns {Promise<*>}
 */
async function createSynonym(key, value)
{
  if (typeof key !== 'string' || typeof value !== 'string') return

  return await prisma.synonym.create({
    data: {
      key: key,
      value: value,
    },
  }).
  catch((e) => { throw e }).
  finally(async () => { await prisma.$disconnect() })
}

/**
 *
 * @param key
 * @param value
 * @returns {Promise<*>}
 */
async function updateSynonym(key, value)
{
  if (typeof value !== 'string') return

  return await prisma.synonym.update({
    where: { key: key },
    data: {
      value: value,
    },
  }).
  catch((e) => { throw e }).
  finally(async () => { await prisma.$disconnect() })
}

/**
 *
 * @param key
 * @returns {Promise<*>}
 */
async function deleteSynonym(key)
{

  return await prisma.synonym.delete({
    where: { key: key }
  }).
  catch((e) => { throw e }).
  finally(async () => { await prisma.$disconnect() })
}

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
        attributes:     card.json.attributes.toString(),
        exile:          exile.toLowerCase(),
  }

  if (await cardExists(card))
  {

    return await prisma.card.update({ where: { cardId: card.cardId}, data: data }).
    catch((e) => { throw e }).finally(async () =>
    {
      await prisma.$disconnect()
      console.log('card ' + card.cardId + ' updated')
    })
  }

  return await prisma.card.create({ data: data }).
  catch((e) => { throw e }).finally(async () =>
  {
    await prisma.$disconnect()
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
  catch((e) => { throw e }).
  finally(async () => { await prisma.$disconnect() })
}

/**
 *
 * @param data
 * @returns {Promise<*>}
 */
async function getCardsDB(data)
{

  return await prisma.card.findMany({
    where: data,
  }).
  catch((e) => { throw e }).
  finally(async () => { await prisma.$disconnect() })
}

/**
 *
 * @param channelID
 * @returns topDeck
 */
async function getOpenTopDeck(channelID)
{

  return await prisma.topdeck.findFirst({
    where: {
      state: 'open',
      channelID: channelID,
    },
  }).
  catch((e) => { throw e }).
  finally(async () => { await prisma.$disconnect() })
}

/**
 *
 * @param data
 * @returns {Promise<*>}
 */
async function createTopDeck(data)
{

    return await prisma.topdeck.create({
      data: data
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
}

/**
 *
 * @param td
 * @returns {Promise<*>}
 */
async function updateTopDeck(td)
{
  return await prisma.topdeck.update({
    where: { id: td.id },
    data: {
      player2: td.player2,
      state: td.state,
      winner: td.winner,
      loser: td.loser,
      log: td.log,
    }
  }).
  catch((e) => { throw e }).
  finally(async () => { await prisma.$disconnect() })
}

/**
 *
 * @param td
 * @returns Card
 */
async function getRandomCard(td)
{
  let types = ['infantry', 'tank', 'artillery', 'fighter', 'bomber']
  if (td.unitType && types.includes(td.unitType)) {
    types = [td.unitType]
  }
  let data =
  {
    type: { in: types },
    attack: {
      gt: 0,
    },
    kredits: td.kredits
  }
  let cards = await prisma.card.findMany({
    where: data
  }).
  catch((e) => { throw e }).
  finally(async () => { await prisma.$disconnect() })
  //shuffle the found cards
  let position = Math.floor(Math.random() * cards.length)

  return cards[position]
}

/**
 *
 * @returns String
 */
async function getTopDeckStats()
{
  const users = await prisma.user.findMany({
    where: {
      tdGames: {
        gt: 0,
      }
    },
  }).
  catch((e) => { throw e }).
  finally(async () => { await prisma.$disconnect() })

  if (!users) return false

  let answer = 'TD Ranking\n\n'
  answer += '(Wins x 2 + Draws - Loses x 2)\n\n'
  let ranking = []
  for (const [, user] of Object.entries(users))
  {
    user.score = user.tdWins*2 + user.tdDraws - user.tdLoses*2
    ranking.push(user)
  }
  ranking.sort((a, b) => b.score - a.score)
  let counter = 1
  ranking.forEach((user) => {
    if (counter > 9) return
    answer += counter +': ' + user.name + ' ('+ user.score +')\n'
    counter++
  })

  return answer
}

//exports
module.exports = {
  getUser,
  updateUser,
  createTopDeck,
  updateTopDeck,
  getOpenTopDeck,
  getTopDeckStats,
  getAllSynonyms,
  getSynonym,
  createSynonym,
  updateSynonym,
  deleteSynonym,
  createCard,
  getCardsDB,
  getRandomCard,
}