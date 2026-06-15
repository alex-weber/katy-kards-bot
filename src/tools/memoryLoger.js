const {getCurrentMemoryUsage, recordMemoryUsage} = require('./systemMetrics')

//memory usage log
function logMemoryUsage()
{
    const m = getCurrentMemoryUsage()

    console.log({
        rss: Math.round(m.rss),
        heapUsed: Math.round(m.heapUsed),
        heapTotal: Math.round(m.heapTotal),
        external: Math.round(m.external),
        arrayBuffers: Math.round(m.arrayBuffers)
    })
    recordMemoryUsage(undefined, m).catch(err => console.error('Memory sample failed', err))
}

module.exports = {logMemoryUsage}
