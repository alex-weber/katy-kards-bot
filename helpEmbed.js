
 const helpEmbed =
 {
    "type": `rich`,
    "title": `Help`,
    "description": `The hosting costs 12$ a month. (Heroku Hobby 7$ + pgSQL mini 5$). \n
    Supporters will get VIP permissions for creating custom bot commands. \n
    Click on the title to donate.`,
    "color": 0x0048ff,
    "fields": [
        {
            "name": `Advanced search`,
            "value": `The first 3 charachters of a word are used to search for attributes. \n
            All not found words are added to a full string search in title and text.\n \n
            3k               -  Deployment cost\n
            2c or 2op  -  Operation cost\n
            5-5 or 5/5  - Five attack and five defense\n
            */8              - Any attack and 8 defense\n\n 
            !soviet infantry guard 1/8 3k 1c`
        },
        {
            "name": `Top Deck game`,
            "value": `!ranking  - Top 9 players\n
            !myrank  - Your personal TD ranking`
        },
        {
            "name": `Monitoring`,
            "value": `!! - Steam players online`
        },
        {
            "name": `Language`,
            "value": `!en [ de | es | ft | it | ko | pl | pt | ru | tw | zh ] - change the search language.`
        }
    ],
    "url": `https://www.paypal.me/kropotor`
 }

 module.exports = {helpEmbed}
