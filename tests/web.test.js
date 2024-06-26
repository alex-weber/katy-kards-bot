const axios = require("axios")

describe('Test URLs / and /servers', () => {
    test('responds with status code 200', async () => {
        let response = await axios.get('http://localhost:3000/servers')
        expect(response.status).toBe(200)
        response = await axios.get('http://localhost:3000/')
        expect(response.status).toBe(200)
    })
})
