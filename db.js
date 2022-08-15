const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const { APILanguages }= require('./language.js')

/**
 *
 * @param data
 * @returns {Promise<*>}
 */
async function createUser(data) {

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
async function createMessage(User, content) {

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
async function getMessages(User) {

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
async function getUser(discordId) {

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
async function updateUser(User) {

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
async function getSynonym(key) {

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
async function createSynonym(key, value) {

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
async function createCard(card) {

  return await prisma.card.create({
    data: {
      cardId:         card.cardId,
      importId:       card.importId,
      imageURL:       card.imageURL,
      thumbURL:       card.thumbURL,
      set:            card.json.set,
      title:          prisma.title.create(
        {
        data: {
          title:    card.json.title,
          language: card.language
        }}),
      descriptions: {
        create: {
          language: card.language,
          content:  card.json.text[APILanguages[card.language]]
        },
      },
      type:           card.type,
      attack:         card.attack,
      defense:        card.defense,
      kredits:        card.kredits,
      operationCost:  card.operationCost,
      rarity:         card.rarity,
      faction:        card.faction,
    },
  }).
  catch((e) => { throw e }).finally(async () =>
  {
    await prisma.$disconnect()
    console.log('card ' + card.title + ' created')
  })
}

/**
 *
 * @param card
 * @returns {Promise<*>}
 */
async function getCard(card) {

  return await prisma.card.findUnique({
    where: {
      cardId: card.cardId,
    },
  }).
  catch((e) => { throw e }).
  finally(async () => { await prisma.$disconnect() })
}


module.exports = {
  getUser,
  createMessage,
  getMessages,
  updateUser,
  getSynonym,
  createSynonym,
  createCard,
  getCard,
}