//memory usage log
function logMemoryUsage()
{
    const m = process.memoryUsage()

    console.log({
        rss: Math.round(m.rss / 1024 / 1024),
        heapUsed: Math.round(m.heapUsed / 1024 / 1024),
        external: Math.round(m.external / 1024 / 1024),
        arrayBuffers: Math.round(m.arrayBuffers / 1024 / 1024)
    })
}

module.exports = {logMemoryUsage}