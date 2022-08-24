const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const dictionary = require('./dictionary')
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
    data: User
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
 * @param command
 * @returns {Promise<boolean|*>}
 */
async function topDeck(channelID, user, command = null)
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
    //essential data
    let data = {
      channelID: channelID,
      player1: user.discordId,
      state: 'open',
      log: ''
    }
    //check params in command
    if (command)
    {
      const types = ['infantry', 'artillery', 'bomber', 'fighter', 'tank']
      for (let i = 0; i < types.length; i++) {
        if (command.search(types[i]) !== -1) {
          data['unitType'] = types[i]
          break
        }
      }
    }

    return await prisma.topdeck.create({
      data: data
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
    }
  }
  if (td.kredits !== null && td.kredits > -1) data['kredits'] = parameters.kredits

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
 * @param td
 * @returns {Promise<boolean>}
 */
async function battle(td)
{

  td.log = ''
  td.card1 = await getRandomCard(td)
  td.card2 = await getRandomCard(td)
  let user1 = await getUser(td.player1)
  let user2 = await getUser(td.player2)
  td.card1.owner = user1
  td.card2.owner = user2
  let attacker = td.card1
  let defender = td.card2
  //the card with the lowest kredits attacks first. Otherwise, with blitz.
  if ((td.card2.kredits < td.card1.kredits) ||
      (td.card2.attributes.search('blitz') !== -1 && td.card1.attributes.search('blitz') === -1))
  {
    attacker = td.card2
    defender = td.card1
    td.log += attacker.title.toUpperCase() + ' costs less or has blitz, so it attacks first\n'
  }
  //the battle begins
  let winner
  let loser
  while (attacker.defense > 0 || defender.defense > 0)
  {
    td.log += attacker.title.toUpperCase() + ' ' +
      attacker.attack + '/' +attacker.defense+ ' -> ' +
      defender.title.toUpperCase() + ' ' +
      defender.attack + '/' +defender.defense+ '\n'
    //hande damage
    let attack = attacker.attack
    //check for heavy armor
    if (defender.attributes.search('heavyArmor1') !== -1) attack--
    if (defender.attributes.search('heavyArmor2')!== -1) attack = attack - 2
    if (attack < 0) attack = 0
    //check for ambush
    if (defender.attributes.search('ambush')!== -1 && defender.attack >= attacker.defense)
    {
      console.log('ambush!')
      attack = 0
    }
    //deal damage
    defender.defense -= attack
    if (defender.defense < 1) {
      td.log += defender.title.toUpperCase() + ' destroyed\n'
    }
    //count attacker's heavy armor on reverse damage
    if (
        (attacker.type === 'bomber' && defender.type === 'fighter') ||
        (defender.type !== 'bomber' && attacker.type !== 'artillery' && attacker.type !== 'bomber')
       )
    {
      let defAttack = defender.attack
      if (attacker.attributes.search('heavyArmor1') !== -1) defAttack--
      if (attacker.attributes.search('heavyArmor2')!== -1) defAttack = defAttack - 2
      attacker.defense -= defAttack
    }
    if (attacker.defense < 1) {
      td.log += attacker.title.toUpperCase() + ' destroyed\n'
    }
    //console.log(attacker, defender)
    if (attacker.defense < 1 && defender.defense > 0)
    {
      winner = defender.owner
      loser = attacker.owner
      td.winner = defender.owner.discordId
      td.loser = attacker.owner.discordId
      break
    }
    else if (defender.defense < 1 && attacker.defense > 0)
    {
      winner = attacker.owner
      loser = defender.owner
      td.winner = attacker.owner.discordId
      td.loser = defender.owner.discordId
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
    td.log += winner.name + ' wins'
    winner.tdWins = parseInt(winner.tdWins)   +1
    loser.tdLoses = parseInt(loser.tdLoses)   +1
    winner.tdGames = parseInt(winner.tdGames) +1
    loser.tdGames = parseInt(loser.tdGames)   +1
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

/**
 *
 * @returns {Promise<boolean|{color: number, description: string, title: string}>}
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

/**
 *
 * @param user
 * @returns {string}
 */
function myTDRank(user)
{
  return user.name + '(' +(user.tdWins*2 + user.tdDraws - user.tdLoses*2).toString()+ ')\n\n' +
    'Games: ' + user.tdGames.toString() + '\n' +
    'Wins: ' + user.tdWins.toString() + '\n' +
    'Draws: ' + user.tdDraws.toString() + '\n' +
    'Loses: ' + user.tdLoses.toString()

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
  getTopDeckStats,
  myTDRank,
  getRandomCard,
  updateTopDeck
}