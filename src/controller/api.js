const {getCardsByFaction} = require('../database/card')
const {response} = require("express");

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
            response.data = await getCardsByFaction(method)
            break

        default:
            response.result = 404
            response.message = `${method} not found!`
    }

    return response
}

module.exports = {run}