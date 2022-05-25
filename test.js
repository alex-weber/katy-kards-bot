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