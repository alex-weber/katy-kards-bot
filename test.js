/*const search = require('./search.js')
const stats = require('./stats.js')
const translator = require("./translator");
//const {getLanguage, setLanguage} = require("./db");
const {getLanguageByInput, languages} = require("./language");*/
/*search.getCards('usa bomber blitz', 'ru').then(res => {
    console.log(search.getCards(res))
})*/

/*try {
    stats.getStats().then(res => {
        console.log(res)
    }).catch(error => {
        console.error(error.code)
    })
} catch (e) {
    console.log(e)
}*/



/*
let variables = {
    "language": 'en',
    "q": 'jap fighter elite fury',
    //attack: 0,
    //defense:4,
    "showSpawnables": true,
}

search.getCards(variables).then(res => {
    if (!res) {
        console.log('no res')
    }
    else {
        const cards = res.data.data.cards.edges
        const counter = res.data.data.cards.pageInfo.count

        const files = search.getFiles(cards, 10)
        console.log(counter, files)
    }
})
*/




/*

const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
});

readline.question('language?', language => {
    readline.close()
    const { setLanguage } = require('./db')
    const inputLanguage = language.trim()
    console.log(languages.includes(inputLanguage))
    if (languages.includes(inputLanguage)) {
        console.log('yes')
        setLanguage(user, inputLanguage).then(res => {
            console.log(res.rowCount, 'language set to ' + inputLanguage)
        })

    }


    return inputLanguage
})
*/


const jsoning = require('jsoning');
const db = new jsoning("database.json");


(async() => {

    // set some values with a key
    await db.set("birthday", "07-aug");
    await db.set("age", "13");

    // push stuff to an array for a particular key
    await db.push("transformers", "optimus prime");
    await db.push("transformers", "bumblebee");
    await db.push("transformers", "iron hide");

    // simply log what get is (i forgot what the transformers were)
    console.log(await db.get("transformers")); // [ 'optimus prime', 'bumblebee', 'iron hide' ]

    // just want to see what all is there
    console.log(await db.all()); // { object of the whole database contents }

    // does such a value exist
    console.log(await db.has("value2")); // false

    // my age keeps changing, so I'm deleting it
    console.log(await db.delete("age")); // true

    // i got 100$ for my birthday
    await db.set("money", 100);

    // and someone gave me 200 more dollars xD
    await db.math("money", "add", 200);

    // just wanna make sure how much money I got
    console.log(await db.get("money")); // 300

    // i'm getting bored, so i'm clearing the whole database
    await db.clear();

})();






