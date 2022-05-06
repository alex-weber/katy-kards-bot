const getLanguage = function (str) {
    let language = 'en'
    const firstLetter = str.slice(0,1)
    const lastLetter = str.slice(-1);
    //console.log(str)
    //check if russian
    const cyrillicPattern = /^[\u0400-\u04FF]+$/
    if ( cyrillicPattern.test(firstLetter) || cyrillicPattern.test(lastLetter) ) language = 'ru'

    return language

}

module.exports = getLanguage