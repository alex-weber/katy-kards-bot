const {getCardsDB} = require("../db");
const fs = require("fs");

async function createJSON()
{
    let cards = await getCardsDB({})
    //save the file
    fs.writeFile(
        'export/cards.json',
        JSON.stringify(cards),
        function (err) {
            if (err) console.log('could not write file')
            else console.log('JSON created!')
        })
}
createJSON().catch((e) => {console.log(e) })