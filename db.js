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
      status: User.status,
      name: User.name,
      tdGames: User.tdGames,
      tdWins: User.tdWins,
      tdLoses: User.tdLoses,
      tdDraws: User.tdDraws,
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
      key: key.toString(),
      value: value.toString(),
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
  if (!card.json.hasOwnProperty('attributes')) card.json.attributes = ''
  let text = ''
  if (card.json.hasOwnProperty('text')) text = card.json.text['en-EN']

  const data = {
        cardId:         card.cardId,
        importId:       card.importId,
        imageURL:       card.imageUrl,
        thumbURL:       card.thumbUrl,
        title:          card.json.title['en-EN'].toLowerCase(),
        text:           text,
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
  //set all stats to zero if it's the first game
  if (!user.tdGames)
  {
    user.tdGames = 0
    user.tdWins = 0
    user.tdLoses = 0
    user.tdDraws = 0
    await updateUser(user)
  }

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

    return await prisma.topdeck.create({
      data: {
        channelID: channelID,
        player1: user.discordId,
        state: 'open',
        log: ''
      }
    })
  }
  //if it is the same player - do nothing
  else if (user.discordId === topDeck.player1) {

    return topDeck
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
 * @returns Card
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

  td.log = ''
  td.card1 = await getRandomCard()
  td.card2 = await getRandomCard()
  let attacker = td.card1
  let defender = td.card2
  if (td.card2.attributes.search('blitz') !== -1 && td.card1.attributes.search('blitz') === -1)
  {
    attacker = td.card2
    defender = td.card1
    td.log += attacker.title.toUpperCase() + ' has blitz, so it attacks first\n'
  }
  attacker['discordId'] = td.player1
  let user1 = await getUser(td.player1)
  attacker['name'] = user1.name
  let user2 = await getUser(td.player2)
  defender['name'] = user2.name
  defender['discordId'] = td.player2

  td.log += attacker.name +' '+ attacker.title.toUpperCase() +'[' + attacker.type + '] ' +
    ' vs ' + defender.name +' '+ defender.title.toUpperCase() +'[' + defender.type + ']\n'

  while (attacker.defense > 0 || defender.defense > 0)
  {
    td.log += attacker.title.toUpperCase() + ' ' +
      attacker.attack + '/' +attacker.defense+ ' -> ' +
      defender.title.toUpperCase() + ' ' +
      defender.attack + '/' +defender.defense+ '\n'
    //hande damage

    defender.defense -= attacker.attack
    if (defender.defense < 1) {
      td.log += defender.title.toUpperCase() + ' destroyed\n'
    }
    if (
      (attacker.type === 'bomber' && defender.type === 'fighter') ||
      (defender.type !== 'bomber' && attacker.type !== 'artillery' && attacker.type !== 'bomber')
    )
    {
      attacker.defense -= defender.attack
    }
    if (attacker.defense < 1) {
      td.log += attacker.title.toUpperCase() + ' destroyed\n'
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
  //update user stats
  if (td.winner)
  {
    let winner = await getUser(td.winner)
    let loser = await getUser(td.loser)
    td.log += winner.name + ' wins'
    winner.tdWins = parseInt(winner.tdWins) +1
    loser.tdLoses = parseInt(loser.tdLoses) +1
    winner.tdGames = parseInt(winner.tdGames) +1
    loser.tdGames = parseInt(loser.tdGames) +1
    await updateUser(winner)
    await updateUser(loser)

  }
  else
  {
    user1.tdDraws = parseInt(user1.tdDraws) +1
    user2.tdDraws = parseInt(user2.tdDraws) +1
    user1.tdGames = parseInt(user1.tdGames) +1
    user2.tdGames = parseInt(user2.tdGames) +1
    await updateUser(user1)
    await updateUser(user2)
    td.log += 'draw'
  }


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