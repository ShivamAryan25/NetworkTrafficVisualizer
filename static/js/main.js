// Network Traffic Visualizer - Frontend Logic

// Charts
let trafficChart;
let protocolChart;

// Data storage
let networkData = {
  packets: [],
  port_stats: {},
  alerts: [],
  port_alerts: {},
};

// Polling state
let isCapturing = false;
let pollingInterval = null;

// Initialize the page
document.addEventListener("DOMContentLoaded", () => {
  initCharts();
  setupEventListeners();
  // Initial data fetch - just once, don't start polling yet
  fetchNetworkData();
});

// Initialize charts
function initCharts() {
  // Set fixed height for chart containers
  document.getElementById("trafficChart").style.height = "200px";
  document.getElementById("protocolChart").style.height = "200px";

  // Traffic Chart (Line chart)
  const trafficCtx = document.getElementById("trafficChart").getContext("2d");
  trafficChart = new Chart(trafficCtx, {
    type: "line",
    data: {
      labels: Array(5).fill(""),
      datasets: [
        {
          label: "Packets/sec",
          data: Array(5).fill(0),
          borderColor: "#3498db",
          backgroundColor: "rgba(52, 152, 219, 0.2)",
          tension: 0.4,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: "Packets per Second",
          },
          // Add max value to prevent y-axis from growing too large
          suggestedMax: 20,
        },
        x: {
          title: {
            display: true,
            text: "Time",
          },
        },
      },
      animation: {
        duration: 300, // Faster animations
      },
      plugins: {
        legend: {
          display: false, // Hide legend to save space
        },
      },
    },
  });

  // Protocol Chart (Pie chart)
  const protocolCtx = document.getElementById("protocolChart").getContext("2d");
  protocolChart = new Chart(protocolCtx, {
    type: "pie",
    data: {
      labels: ["TCP", "UDP", "Other"],
      datasets: [
        {
          data: [0, 0, 0],
          backgroundColor: [
            "rgba(52, 152, 219, 0.7)",
            "rgba(46, 204, 113, 0.7)",
            "rgba(155, 89, 182, 0.7)",
          ],
          borderColor: [
            "rgba(52, 152, 219, 1)",
            "rgba(46, 204, 113, 1)",
            "rgba(155, 89, 182, 1)",
          ],
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            boxWidth: 12, // Smaller legend items
            font: {
              size: 10, // Smaller font
            },
          },
        },
        title: {
          display: false, // Hide title to save space
        },
      },
    },
  });
}

// Set up event listeners
function setupEventListeners() {
  // Set Alert Button
  document.getElementById("setAlertBtn").addEventListener("click", () => {
    const port = document.getElementById("alertPort").value;
    const threshold = document.getElementById("alertThreshold").value;

    if (port && threshold) {
      setPortAlert(port, threshold);
    } else {
      alert("Please enter both port and threshold values");
    }
  });

  // Start Capture Button
  document
    .getElementById("startCaptureBtn")
    .addEventListener("click", startCapture);

  // Stop Capture Button
  document
    .getElementById("stopCaptureBtn")
    .addEventListener("click", stopCapture);
}

// Start packet capture
function startCapture() {
  if (!isCapturing) {
    fetch("/api/start_capture")
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          isCapturing = true;
          updateCaptureStatus(true);
          startDataPolling();
        } else {
          alert("Failed to start capture: " + data.message);
        }
      })
      .catch((error) => {
        console.error("Error starting capture:", error);
        alert("Failed to start capture. See console for details.");
      });
  }
}

// Stop packet capture
function stopCapture() {
  if (isCapturing) {
    fetch("/api/stop_capture")
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          isCapturing = false;
          updateCaptureStatus(false);
          stopDataPolling();
        } else {
          alert("Failed to stop capture: " + data.message);
        }
      })
      .catch((error) => {
        console.error("Error stopping capture:", error);
        alert("Failed to stop capture. See console for details.");
      });
  }
}

// Update UI to reflect capture status
function updateCaptureStatus(isActive) {
  const startBtn = document.getElementById("startCaptureBtn");
  const stopBtn = document.getElementById("stopCaptureBtn");
  const statusIndicator = document.getElementById("captureStatus");

  if (isActive) {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    statusIndicator.textContent = "Active";
    statusIndicator.className = "status-indicator status-active";
  } else {
    startBtn.disabled = false;
    stopBtn.disabled = true;
    statusIndicator.textContent = "Stopped";
    statusIndicator.className = "status-indicator status-stopped";
  }
}

// Start polling for data
function startDataPolling() {
  fetchNetworkData(); // Immediate fetch

  // Set up interval for continuous fetching
  if (pollingInterval === null) {
    pollingInterval = setInterval(fetchNetworkData, 5000);
  }
}

// Stop polling for data
function stopDataPolling() {
  if (pollingInterval !== null) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

// Fetch network data from the server
function fetchNetworkData() {
  fetch("/api/network_data")
    .then((response) => response.json())
    .then((data) => {
      networkData = data;
      updateUI();
    })
    .catch((error) => console.error("Error fetching network data:", error));
}

// Update all UI elements with the latest data
function updateUI() {
  updatePacketTable();
  updatePortList();
  updateAlertList();
  updateCharts();
}

// Update the packet table
function updatePacketTable() {
  const tableBody = document.getElementById("packetTableBody");
  tableBody.innerHTML = "";

  if (networkData.packets.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML =
      '<td colspan="5" class="loading">No packet data available yet</td>';
    tableBody.appendChild(row);
    return;
  }

  // Display the most recent packets first, but limit to 5 (instead of 10)
  const packets = [...networkData.packets].reverse().slice(0, 5);

  packets.forEach((packet) => {
    const row = document.createElement("tr");

    // Format source and destination with IP:port if available
    const source = packet.src_ip
      ? `${packet.src_ip}${packet.src_port ? ":" + packet.src_port : ""}`
      : "Unknown";
    const destination = packet.dst_ip
      ? `${packet.dst_ip}${packet.dst_port ? ":" + packet.dst_port : ""}`
      : "Unknown";

    row.innerHTML = `
            <td>${packet.timestamp}</td>
            <td>${source}</td>
            <td>${destination}</td>
            <td>${packet.protocol}</td>
            <td>${packet.size} bytes</td>
        `;

    tableBody.appendChild(row);
  });
}

// Update the port list
function updatePortList() {
  const portList = document.getElementById("portList");
  portList.innerHTML = "";

  const ports = Object.values(networkData.port_stats);

  if (ports.length === 0) {
    portList.innerHTML =
      '<div class="loading">No port activity detected yet</div>';
    return;
  }

  // Sort ports by activity (most active first)
  ports.sort((a, b) => {
    const aTotal = a.packets_in + a.packets_out;
    const bTotal = b.packets_in + b.packets_out;
    return bTotal - aTotal;
  });

  // Limit to top 5 most active ports (instead of 10)
  const topPorts = ports.slice(0, 5);

  topPorts.forEach((port) => {
    const portItem = document.createElement("div");
    portItem.className = "port-item";

    // Add alert class if this port has an alert set
    if (networkData.port_alerts[port.port]) {
      portItem.classList.add("port-alert-active");
    }

    const totalPackets = port.packets_in + port.packets_out;
    const totalBytes = port.bytes_in + port.bytes_out;

    portItem.innerHTML = `
            <h3>Port ${port.port}</h3>
            <div class="port-stats">
                <div>Packets In: ${port.packets_in}</div>
                <div>Packets Out: ${port.packets_out}</div>
                <div>Bytes In: ${port.bytes_in}</div>
                <div>Bytes Out: ${port.bytes_out}</div>
            </div>
            <div class="port-actions">
                ${
                  networkData.port_alerts[port.port]
                    ? `<button class="btn btn-danger btn-sm" onclick="clearPortAlert(${port.port})">Clear Alert</button>`
                    : `<button class="btn btn-primary btn-sm" onclick="setPortAlertFromList(${port.port})">Set Alert</button>`
                }
            </div>
        `;

    portList.appendChild(portItem);
  });
}

// Update the alert list
function updateAlertList() {
  const alertList = document.getElementById("alertList");

  if (networkData.alerts.length === 0) {
    alertList.innerHTML = '<div class="loading">No alerts yet</div>';
    return;
  }

  alertList.innerHTML = "";

  // Display alerts in reverse chronological order, but limit to 5 (instead of 10)
  const alerts = [...networkData.alerts].reverse().slice(0, 5);

  alerts.forEach((alert) => {
    const alertItem = document.createElement("div");
    alertItem.className = "alert-item";
    alertItem.innerHTML = `
            <div class="alert-time">${alert.timestamp}</div>
            <div class="alert-message">${alert.message}</div>
        `;

    alertList.appendChild(alertItem);
  });
}

// Update the charts
function updateCharts() {
  updateTrafficChart();
  updateProtocolChart();
}

// Update the traffic chart
function updateTrafficChart() {
  // Calculate packets per second based on recent packets
  const packetCounts = calculatePacketsPerSecond();

  // Update chart data - but limit to 5 points instead of 10
  trafficChart.data.labels = packetCounts.map((p) => p.timestamp);
  trafficChart.data.datasets[0].data = packetCounts.map((p) => p.count);
  trafficChart.update();
}

// Calculate packets per second for the traffic chart
function calculatePacketsPerSecond() {
  if (networkData.packets.length === 0) {
    return Array(5).fill({ timestamp: "", count: 0 });
  }

  // Group packets by second
  const packetsByTime = {};

  networkData.packets.forEach((packet) => {
    if (!packetsByTime[packet.timestamp]) {
      packetsByTime[packet.timestamp] = 0;
    }
    packetsByTime[packet.timestamp]++;
  });

  // Convert to array and take last 5 entries (instead of 10)
  return Object.entries(packetsByTime)
    .map(([timestamp, count]) => {
      // Cap the count to prevent very large values
      return { timestamp, count: Math.min(count, 50) };
    })
    .slice(-5);
}

// Update the protocol chart
function updateProtocolChart() {
  // Count protocols in the last 100 packets
  const protocolCounts = {
    TCP: 0,
    UDP: 0,
    Other: 0,
  };

  networkData.packets.forEach((packet) => {
    if (packet.protocol === "TCP") {
      protocolCounts.TCP++;
    } else if (packet.protocol === "UDP") {
      protocolCounts.UDP++;
    } else {
      protocolCounts.Other++;
    }
  });

  // Update chart data
  protocolChart.data.datasets[0].data = [
    protocolCounts.TCP,
    protocolCounts.UDP,
    protocolCounts.Other,
  ];

  protocolChart.update();
}

// Set port alert
function setPortAlert(port, threshold) {
  fetch("/api/set_alert", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ port, threshold }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        // Clear input fields
        document.getElementById("alertPort").value = "";
        document.getElementById("alertThreshold").value = "";
        // Update data
        fetchNetworkData();
      } else {
        alert(`Error setting alert: ${data.message}`);
      }
    })
    .catch((error) => console.error("Error setting port alert:", error));
}

// Set port alert from the port list
function setPortAlertFromList(port) {
  document.getElementById("alertPort").value = port;
  document.getElementById("alertThreshold").focus();
}

// Clear port alert
function clearPortAlert(port) {
  fetch("/api/clear_alert", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ port }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        // Update data
        fetchNetworkData();
      } else {
        alert(`Error clearing alert: ${data.message}`);
      }
    })
    .catch((error) => console.error("Error clearing port alert:", error));
}
