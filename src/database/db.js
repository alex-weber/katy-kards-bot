const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const {
  createMessage,
  getMessages,
  getUserMessages,
  getProfileStats,
} = require('./message')
const { getUser, getUserById, updateUser } = require('./user')
const {createSynonym, updateSynonym, deleteSynonym, getAllSynonyms, getSynonym} = require('./synonym')
const  {createCard, getCardsDB, getCardsByFaction, getCardStatsMessage} = require('./card')
const {getRandomCard, getOpenTopDeck, getTopDeckStats, updateTopDeck, createTopDeck} = require('./topdeck')

//disconnect on app shutdown
async function disconnect()
{
  await prisma.$disconnect()
}

//exports
module.exports = {
  getUser,
  getUserById,
  createMessage,
  getMessages,
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
  getCardsByFaction,
  getRandomCard,
  getUserMessages,
  getProfileStats,
  getCardStatsMessage,
  disconnect,
}
