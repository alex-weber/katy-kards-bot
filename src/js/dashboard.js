async function renderMessagesChart(data, dataTD) {
    try {

        const loadingSpinner = document.getElementById('loadingSpinner')
        const chartCanvas = document.getElementById('messagesChart')

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
                    label: 'TOTAL',
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
                    label: 'TD',
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

async function renderFactionsChart(apiData)
{
    const loadingSpinner = document.getElementById('loadingSpinnerTopMessages')
    const chartCanvas = document.getElementById('topMessagesChart')

    const labels = apiData.data.map(item => item.faction.toUpperCase() + '(' + item.count + ')')
    const data = apiData.data.map(item => item.count)
    // Hide loading spinner and show canvas
    loadingSpinner.classList.add('d-none')
    chartCanvas.style.display = 'block'

    // Define faction colors
    const baseColors = {
        soviet: '#604F3D',
        usa: '#63694C',
        japan: '#9D7C41',
        germany: '#5E6965',
        britain: '#928F7C',
        france: '#4C566F',
        italy: '#626260',
        poland: '#645E4B',
        finland: '#B8B8A0'
    }

// Generate background gradients
    const backgroundColors = apiData.data.map(faction => {
        return baseColors[faction.faction]
    })

// Bar chart configuration
    const config = {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: backgroundColors
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const label = context.label || ''
                            const value = context.raw || 0
                            return `${label}: ${value}`
                        }
                    }
                }
            },
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
            },
        }
    }


    const ctx = chartCanvas.getContext('2d')
    new Chart(ctx, config)

}

async function getDashboardData()
{
    //get the data
    const [
        responseMessages,
        responseTdMessages,
        responseFactions,
    ] = await Promise.all([
        fetch('/api/messages'),
        fetch('/api/td-messages'),
        fetch('/api/cards-by-faction')
    ])

    const [
        dataMessages,
        dataTdMessages,
        dataFactions
    ] = await Promise.all([
        responseMessages.json(),
        responseTdMessages.json(),
        responseFactions.json(),
    ])

    return {
        dataMessages,
        dataTdMessages,
        dataFactions
    }

}

getDashboardData().then(
    data => {
        renderMessagesChart(data.dataMessages, data.dataTdMessages,)
            .then( ()=> console.log('commands chart rendered') )
        renderFactionsChart(data.dataFactions)
            .then( ()=> console.log('factions chart rendered') )
    }
)
