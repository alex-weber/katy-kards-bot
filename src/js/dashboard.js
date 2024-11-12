async function renderChart() {
    try {
        const response = await fetch('/api/messages')
        const apiData = await response.json()
        const labels = apiData.data.map(item => item.label)
        const dataPoints = apiData.data.map(item => item.count)
        drawChart('messagesChart', 'Last 30 days messages', labels, dataPoints)

    } catch (error) {
        console.error('Error fetching or rendering chart data:', error)
    }
}

function drawChart(canvasId, mainLabel='', labels, dataPoints)
{
    const ctx = document.getElementById(canvasId).getContext('2d')
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: mainLabel,
                data: dataPoints,
                backgroundColor: '#3F6EFD',
                borderColor: '#3F6EFD',
                borderWidth: 4,
                pointBackgroundColor: '#3b879c',
                pointBorderColor: '#3b879c',
                pointBorderWidth: 2,
                pointRadius: 5,

            }]
        },
        options: {
            scales: {
                x: {
                    grid: {
                        color: '#4B4D4E', // Set X-axis grid color
                    }
                },
                y: {
                    grid: {
                        color: '#4B4D4E', // Set Y-axis grid color
                        lineWidth: 1,                      // Customize line thickness if needed
                    }
                }
            }
        },
    })
}

renderChart().then( ()=> console.log('dashboard chart rendered') )