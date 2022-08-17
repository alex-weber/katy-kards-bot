const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const { APILanguages }= require('./language.js')


/**
 *
 * @param data
 * @returns {Promise<*>}
 */
async function createUser(data)
{

  return await prisma.user.create({
    data: {
      discordId: data.discordId,
      language: data.language,
      messages: {
        create: { content: data.message },
      }
    }
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
    data: { language: User.language }
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


//exports
module.exports = {
  getUser,
  createMessage,
  getMessages,
  updateUser,
  getSynonym,
  createSynonym,
  createCard,
  cardExists,
  getCardsDB,
}