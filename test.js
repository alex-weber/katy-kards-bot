

const Keyv = require('keyv')

// One of the following
const keyv = new Keyv('postgres://postgres:gorbunok09@localhost:5432/kartonki')
keyv.on('error', err => console.error('Keyv connection error:', err))
async function test () {
    // true
    //await keyv.set('foo', 'bar');

    // bar
    let value = await keyv.get('foo');
    console.log(value)

    // undefined
    //await keyv.clear();

    // undefined
    //await keyv.get('foo');

}

test().then(() => {
    console.log('finished')

})