

console.log(process.env.DATABASE_URL)

//process.env.DATABASE_URL = 'postgres://postgres:gorbunok09@localhost:5432/nodeKards?schema=public'

const {
    getUser,
    updateUser,
    createMessage,
    getMessages,
    getSynonym,
    createSynonym
} = require('./db')

async function main() {

    let User = await getUser("22")
    let messages = await getMessages(User)
    //await createSynonym('baba', 'dji')
    let syn = await getSynonym('baba')
    console.log(messages, syn)

}
main()
    .catch((e) => {
        throw e
    })
    .finally(async () => {
        console.log('Promise finalized')
    })