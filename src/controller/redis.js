//redis cache
const { createClient } = require('redis')

//Redis
const redis = createClient({url: process.env.REDISCLOUD_URL})
redis.connect().then(()=>{ console.log('REDIS Client Connected') })
const RedisStore = require("connect-redis").default
// Initialize store.
const secure = process.env.NODE_ENV === 'production'
const cachePrefix = secure ? 'katy-prod:' : 'katy-dev:'
const redisStore = new RedisStore({
    client: redis,
    prefix: cachePrefix,
})

module.exports = {
    redis,
    redisStore,
    secure,
}