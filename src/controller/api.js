const {getCardsByFaction} = require('../database/card')
const {
    getLastMonthMessages,
    getTopDeckMessages,
    getTopMessages,
    getTopUsers,
} = require("../database/message")

async function run(method)
{
    const response = {
        result: 200,
        success: false,
        message: `${method} ok!`,
        data: []
    }

    switch (method) {
        case 'cards-by-faction':
            response.success = true
            response.data = await getCardsByFaction()
            break
        case 'messages':
            response.success = true
            response.data = await getLastMonthMessages()
            break
        case 'td-messages':
            response.success = true
            response.data = await getTopDeckMessages()
            break
        case 'top-messages':
            response.success = true
            response.data = await getTopMessages()
            break
        case 'top-users':
            response.success = true
            response.data = await getTopUsers()
            break

        default:
            response.result = 404
            response.message = `${method} not found!`
    }

    return response
}

module.exports = {run}