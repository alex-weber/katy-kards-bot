const fs = require("fs")
const filePath = __dirname+'/../tmp/deckScreenshot.jpg'
const filePath2 = __dirname+'/../tmp/deckScreenshot2.jpg'
/**
 *
 * @returns {array}
 */
function getDeckFiles()
{
    return [filePath, filePath2]
}

function deleteDeckFiles()
{
    //delete the battle image
    fs.rm(filePath, function ()
    {
        console.log('deck image1 deleted')
    })
    fs.rm(filePath2, function ()
    {
        console.log('deck image2 deleted')
    })
}

module.exports = {getDeckFiles, deleteDeckFiles}