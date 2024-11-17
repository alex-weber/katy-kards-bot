async function renderChart() {
    try {

        const loadingSpinner = document.getElementById('loadingSpinner')
        //loadingSpinner.style.display = 'flex'
        const chartCanvas = document.getElementById('messagesChart')
        //get the data
        const response = await fetch('/api/messages');
        const apiData = await response.json();
        const labels = apiData.data.map(item => item.label);
        const dataPoints = apiData.data.map(item => item.count);

        const responseTD = await fetch('/api/td-messages');
        const apiDataTD = await responseTD.json();
        const labelsTD = apiDataTD.data.map(item => item.label);
        const dataPointsTD = apiDataTD.data.map(item => item.count);

// Combine all unique labels
        const allLabels = Array.from(new Set([...labels, ...labelsTD]));

// Create aligned data points for both datasets
        const commandsDataPoints = allLabels.map(label =>
            labels.includes(label) ? dataPoints[labels.indexOf(label)] : 0
        );
        const tdDataPoints = allLabels.map(label =>
            labelsTD.includes(label) ? dataPointsTD[labelsTD.indexOf(label)] : 0
        );

// Hide loading spinner and show canvas
        loadingSpinner.classList.add('d-none');
        chartCanvas.style.display = 'block';

// Set up the chart
        const chartSettings = {
            canvasId: 'messagesChart',
            type: 'line',
            labels: allLabels,
            datasets: [
                {
                    label: 'Commands',
                    data: commandsDataPoints,
                    backgroundColor: '#3F6EFD',
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
                    backgroundColor: '#b0c032',
                    borderColor: '#536e07',
                    borderWidth: 4,
                    pointBackgroundColor: '#e5e516',
                    pointBorderColor: '#e5e516',
                    pointBorderWidth: 2,
                    pointRadius: 5,
                },
            ],
        };

// Draw the chart
        drawChart(chartSettings);


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