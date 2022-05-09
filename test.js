let str = 'sexy'
const dictionary = require('./dictionary')
if (str in dictionary.synonyms) {
    console.log(dictionary.synonyms[str])
}