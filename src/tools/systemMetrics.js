const {redis, cachePrefix} = require('../controller/redis')

const memorySamplesKey = `${cachePrefix}system:memory:samples`
const memoryPeak24hKey = `${cachePrefix}system:memory:peak24h`
const memoryThresholdKey = `${cachePrefix}system:memory:thresholdMb`
const nodeMemoryAvailableKey = `${cachePrefix}system:memory:availableMb`
const redisMemoryAvailableKey = `${cachePrefix}system:redis:memory:availableMb`
const defaultMemoryThresholdMb = parseInt(process.env.MEMORY_USAGE_THRESHOLD_MB, 10) || 512
const defaultNodeMemoryAvailableMb = parseInt(process.env.MEMORY_AVAILABLE_MB, 10) || 562
const defaultRedisMemoryAvailableMb = parseInt(process.env.REDIS_MEMORY_AVAILABLE_MB, 10) || 30
const memorySampleLimit = parseInt(process.env.MEMORY_USAGE_SAMPLE_LIMIT, 10) || 60
const memorySampleIntervalMinutes = parseInt(process.env.MEMORY_USAGE_SAMPLE_INTERVAL_MINUTES, 10) || 10
const memorySampleIntervalMs = memorySampleIntervalMinutes * 60 * 1000
const memoryJumpThresholdMb = parseInt(process.env.MEMORY_USAGE_JUMP_THRESHOLD_MB, 10) || 64
const peakMemoryWindowSeconds = 24 * 60 * 60

function bytesToMb(bytes) {
    return Math.round((bytes / 1024 / 1024) * 10) / 10
}

function formatMbValue(value) {
    return `${Number(value) || 0} MB`
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

function formatDurationFromMs(milliseconds) {
    return formatDuration(Math.floor((Number(milliseconds) || 0) / 1000))
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

function normalizePeakMemory(value) {
    if (!value) return null
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value)
        } catch (err) {
            const rss = parseFloat(value)
            return Number.isFinite(rss) ? {rss, timestamp: null} : null
        }
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? {rss: value, timestamp: null} : null
    }
    if (!value || typeof value !== 'object') return null

    const rss = parseFloat(value.rss)
    return Number.isFinite(rss)
        ? {
            rss,
            timestamp: value.timestamp || null,
        }
        : null
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

function getSampleTimeSpan(samples) {
    if (!Array.isArray(samples) || samples.length < 2) return {
        milliseconds: 0,
        human: '0m',
    }

    const first = new Date(samples[0].timestamp).getTime()
    const last = new Date(samples[samples.length - 1].timestamp).getTime()
    const milliseconds = Number.isNaN(first) || Number.isNaN(last)
        ? 0
        : Math.max(0, last - first)

    return {
        milliseconds,
        human: formatDurationFromMs(milliseconds),
    }
}

async function recordMemoryUsage(redisClient = redis, sample = getCurrentMemoryUsage(), limit = memorySampleLimit) {
    await recordPeakMemoryUsage(redisClient, sample)
    if (!redisClient?.json?.get || !redisClient?.json?.set) return [sample]

    const saved = normalizeSampleList(await redisClient.json.get(memorySamplesKey, '$'))
    const samples = [...saved, sample].slice(-limit)
    await redisClient.json.set(memorySamplesKey, '$', samples)
    return samples
}

async function recordPeakMemoryUsage(redisClient = redis, sample = getCurrentMemoryUsage()) {
    const peak = {
        rss: Number(sample.rss) || 0,
        timestamp: sample.timestamp,
    }

    if (!redisClient?.get || !redisClient?.set) return peak

    const saved = normalizePeakMemory(await redisClient.get(memoryPeak24hKey))
    if (saved && saved.rss >= peak.rss) return saved

    await redisClient.set(memoryPeak24hKey, JSON.stringify(peak))
    if (redisClient?.expire) await redisClient.expire(memoryPeak24hKey, peakMemoryWindowSeconds)
    return peak
}

async function getPeakMemoryUsage(redisClient = redis, fallbackSample = getCurrentMemoryUsage()) {
    if (!redisClient?.get) {
        return {
            rss: fallbackSample.rss,
            timestamp: fallbackSample.timestamp,
        }
    }

    return normalizePeakMemory(await redisClient.get(memoryPeak24hKey)) || {
        rss: fallbackSample.rss,
        timestamp: fallbackSample.timestamp,
    }
}

async function getMemoryThresholdMb(redisClient = redis) {
    return getPositiveMbSetting(memoryThresholdKey, defaultMemoryThresholdMb, redisClient)
}

async function saveMemoryThresholdMb(value, redisClient = redis) {
    return savePositiveMbSetting(memoryThresholdKey, value, defaultMemoryThresholdMb, redisClient)
}

async function getNodeMemoryAvailableMb(redisClient = redis) {
    return getPositiveMbSetting(nodeMemoryAvailableKey, defaultNodeMemoryAvailableMb, redisClient)
}

async function saveNodeMemoryAvailableMb(value, redisClient = redis) {
    return savePositiveMbSetting(nodeMemoryAvailableKey, value, defaultNodeMemoryAvailableMb, redisClient)
}

async function getRedisMemoryAvailableMb(redisClient = redis) {
    return getPositiveMbSetting(redisMemoryAvailableKey, defaultRedisMemoryAvailableMb, redisClient)
}

async function saveRedisMemoryAvailableMb(value, redisClient = redis) {
    return savePositiveMbSetting(redisMemoryAvailableKey, value, defaultRedisMemoryAvailableMb, redisClient)
}

function normalizePositiveMb(value, fallback) {
    const normalized = parseInt(value, 10)
    return Number.isInteger(normalized) && normalized > 0 ? normalized : fallback
}

async function getPositiveMbSetting(key, fallback, redisClient = redis) {
    if (!redisClient?.get) return fallback

    return normalizePositiveMb(await redisClient.get(key), fallback)
}

async function savePositiveMbSetting(key, value, fallback, redisClient = redis) {
    const setting = normalizePositiveMb(value, fallback)
    if (redisClient?.set) await redisClient.set(key, String(setting))
    return setting
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

function buildRedisMemoryStats(info, availableMb = defaultRedisMemoryAvailableMb) {
    const maxMemory = Number(info.maxmemory) || 0

    return {
        availableMb,
        availableHuman: formatMbValue(availableMb),
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
    const redisMemoryAvailableMb = await getRedisMemoryAvailableMb(redisClient)

    if (!redisClient?.info) {
        return {
            available: false,
            error: 'Redis INFO is not available for this client.',
            cache: buildCacheStats({}),
            memory: buildRedisMemoryStats({}, redisMemoryAvailableMb),
            general: buildRedisGeneralStats({}),
        }
    }

    try {
        const info = parseRedisInfo(await redisClient.info())
        return {
            available: true,
            cache: buildCacheStats(info),
            memory: buildRedisMemoryStats(info, redisMemoryAvailableMb),
            general: buildRedisGeneralStats(info),
        }
    } catch (err) {
        return {
            available: false,
            error: err.message,
            cache: buildCacheStats({}),
            memory: buildRedisMemoryStats({}, redisMemoryAvailableMb),
            general: buildRedisGeneralStats({}),
        }
    }
}

async function buildSystemPageData(redisClient = redis) {
    const currentMemory = getCurrentMemoryUsage()
    const memoryThresholdMb = await getMemoryThresholdMb(redisClient)
    const nodeMemoryAvailableMb = await getNodeMemoryAvailableMb(redisClient)
    const [memorySamples, redisStats] = await Promise.all([
        recordMemoryUsage(redisClient, currentMemory),
        getRedisSystemStats(redisClient),
    ])
    const peakMemory = await getPeakMemoryUsage(redisClient, currentMemory)

    return {
        redisStats,
        memory: {
            current: currentMemory,
            peak24h: peakMemory,
            availableMb: nodeMemoryAvailableMb,
            availableHuman: formatMbValue(nodeMemoryAvailableMb),
            samples: memorySamples,
            sampleLimit: memorySampleLimit,
            sampleIntervalMinutes: memorySampleIntervalMinutes,
            sampleIntervalMs: memorySampleIntervalMs,
            sampleSpan: getSampleTimeSpan(memorySamples),
            jump: detectMemoryJump(memorySamples),
            thresholdMb: memoryThresholdMb,
            thresholdExceeded: currentMemory.rss > memoryThresholdMb,
            availableExceeded: currentMemory.rss > nodeMemoryAvailableMb,
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
    getNodeMemoryAvailableMb,
    getPeakMemoryUsage,
    getRedisMemoryAvailableMb,
    getRedisSystemStats,
    detectMemoryJump,
    getSampleTimeSpan,
    parseRedisInfo,
    recordPeakMemoryUsage,
    recordMemoryUsage,
    saveMemoryThresholdMb,
    saveNodeMemoryAvailableMb,
    saveRedisMemoryAvailableMb,
    startMemoryUsageSampler,
}
