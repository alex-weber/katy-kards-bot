const {redis, cachePrefix} = require('../controller/redis')

const memorySamplesKey = `${cachePrefix}system:memory:samples`
const memoryThresholdKey = `${cachePrefix}system:memory:thresholdMb`
const defaultMemoryThresholdMb = parseInt(process.env.MEMORY_USAGE_THRESHOLD_MB, 10) || 512
const memorySampleLimit = parseInt(process.env.MEMORY_USAGE_SAMPLE_LIMIT, 10) || 144
const memorySampleIntervalMs = parseInt(process.env.MEMORY_USAGE_SAMPLE_INTERVAL_MS, 10) || 5 * 60 * 1000
const memoryJumpThresholdMb = parseInt(process.env.MEMORY_USAGE_JUMP_THRESHOLD_MB, 10) || 64

function bytesToMb(bytes) {
    return Math.round((bytes / 1024 / 1024) * 10) / 10
}

function formatMb(bytes) {
    return `${bytesToMb(Number(bytes) || 0)} MB`
}

function formatDuration(seconds) {
    const totalMinutes = Math.floor((Number(seconds) || 0) / 60)
    const days = Math.floor(totalMinutes / 1440)
    const hours = Math.floor((totalMinutes % 1440) / 60)
    const minutes = totalMinutes % 60
    const parts = []

    if (days) parts.push(`${days}d`)
    if (hours || days) parts.push(`${hours}h`)
    parts.push(`${minutes}m`)

    return parts.join(' ')
}

function getCurrentMemoryUsage(now = new Date()) {
    const m = process.memoryUsage()
    return {
        timestamp: now.toISOString(),
        rss: bytesToMb(m.rss),
        heapUsed: bytesToMb(m.heapUsed),
        heapTotal: bytesToMb(m.heapTotal),
        external: bytesToMb(m.external),
        arrayBuffers: bytesToMb(m.arrayBuffers),
    }
}

function normalizeSampleList(value) {
    if (Array.isArray(value) && value.length === 1 && Array.isArray(value[0])) return value[0]
    return Array.isArray(value) ? value : []
}

function detectMemoryJump(samples, thresholdMb = memoryJumpThresholdMb) {
    if (!Array.isArray(samples) || samples.length < 2) {
        return {
            detected: false,
            thresholdMb,
            changes: [],
        }
    }

    const previous = samples[samples.length - 2]
    const current = samples[samples.length - 1]
    const metrics = [
        {key: 'rss', label: 'RSS'},
        {key: 'heapUsed', label: 'Heap used'},
        {key: 'heapTotal', label: 'Heap total'},
        {key: 'external', label: 'External'},
        {key: 'arrayBuffers', label: 'Array buffers'},
    ]
    const changes = metrics
        .map(metric => ({
            ...metric,
            before: Number(previous[metric.key]) || 0,
            after: Number(current[metric.key]) || 0,
        }))
        .map(change => ({
            ...change,
            delta: Math.round((change.after - change.before) * 10) / 10,
        }))
        .filter(change => change.delta >= thresholdMb)

    return {
        detected: changes.length > 0,
        thresholdMb,
        previousTimestamp: previous.timestamp,
        currentTimestamp: current.timestamp,
        changes,
        message: changes.length
            ? changes.map(change => `${change.label} +${change.delta} MB`).join(', ')
            : '',
    }
}

async function recordMemoryUsage(redisClient = redis, sample = getCurrentMemoryUsage(), limit = memorySampleLimit) {
    if (!redisClient?.json?.get || !redisClient?.json?.set) return [sample]

    const saved = normalizeSampleList(await redisClient.json.get(memorySamplesKey, '$'))
    const samples = [...saved, sample].slice(-limit)
    await redisClient.json.set(memorySamplesKey, '$', samples)
    return samples
}

async function getMemoryThresholdMb(redisClient = redis) {
    if (!redisClient?.get) return defaultMemoryThresholdMb

    const saved = await redisClient.get(memoryThresholdKey)
    const value = parseInt(saved, 10)
    return Number.isInteger(value) && value > 0 ? value : defaultMemoryThresholdMb
}

async function saveMemoryThresholdMb(value, redisClient = redis) {
    const normalized = parseInt(value, 10)
    const threshold = Number.isInteger(normalized) && normalized > 0 ? normalized : defaultMemoryThresholdMb
    if (redisClient?.set) await redisClient.set(memoryThresholdKey, String(threshold))
    return threshold
}

function coerceInfoValue(value) {
    if (/^-?\d+$/.test(value)) return parseInt(value, 10)
    if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value)
    return value
}

function parseRedisInfo(info = '') {
    return info
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && line.includes(':'))
        .reduce((parsed, line) => {
            const separatorIndex = line.indexOf(':')
            const key = line.slice(0, separatorIndex)
            const value = line.slice(separatorIndex + 1)
            parsed[key] = coerceInfoValue(value)
            return parsed
        }, {})
}

function buildCacheStats(info) {
    const hits = Number(info.keyspace_hits) || 0
    const misses = Number(info.keyspace_misses) || 0
    const total = hits + misses
    const hitRatio = total ? Math.round((hits / total) * 1000) / 10 : 0
    const missRatio = total ? Math.round((misses / total) * 1000) / 10 : 0

    return {
        hits,
        misses,
        total,
        hitRatio,
        missRatio,
        evictedKeys: Number(info.evicted_keys) || 0,
        expiredKeys: Number(info.expired_keys) || 0,
        totalCommandsProcessed: Number(info.total_commands_processed) || 0,
        instantaneousOpsPerSec: Number(info.instantaneous_ops_per_sec) || 0,
    }
}

function buildRedisMemoryStats(info) {
    const maxMemory = Number(info.maxmemory) || 0

    return {
        usedMemory: Number(info.used_memory) || 0,
        usedMemoryHuman: formatMb(info.used_memory),
        usedMemoryRss: Number(info.used_memory_rss) || 0,
        usedMemoryRssHuman: formatMb(info.used_memory_rss),
        usedMemoryPeakHuman: formatMb(info.used_memory_peak),
        maxMemoryHuman: maxMemory ? formatMb(maxMemory) : '0 MB',
        memFragmentationRatio: Number(info.mem_fragmentation_ratio) || 0,
    }
}

function buildRedisGeneralStats(info) {
    const uptimeInSeconds = Number(info.uptime_in_seconds) || 0

    return {
        redisVersion: info.redis_version || 'n/a',
        uptimeInSeconds,
        uptimeHuman: formatDuration(uptimeInSeconds),
        connectedClients: Number(info.connected_clients) || 0,
        blockedClients: Number(info.blocked_clients) || 0,
        connectedSlaves: Number(info.connected_slaves) || 0,
        role: info.role || 'n/a',
    }
}

async function getRedisSystemStats(redisClient = redis) {
    if (!redisClient?.info) {
        return {
            available: false,
            error: 'Redis INFO is not available for this client.',
            cache: buildCacheStats({}),
            memory: buildRedisMemoryStats({}),
            general: buildRedisGeneralStats({}),
        }
    }

    try {
        const info = parseRedisInfo(await redisClient.info())
        return {
            available: true,
            cache: buildCacheStats(info),
            memory: buildRedisMemoryStats(info),
            general: buildRedisGeneralStats(info),
        }
    } catch (err) {
        return {
            available: false,
            error: err.message,
            cache: buildCacheStats({}),
            memory: buildRedisMemoryStats({}),
            general: buildRedisGeneralStats({}),
        }
    }
}

async function buildSystemPageData(redisClient = redis) {
    const currentMemory = getCurrentMemoryUsage()
    const [memorySamples, memoryThresholdMb, redisStats] = await Promise.all([
        recordMemoryUsage(redisClient, currentMemory),
        getMemoryThresholdMb(redisClient),
        getRedisSystemStats(redisClient),
    ])

    return {
        redisStats,
        memory: {
            current: currentMemory,
            samples: memorySamples,
            sampleLimit: memorySampleLimit,
            sampleIntervalMs: memorySampleIntervalMs,
            jump: detectMemoryJump(memorySamples),
            thresholdMb: memoryThresholdMb,
            thresholdExceeded: currentMemory.rss > memoryThresholdMb,
        },
    }
}

function startMemoryUsageSampler(redisClient = redis) {
    const timer = setInterval(() => {
        recordMemoryUsage(redisClient).catch(err => console.error('Memory sample failed', err))
    }, memorySampleIntervalMs)
    if (typeof timer.unref === 'function') timer.unref()
    return timer
}

module.exports = {
    buildSystemPageData,
    getCurrentMemoryUsage,
    getMemoryThresholdMb,
    getRedisSystemStats,
    detectMemoryJump,
    parseRedisInfo,
    recordMemoryUsage,
    saveMemoryThresholdMb,
    startMemoryUsageSampler,
}
