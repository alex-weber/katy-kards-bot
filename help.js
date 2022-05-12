const { MessageEmbed } = require('discord.js');
const helpEmbed = new MessageEmbed()
    .setColor('#ff3300')
    .setTitle('Welcome to help!')
    .addFields(
        {
            name: '!!',
            value: 'Steam players online and stats'
        },
        {
            name: '!leo',
            value: 'will find the Leopold',
            inline: true },
        {
            name: '!usa infantry blitz 3k',
            value: 'will find all USA infantry blitz for 3K',
            inline: true },
    )
    .addField('!en [de|es|ft|it|pl|pt|ru|zh]',
        'change the search language',
        true)
    .setTimestamp()
    .setFooter({ text: 'Katyusha KARDS bot' })

module.exports = { helpEmbed }