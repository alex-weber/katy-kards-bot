const fs = require("fs")

/**
 *
 * @returns {array}
 */
function getDeckFiles()
{
    return [
        __dirname+'/../tmp/deckScreenshot.webp',
        __dirname+'/../tmp/deckScreenshot2.webp'
    ]
}

/**
 * deletes deck images after they are sent
 */
function deleteDeckFiles()
{
    const files = getDeckFiles()
    for (let file of files)
    {
        fs.rmSync(file)
        console.log(file + ' deleted')
    }

}

module.exports = {getDeckFiles, deleteDeckFiles}