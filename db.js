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
 * @param User
 * @param content
 * @returns {Promise<*>}
 */
async function createMessage(User, content)
{

  return await prisma.message.create({
    data: {
      authorId: User.id,
      content: content,
    }
  }).
  catch((e) => { throw e }).
  finally(async () => { await prisma.$disconnect() })

}

/**
 *
 * @param User
 * @returns {Promise<*>}
 */
async function getMessages(User)
{

  return await prisma.message.findMany({
    where: {
      authorId: User.id,
      content: {
        not: null,
      },
    },
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
    data: {
      language: User.language,
      role: User.role,
      status: User.status
    }
  }).
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
  if (!card.json.hasOwnProperty('attributes')) {
    card.json.attributes = ''
  }


  const data = {
        cardId:         card.cardId,
        importId:       card.importId,
        imageURL:       card.imageUrl,
        thumbURL:       card.thumbUrl,
        set:            card.json.set.toLowerCase(),
        type:           card.json.type.toLowerCase(),
        attack:         card.json.attack,
        defense:        card.json.defense,
        kredits:        card.json.kredits,
        operationCost:  card.json.operationCost,
        rarity:         card.json.rarity.toLowerCase(),
        faction:        card.json.faction.toLowerCase(),
        attributes:     card.json.attributes.toString()
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

  //set title and description if available
  if (card.json.text !== undefined) {
    let descriptions = []
    for (const [key, value] of Object.entries(card.json.text)) {
      let desc = { language: key, content: value}
      descriptions.push(desc)
    }
    data.description = { create: descriptions }
  }
  let titles = []
  for (const [key, value] of Object.entries(card.json.title)) {
    let title = { language: key, content: value }
    titles.push(title)

  }
  data.title = { create: titles }

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
 * @param user
 * @returns {Promise<*>}
 */
async function topDeck(channelID, user)
{

  let topDeck = await prisma.topdeck.findFirst({
    where: {
      state: 'open',
      channelID: channelID,
    },
  }).
  catch((e) => { throw e }).
  finally(async () => { await prisma.$disconnect() })
  //create a new top deck game
  if (!topDeck) {

    await prisma.topdeck.create({
      data: {
        channelID: channelID,
        player1: user.discordId,
        state: 'open'
      }
    })

    return 'Waiting for another player'
  }
  //if it is the same player - do nothing
  else if (user.discordId === topDeck.player1) {

    return 'still waiting for another player'
  }
  //here comes the second player, so let's start the battle
  topDeck.player2 = user.discordId
  topDeck.state = 'running'
  await updateTopDeck(topDeck)

  return await battle(topDeck)

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
 * @returns {Promise<*>}
 */
async function getRandomCard()
{
  let cards = await prisma.card.findMany({
    where: {
      type: { in: ['infantry', 'tank', 'artillery', 'fighter', 'bomber'] },
    },
  }).
  catch((e) => { throw e }).
  finally(async () => { await prisma.$disconnect() })
  //shuffle the found cards
  let position = Math.floor(Math.random() * cards.length)

  return cards[position]

}

/**
 *
 * @param td
 * @returns {Promise<boolean>}
 */
async function battle(td)
{
  let log = ''
  td.log = ''
  let card1 = await getRandomCard()
  let card2 = await getRandomCard()
  let attacker = card1
  let defender = card2
  if (card2.attributes.search('blitz') !== -1 && card1.attributes.search('blitz') === -1)
  {
    attacker = card2
    defender = card1
    td.lod += attacker.cardId + ' has blitz, so it attacks first*'
  }
  attacker['discordId'] = td.player1
  defender['discordId'] = td.player2
  console.log(attacker.type, defender.type)
  while (attacker.defense > 0 || defender.defense > 0)
  {
    //console.log(attacker, defender)
    log = attacker.cardId + ' ' +
      attacker.attack + '/' +attacker.defense+ ' -> ' +
      defender.cardId + ' ' +
      defender.attack + '/' +defender.defense+ '*'
    td.log += log
    //hande damage
    defender.defense -= attacker.attack
    if (defender.defense < 1) {
      td.log += defender.cardId + ' destroyed*'
    }
    if (
      (attacker.type === 'bomber' && defender.type === 'fighter') ||
      (defender.type !== 'bomber' && attacker.type !== 'artillery' && attacker.type !== 'bomber')
    )
    {
      attacker.defense -= defender.attack
      console.log(attacker.cardId, 'attacks and takes', defender.attack, 'damage')
    }
    if (attacker.defense < 1) {
      td.log += attacker.cardId + ' destroyed*'
    }
    //console.log(attacker, defender)
    if (attacker.defense < 1 && defender.defense > 0)
    {
      td.winner = defender.discordId
      td.loser = attacker.discordId
      break
    }
    else if (defender.defense < 1 && attacker.defense > 0)
    {
      td.winner = attacker.discordId
      td.loser = defender.discordId
      break
    }
    else if (defender.defense < 1 && attacker.defense < 1) break
    //switch sides
    let tmp = attacker
    attacker = defender
    defender = tmp

  }
  td.state = 'finished'
  if (td.winner) td.log += td.winner + ' wins'
  else td.log += 'draw'
  let lines = td.log.split('*')
  console.log(lines)
  await updateTopDeck(td)

  return td
}

//exports
module.exports = {
  getUser,
  createMessage,
  getMessages,
  updateUser,
  getSynonym,
  createSynonym,
  createCard,
  getCardsDB,
  topDeck,
  getRandomCard,
  updateTopDeck
}