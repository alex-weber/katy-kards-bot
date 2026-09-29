const { prisma } = require('./prisma')
const {
  createMessage,
  getMessages,
  getUserMessages,
  getProfileStats,
  STATS_PERIODS,
} = require('./message')
const {
  getUser,
  getUserById,
  getUsers,
  getUserStatusCounts,
  createUserAudit,
  getRecentUserAudits,
  updateUser,
  updateUserAdminFields,
} = require('./user')
const {WEB_AUDIT_AREAS, createWebAudit, getWebAudits} = require('./webAudit')
const {createSynonym, updateSynonym, deleteSynonym, getAllSynonyms, getSynonym} = require('./synonym')
const  {createCard, getCardsDB, getCardsByFaction, getCardStats, getCardStatsMessage, FULL_TEXT_LOCALES} = require('./card')
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
  getUserStatusCounts,
  createUserAudit,
  getRecentUserAudits,
  WEB_AUDIT_AREAS,
  createWebAudit,
  getWebAudits,
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
  getCardStats,
  getCardStatsMessage,
  FULL_TEXT_LOCALES,
  STATS_PERIODS,
  disconnect,
}
