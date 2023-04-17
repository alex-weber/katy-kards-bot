
 const helpEmbed =
 {
    "type": `rich`,
    "title": `Click to donate`,
    "description": `The hosting costs 12$ a month. (Heroku Hobby 7$ + pgSQL mini 5$).
    Supporters will get VIP permissions for creating custom bot commands.`,
    "color": 0x0048ff,
    "fields": [
        {
            "name": `Advanced search`,
            "value": `The first 3 charachters of a word are used to search for attributes. 
            All not found words are added to a full string search in title and text.
            3k               -  Deployment cost
            2c or 2op  -  Operation cost
            5-5 or 5/5  - Five attack and five defense
            */8              - Any attack and 8 defense
            !soviet infantry guard 1/8 3k 1c`
        },
        {
            "name": `Top Deck game`,
            "value": `!ranking  - Top 9 players
            !myrank  - Your personal TD ranking`
        },
        {
            "name": `Monitoring`,
            "value": `!! - Steam players online`
        },
        {
            "name": `Language`,
            "value": `!en [ de | es | fr | it | ko | pl | pt | ru | tw | zh ] - change the search language.`
        }
    ],
    "url": `https://www.paypal.me/kropotor`
 }

 module.exports = {helpEmbed}
