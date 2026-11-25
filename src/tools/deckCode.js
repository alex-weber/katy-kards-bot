// Reading KARDS deck codes, shared by the deck stats (deck.js) and the deck
// images (deckImage.js).

/**
 * How many copies of each card the deck holds, keyed by importId.
 *
 * A deck code lists its cards in `;`-separated groups, and a card's group says
 * how many copies it runs: the first group one copy each, the second two, and
 * so on. Ids are two characters and are read one group at a time — reading
 * them out of the groups concatenated meant a single odd-length group would
 * shift every id after it by one character. A well-formed code names each card
 * once.
 *
 * @param body the deck code after the '|'
 * @returns {Map<string, number>}
 */
function readDeckCounts(body) {
    const counts = new Map()

    body.split(';').forEach((group, index) => {
        for (const importId of group.match(/.{1,2}/g) || []) {
            //a leftover single character means the group was not a whole
            //number of ids; counting it would be inventing a card
            if (importId.length < 2) {
                console.error('Ignored a trailing character in a deck code group:', group)
                continue
            }
            counts.set(importId, index + 1)
        }
    })

    return counts
}

module.exports = {readDeckCounts}
