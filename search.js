module.exports.search = function getVariables (str) {

    let variables = {
        language: 'ru'
    }
    const words = str.split(' ')
    if (words.length < 2) return false

    words.forEach(setParams)

    function setParams(word, index, arr) {
        let kredits = setAttribute(word)
        if (kredits) variables['kredits'] = kredits
    }

    function setAttribute(word) {
        let kredits = false

        switch (word) {
            case word.endsWith('k'):
                kredits = parseInt(word.substring(0, word.length - 1))
                if (!isNaN(kredits)) return kredits
        }

        return kredits

    }

    return variables
}
