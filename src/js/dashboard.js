function renderMessagesChart(data, dataTD) {
    try {

        const loadingSpinner = document.getElementById('loadingSpinner')
        const chartCanvas = document.getElementById('messagesChart')

        const messagesCount = data.data.reduce((sum, item) => sum + item.count, 0)
        const tdCount = dataTD.data.reduce((sum, item) => sum + item.count, 0)

        const labels = data.data.map(item => item.label)
        const dataPoints = data.data.map(item => item.count)

        const labelsTD = dataTD.data.map(item => item.label)
        const dataPointsTD = dataTD.data.map(item => item.count)

        // Combine all unique labels
        const allLabels = Array.from(new Set([...labels, ...labelsTD]))

        // Create aligned data points for both datasets
        const commandsDataPoints = allLabels.map(label =>
            labels.includes(label) ? dataPoints[labels.indexOf(label)] : 0
        )
        const tdDataPoints = allLabels.map(label =>
            labelsTD.includes(label) ? dataPointsTD[labelsTD.indexOf(label)] : 0
        )

        // Hide loading spinner and show canvas
        loadingSpinner.classList.add('d-none')
        chartCanvas.style.display = 'block'

        // Set up the chart
        const chartSettings = {
            canvasId: 'messagesChart',
            type: 'line',
            labels: allLabels,
            datasets: [
                {
                    label: 'TOTAL ' + messagesCount,
                    data: commandsDataPoints,
                    backgroundColor: '#435488',
                    borderColor: '#3F6EFD',
                    borderWidth: 4,
                    pointBackgroundColor: '#3b879c',
                    pointBorderColor: '#3b879c',
                    pointBorderWidth: 2,
                    pointRadius: 5,
                },
                {
                    label: 'DECK SCREENSHOTS ' + tdCount,
                    data: tdDataPoints,
                    backgroundColor: '#536e07',
                    borderColor: '#b0c032',
                    borderWidth: 4,
                    pointBackgroundColor: '#e5e516',
                    pointBorderColor: '#e5e516',
                    pointBorderWidth: 2,
                    pointRadius: 5,
                },
            ],
        }

        drawChart(chartSettings)


    } catch (error) {
        console.error('Error fetching or rendering chart data:', error)
    }
}

function drawChart(chartSettings)
{
    const ctx = document.getElementById(chartSettings.canvasId).getContext('2d')
    new Chart(ctx, {
        type: chartSettings.type,
        data: {
            labels: chartSettings.labels,
            datasets: chartSettings.datasets
        },
        options: {
            scales: {
                x: {
                    grid: {
                        color: '#4B4D4E',
                    }
                },
                y: {
                    grid: {
                        color: '#4B4D4E',
                        lineWidth: 1,
                    }
                }
            }
        },
    })
}
function renderTopMessages(apiData) {
    const topMessagesDiv = document.getElementById('topMessages')
    const aggregated = apiData.data
        .filter(item => !item.command.startsWith('%%')) // exclude commands starting with %%
        .reduce((acc, item) => {
            const command = item.command.split(' -> ').pop()
            if (!acc[command]) {
                acc[command] = { command, count: 0 }
            }
            acc[command].count += item.count
            return acc
        }, {})

    const items = Object.values(aggregated).sort((a, b) => b.count - a.count)
    const maxCount = Math.max(...items.map(item => item.count), 1)

    topMessagesDiv.innerHTML = items
        .map((item, index) => `
            <tr class="leaderboard-row">
                <td class="leaderboard-rank-cell">
                    <span class="rank-badge ${getRankClass(index)}">${index + 1}</span>
                </td>
                <td class="leaderboard-name-cell">
                    <span class="leaderboard-primary-text break-all">${escapeHtml(item.command)}</span>
                    <span class="leaderboard-meter" aria-hidden="true">
                        <span style="width: ${getBarWidth(item.count, maxCount)}%"></span>
                    </span>
                </td>
                <td class="leaderboard-count-cell">${formatCount(item.count)}</td>
            </tr>
        `)
        .join('')
}


function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function formatCount(value) {
    return Number(value || 0).toLocaleString()
}

function formatPosition(value) {
    return value ? '#' + formatCount(value) : 'n/a'
}

function getBarWidth(value, maxValue) {
    return Math.max(6, Math.round((Number(value || 0) / maxValue) * 100))
}

function getRankClass(index) {
    if (index === 0) return 'rank-badge-gold'
    if (index === 1) return 'rank-badge-silver'
    if (index === 2) return 'rank-badge-bronze'
    return ''
}

function setCounterText(id, value) {
    const el = document.getElementById(id)
    if (el) el.textContent = formatCount(value)
}

// Today + last-30-days figures from a daily-period stats series (30 daily
// buckets): "today" is the most recent bucket, "last 30 days" is the full sum.
function dailySeriesCounts(apiData) {
    const buckets = (apiData && apiData.data) || []
    const last30d = buckets.reduce((sum, item) => sum + item.count, 0)
    const today = buckets.length ? buckets[buckets.length - 1].count : 0
    return { today, last30d }
}

// Real screenshots captured: live Redis counters (today + all-time total).
 function renderScreenshotCounters(apiData) {
    const counters = (apiData && apiData.data) || {}
    setCounterText('screenshotsToday', counters.daily)
    setCounterText('screenshots30d', counters.last30d)
    setCounterText('screenshotsTotal', counters.total)
}

function renderMessageCounters(apiData, totalCount) {
    const { today, last30d } = dailySeriesCounts(apiData)
    setCounterText('messagesDaily', today)
    setCounterText('messages30d', last30d)
    setCounterText('messagesTotal', totalCount.data)
}

// Logged screenshot commands (%%% messages), distinct from captures above.
function renderScreenshotCommandCounters(apiData, totalCount) {
    const { today, last30d } = dailySeriesCounts(apiData)
    setCounterText('screenshotCmdDaily', today)
    setCounterText('screenshotCmd30d', last30d)
    setCounterText('screenshotCmdTotal', totalCount.data)
}

function renderTopUsers(apiData) {
    const topUsersElement = document.getElementById('topUsers')
    if (!topUsersElement || !apiData.data) return

    const maxCount = Math.max(...apiData.data.map(item => item.count), 1)

    topUsersElement.innerHTML = apiData.data
        .map((item, index) => `
      <tr class="leaderboard-row">
        <td class="leaderboard-rank-cell">
          <span class="rank-badge ${getRankClass(index)}">${index + 1}</span>
        </td>
        <td class="leaderboard-name-cell">
          <a class="leaderboard-primary-link" href="/profile/${encodeURIComponent(item.authorId)}">${escapeHtml(item.username)}</a>
          <span class="leaderboard-meter leaderboard-meter-users" aria-hidden="true">
            <span style="width: ${getBarWidth(item.count, maxCount)}%"></span>
          </span>
        </td>
        <td class="leaderboard-rank-cell">${formatPosition(item.allTimePosition)}</td>
        <td class="leaderboard-count-cell">${formatCount(item.count)}</td>
      </tr>
    `)
        .join('')
}


const allowedPeriods = ['yearly', 'quarterly', 'monthly', 'daily']

function normalizePeriod(period) {
    return allowedPeriods.includes(period) ? period : 'daily'
}

async function getDashboardData({ period } = {}) {

    const params = new URLSearchParams()
    params.append('period', normalizePeriod(period))

    const qs = params.toString() ? '?' + params.toString() : ''

    // The mini-counters always read the daily series (today / last 30 days),
    // independent of the chart's selected period.
    const dailyQs = '?period=daily'

    const [
        responseMessages,
        responseTdMessages,
        responseTopMessages,
        responseTopUsers,
        responseScreenshotCounters,
        responseMessagesDaily,
        responseTdMessagesDaily,
        responseTotalMessageCount,
        responseTotalScreenshotCommandCount,
    ] = await Promise.all([
        fetch('/api/messages' + qs),
        fetch('/api/screenshot-messages' + qs),
        fetch('/api/top-messages' + qs),
        fetch('/api/top-users' + qs),
        fetch('/api/screenshot-counters'),
        fetch('/api/messages' + dailyQs),
        fetch('/api/screenshot-messages' + dailyQs),
        fetch('/api/total-message-count'),
        fetch('/api/total-screenshot-command-count'),
    ])

    const [
        dataMessages,
        dataTdMessages,
        dataTopMessages,
        dataTopUsers,
        dataScreenshotCounters,
        dataMessagesDaily,
        dataTdMessagesDaily,
        dataTotalMessageCount,
        dataTotalScreenshotCommandCount,
    ] = await Promise.all([
        responseMessages.json(),
        responseTdMessages.json(),
        responseTopMessages.json(),
        responseTopUsers.json(),
        responseScreenshotCounters.json(),
        responseMessagesDaily.json(),
        responseTdMessagesDaily.json(),
        responseTotalMessageCount.json(),
        responseTotalScreenshotCommandCount.json(),
    ])

    return {
        dataMessages,
        dataTdMessages,
        dataTopMessages,
        dataTopUsers,
        dataScreenshotCounters,
        dataMessagesDaily,
        dataTdMessagesDaily,
        dataTotalMessageCount,
        dataTotalScreenshotCommandCount,
    }
}

function getQueryParam(name) {
    const params = new URLSearchParams(window.location.search)
    return params.get(name)
}

getDashboardData({
    period: getQueryParam('period'),
}).then(data => {
    renderMessagesChart(
        data.dataMessages,
        data.dataTdMessages
    )
    renderTopMessages(data.dataTopMessages)
    renderTopUsers(data.dataTopUsers)
    renderScreenshotCounters(data.dataScreenshotCounters)
    renderMessageCounters(data.dataMessagesDaily, data.dataTotalMessageCount)
    renderScreenshotCommandCounters(data.dataTdMessagesDaily, data.dataTotalScreenshotCommandCount)
})
