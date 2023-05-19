const {
    getUser,
    updateUser,
    createTopDeck,
    updateTopDeck,
    getRandomCard,
    getOpenTopDeck
} = require("./db")

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

    let topDeck = await getOpenTopDeck(channelID)
    //create a new top deck game
    if (!topDeck)
    {
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
            for (let i = 0; i < types.length; i++)
            {
                if (command.search(types[i]) !== -1)
                {
                    data['unitType'] = types[i]
                    break
                }
            }
        }

        return await createTopDeck(data)
    }
    //if it is the same player - do nothing
    else if (user.discordId === topDeck.player1) return topDeck
    //here comes the second player, so let's start the battle
    topDeck.player2 = user.discordId
    topDeck.state = 'running'
    await updateTopDeck(topDeck)

    return await battle(topDeck)
}

/**
 *
 * @param card
 * @returns String
 */
function getTitle(card)
{
    let titles = card.title.split('%%')

    return titles[0]
}

/**
 *
 * @param td
 * @returns {Promise<boolean>}
 */
async function battle(td)
{
    td.log = ''
    let kredits = Math.floor(Math.random() * 7) + 1
    if (kredits > 7) kredits = 7
    td.kredits = kredits
    td.card1 = await getRandomCard(td)
    td.card2 = await getRandomCard(td)
    //split languages to get the titles only in English
    td.card1.title = getTitle(td.card1)
    td.card2.title = getTitle(td.card2)
    let user1 = await getUser(td.player1)
    let user2 = await getUser(td.player2)
    td.card1.owner = user1
    td.card2.owner = user2
    let attacker = td.card1
    let defender = td.card2
    //randomize the attacker
    if (Math.floor(Math.random() * 2) + 1 === 2)
    {
        attacker = td.card2
        defender = td.card1
        td.log += attacker.title.toUpperCase() + ' attacks first\n'
    }
    //the battle begins
    let winner
    let loser
    while (attacker.defense > 0 || defender.defense > 0)
    {
        td.log += attacker.title.toUpperCase() + ' ' +
            attacker.attack + '/' + attacker.defense + ' -> ' +
            defender.title.toUpperCase() + ' ' +
            defender.attack + '/' + defender.defense + '\n'
        //hande damage
        let attack = attacker.attack
        let defAttack = defender.attack
        //check for heavy armor
        if (attacker.attributes.search('heavyArmor1') !== -1) defAttack--
        if (attacker.attributes.search('heavyArmor2') !== -1) defAttack = defAttack - 2
        if (defender.attributes.search('heavyArmor1') !== -1) attack--
        if (defender.attributes.search('heavyArmor2') !== -1) attack = attack - 2
        if (attack < 0) attack = 0
        //reverse damage
        if ((attacker.type === 'bomber' && defender.type === 'fighter') ||
            (defender.type !== 'bomber' && attacker.type !== 'artillery' && attacker.type !== 'bomber'))
        {
            //check for ambush
            if (defender.attributes.search('ambush') !== -1 && defAttack >= attacker.defense)
            {
                console.log('ambush!')
                attack = 0
            }
            attacker.defense -= defAttack
        }
        //deal damage
        defender.defense -= attack
        if (defender.defense < 1)
        {
            td.log += defender.title.toUpperCase() + ' destroyed\n'
        }

        if (attacker.defense < 1)
        {
            td.log += attacker.title.toUpperCase() + ' destroyed\n'
        }
        //console.log(attack, defAttack)
        if (attacker.defense < 1 && defender.defense > 0)
        {
            winner = defender.owner
            loser = attacker.owner
            td.winner = defender.owner.discordId
            td.loser = attacker.owner.discordId
            break
        } else if (defender.defense < 1 && attacker.defense > 0)
        {
            winner = attacker.owner
            loser = defender.owner
            td.winner = attacker.owner.discordId
            td.loser = defender.owner.discordId
            break
        } else if (defender.defense < 1 && attacker.defense < 1) break
        //switch sides and repeat
        let tmp = attacker
        attacker = defender
        defender = tmp
    }
    //finish the battle
    td.state = 'finished'
    //update user stats
    user1.tdGames = parseInt(user1.tdGames) + 1
    user2.tdGames = parseInt(user2.tdGames) + 1
    if (td.winner)
    {
        td.log += winner.name + ' wins'
        winner.tdWins = parseInt(winner.tdWins) + 1
        loser.tdLoses = parseInt(loser.tdLoses) + 1
        await updateUser(winner)
        await updateUser(loser)
    } else
    {
        user1.tdDraws = parseInt(user1.tdDraws) + 1
        user2.tdDraws = parseInt(user2.tdDraws) + 1
        await updateUser(user1)
        await updateUser(user2)
        td.log += 'draw'
    }
    await updateTopDeck(td)

    return td
}

/**
 *
 * @param user
 * @returns {string}
 */
function myTDRank(user)
{

    return user.name + '(' + (user.tdWins * 2 + user.tdDraws - user.tdLoses * 2).toString() + ')\n\n' +
        'Games: ' + user.tdGames.toString() + '\n' +
        'Wins: ' + user.tdWins.toString() + '\n' +
        'Draws: ' + user.tdDraws.toString() + '\n' +
        'Loses: ' + user.tdLoses.toString()
}

module.exports = {topDeck, myTDRank}