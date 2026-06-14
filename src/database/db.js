const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const {
  createMessage,
  getMessages,
  getUserMessages,
  getProfileStats,
} = require('./message')
const {
  getUser,
  getUserById,
  getUsers,
  updateUser,
  updateUserAdminFields,
} = require('./user')
const {createSynonym, updateSynonym, deleteSynonym, getAllSynonyms, getSynonym} = require('./synonym')
const  {createCard, getCardsDB, getCardsByFaction, getCardStatsMessage} = require('./card')
const {
  getRandomCard,
  getOpenTopDeck,
  getTopDeckStats,
  getTopDeckRanking,
  updateTopDeck,
  createTopDeck,
} = require('./topdeck')

//disconnect on app shutdown
async function disconnect()
{
  await prisma.$disconnect()
}

//exports
module.exports = {
  getUser,
  getUserById,
  getUsers,
  createMessage,
  getMessages,
  updateUser,
  updateUserAdminFields,
  createTopDeck,
  updateTopDeck,
  getOpenTopDeck,
  getTopDeckStats,
  getTopDeckRanking,
  getAllSynonyms,
  getSynonym,
  createSynonym,
  updateSynonym,
  deleteSynonym,
  createCard,
  getCardsDB,
  getCardsByFaction,
  getRandomCard,
  getUserMessages,
  getProfileStats,
  getCardStatsMessage,
  disconnect,
}
