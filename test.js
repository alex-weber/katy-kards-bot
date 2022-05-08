const search = require("./search");
const translator = require("./translator");
let language = 'es'
let variables = {
    "language": language,
    "q": 'leo',
    "showSpawnables": true,
}
search.getCards(variables)
    .then(res => {
        if (res) { //if the server responds with 200
            console.log(language)
            const cards = res.data.data.cards.edges
            const counter = res.data.data.cards.pageInfo.count
            let content = translator.translate(language, 'search') + ': '
            //if any cards are found - attach them
            if (counter > 0) {
                content += counter
                //warn that there are more cards found
                if (counter > 10) {
                    content += translator.translate(language, 'limit') + 10
                }
                //attach found images
                //const files = search.getFiles(cards, limit)
                //reply to user
                //msg.reply({content: content, files: files})
            }
            console.log(content)

            //else msg.reply(translator.translate(language, 'noresult'))
        }
        //reply that no cards are found
        //else msg.reply(translator.translate(language, 'noresult'))
    })
    .catch(error => {
        //msg.reply(translator.translate(language, 'error'))
        console.error(error)
    })
