module.exports = `
query getCards(
  $language: String,
  $first: Int, 
  $offset: Int, 
  $nationIds: [Int], 
  $kredits: [Int], 
  $q: String, 
  $type: [String], 
  $rarity: [String], 
  $set: [String], 
  $showSpawnables: Boolean, 
  $showExiles: Boolean, 
  $showReserved: Boolean) 
  { cards(
    language: $language, 
    first: $first, 
    offset: $offset, 
    nationIds: $nationIds, 
    kredits: $kredits, 
    q: $q, 
    type: $type, 
    set: $set, 
    rarity: $rarity, 
    showSpawnables: $showSpawnables, 
    showExiles: $showExiles, 
    showReserved: $showReserved) 
    { pageInfo
      { count
        hasNextPage
      }
      edges 
      { 
        node 
        { 
          id
          cardId
          importId
          json
          reserved
          imageUrl: image(language: $language)
          thumbUrl: image(type: thumb, language: $language)
        }    
      }
    }
  }
  `