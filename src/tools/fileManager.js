const fs = require("fs")

/**
 *
 * @param filename
 * @returns {string[]}
 */
function getDeckFiles(filename)
{
    return [
        __dirname+'/../tmp/'+filename+'.webp',
        __dirname+'/../tmp/'+filename+'2.webp'
    ]
}

/**
 * deletes deck images after they are sent
 * @param filename
 */
function deleteDeckFiles(filename)
{
    const files = getDeckFiles(filename)
    for (let file of files)
    {
        if (fs.existsSync(file)) {
            fs.rmSync(file)
            console.log(file + ' deleted')
        }
    }

}

module.exports = {getDeckFiles, deleteDeckFiles}