// Network Map Visualization

// Core network data
let networkNodes = [];
let networkLinks = [];
let simulation;
let svg;
let width;
let height;
let tooltip;
let localIPAddresses = new Set();
let activeConnections = new Map(); // Map of source-target pairs to track active connections
let isProcessing = false; // Flag to prevent concurrent processing
let packetQueue = []; // Queue to hold packets during processing
let lastUpdateTime = 0; // Track last update time
const UPDATE_INTERVAL = 1000; // Minimum time between updates in ms

// Initialize the network map
document.addEventListener("DOMContentLoaded", () => {
  initializeNetworkMap();
  setupNetworkMapControls();
});

// Function to initialize the network map visualization
function initializeNetworkMap() {
  // Get container dimensions
  const container = document.getElementById("networkMap");
  width = container.clientWidth;
  height = container.clientHeight;

  // Create SVG container
  svg = d3
    .select("#networkMap")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  // Create a tooltip div
  tooltip = d3.select("#networkMap").append("div").attr("class", "tooltip");

  // Create link group
  const linkGroup = svg.append("g").attr("class", "links");

  // Create node group (drawn after links so they appear on top)
  const nodeGroup = svg.append("g").attr("class", "nodes");

  // Create label group (drawn last so they appear on top of nodes)
  const labelGroup = svg.append("g").attr("class", "labels");

  // Create force simulation
  simulation = d3
    .forceSimulation()
    .force(
      "link",
      d3
        .forceLink()
        .id((d) => d.id)
        .distance(100)
    )
    .force("charge", d3.forceManyBody().strength(-300))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius(40))
    .on("tick", tick);

  // Tick function to update positions
  function tick() {
    // Update link positions
    svg
      .selectAll(".network-link")
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);

    // Update node positions
    svg
      .selectAll(".network-node")
      .attr("cx", (d) => (d.x = Math.max(15, Math.min(width - 15, d.x))))
      .attr("cy", (d) => (d.y = Math.max(15, Math.min(height - 15, d.y))));

    // Update label positions
    svg
      .selectAll(".network-label")
      .attr("x", (d) => d.x)
      .attr("y", (d) => d.y + 25);
  }
}

// Function to update the network map with new data
function updateNetworkMap(packets) {
  if (!svg) return; // Exit if SVG not initialized

  // If we're already processing data, queue these packets for later
  if (isProcessing) {
    packetQueue = packetQueue.concat(packets);
    return;
  }

  // Check if we need to throttle updates
  const currentTime = Date.now();
  if (currentTime - lastUpdateTime < UPDATE_INTERVAL) {
    // Queue packets and schedule an update
    packetQueue = packetQueue.concat(packets);
    if (!isProcessing) {
      setTimeout(() => {
        const queuedPackets = [...packetQueue];
        packetQueue = [];
        updateNetworkMap(queuedPackets);
      }, UPDATE_INTERVAL - (currentTime - lastUpdateTime));
    }
    return;
  }

  // Mark as processing to prevent concurrent updates
  isProcessing = true;
  lastUpdateTime = currentTime;

  // Process any queued packets along with the new ones
  const allPackets = packetQueue.concat(packets);
  packetQueue = [];

  try {
    // Get the current filter value
    const filterType = document.getElementById("filterSelect").value;

    // Process packets to create nodes and links
    processNetworkData(allPackets);

    // Apply filtering based on current selection
    const { filteredNodes, filteredLinks } = filterNetworkData(filterType);

    // Update the visualization with the filtered data
    updateVisualization(filteredNodes, filteredLinks);
  } catch (error) {
    console.error("Error updating network map:", error);
  } finally {
    // Mark as no longer processing
    isProcessing = false;

    // If more packets arrived during processing, handle them
    if (packetQueue.length > 0) {
      setTimeout(() => {
        const queuedPackets = [...packetQueue];
        packetQueue = [];
        updateNetworkMap(queuedPackets);
      }, 0);
    }
  }
}

// Process network data from packets
function processNetworkData(packets) {
  if (!packets || packets.length === 0) return;

  // Get all unique hosts from packets
  const hosts = new Set();
  const connections = new Map();
  const newActiveConnections = new Map();

  // Update local IP addresses from server data
  updateLocalIPs();

  // Process each packet
  for (let i = 0; i < packets.length; i++) {
    const packet = packets[i];
    if (!packet || !packet.src_ip || !packet.dst_ip) continue;

    // Add hosts to set
    hosts.add(packet.src_ip);
    hosts.add(packet.dst_ip);

    // Create connection ID
    const connectionId = `${packet.src_ip}:${packet.src_port}-${packet.dst_ip}:${packet.dst_port}`;
    const reverseId = `${packet.dst_ip}:${packet.dst_port}-${packet.src_ip}:${packet.src_port}`;

    // Update active connections
    newActiveConnections.set(connectionId, {
      source: packet.src_ip,
      target: packet.dst_ip,
      sourcePort: packet.src_port,
      targetPort: packet.dst_port,
      protocol: packet.protocol,
      flags: packet.flags,
      lastSeen: Date.now(),
    });

    // Update connections for visualization
    const linkId = `${packet.src_ip}-${packet.dst_ip}`;
    if (!connections.has(linkId)) {
      connections.set(linkId, {
        source: packet.src_ip,
        target: packet.dst_ip,
        protocols: new Set([packet.protocol]),
        packets: 1,
        bytes: packet.size || 0,
      });
    } else {
      const conn = connections.get(linkId);
      conn.protocols.add(packet.protocol);
      conn.packets++;
      conn.bytes += packet.size || 0;
    }
  }

  // Update active connections map (preserve connections seen in the last 30 seconds)
  const thirtySecondsAgo = Date.now() - 30000;
  activeConnections.forEach((conn, id) => {
    if (conn.lastSeen > thirtySecondsAgo && !newActiveConnections.has(id)) {
      newActiveConnections.set(id, conn);
    }
  });
  activeConnections = newActiveConnections;

  // Create or update nodes
  const updatedNodes = [];
  hosts.forEach((host) => {
    // Find existing node or create new one
    const existingNode = networkNodes.find((n) => n.id === host);
    const isLocal = localIPAddresses.has(host);

    if (existingNode) {
      existingNode.isLocal = isLocal;
      updatedNodes.push(existingNode);
    } else {
      updatedNodes.push({
        id: host,
        label: host,
        isLocal: isLocal,
      });
    }
  });

  // Keep nodes that aren't in the current batch but were seen recently
  const recentTime = Date.now() - 60000; // Last minute
  networkNodes.forEach((node) => {
    if (!updatedNodes.some((n) => n.id === node.id)) {
      // Check if this node has any active connections
      let hasActiveConnection = false;
      activeConnections.forEach((conn) => {
        if (conn.source === node.id || conn.target === node.id) {
          hasActiveConnection = true;
        }
      });

      if (
        hasActiveConnection ||
        (node.lastSeen && node.lastSeen > recentTime)
      ) {
        updatedNodes.push(node);
      }
    }
  });

  // Update timestamps for all nodes in this batch
  updatedNodes.forEach((node) => {
    node.lastSeen = Date.now();
  });

  networkNodes = updatedNodes;

  // Create or update links
  const updatedLinks = [];
  connections.forEach((conn, id) => {
    // Find existing link or create new one
    const existingLink = networkLinks.find(
      (l) =>
        (l.source === conn.source && l.target === conn.target) ||
        (l.source === conn.target && l.target === conn.source)
    );

    const protocols = Array.from(conn.protocols);
    const mainProtocol = protocols.includes("TCP")
      ? "TCP"
      : protocols.includes("UDP")
      ? "UDP"
      : "Other";

    if (existingLink) {
      existingLink.protocols = protocols;
      existingLink.mainProtocol = mainProtocol;
      existingLink.packets += conn.packets;
      existingLink.bytes += conn.bytes;
      existingLink.lastSeen = Date.now();
      updatedLinks.push(existingLink);
    } else {
      updatedLinks.push({
        source: conn.source,
        target: conn.target,
        protocols: protocols,
        mainProtocol: mainProtocol,
        packets: conn.packets,
        bytes: conn.bytes,
        lastSeen: Date.now(),
      });
    }
  });

  // Keep links that aren't in the current batch but were seen recently
  networkLinks.forEach((link) => {
    const linkId =
      typeof link.source === "object"
        ? `${link.source.id}-${link.target.id}`
        : `${link.source}-${link.target}`;

    if (
      !connections.has(linkId) &&
      !connections.has(linkId.split("-").reverse().join("-"))
    ) {
      if (link.lastSeen && link.lastSeen > recentTime) {
        updatedLinks.push(link);
      }
    }
  });

  networkLinks = updatedLinks;
}

// Apply filters to network data
function filterNetworkData(filterType) {
  let filteredLinks = [...networkLinks];

  // Apply active connections filter
  if (filterType === "active") {
    // Get all nodes that have active connections
    const activeNodes = new Set();
    activeConnections.forEach((conn) => {
      activeNodes.add(conn.source);
      activeNodes.add(conn.target);
    });

    // Filter links to only include active connections
    filteredLinks = networkLinks.filter((link) => {
      const sourceId =
        typeof link.source === "object" ? link.source.id : link.source;
      const targetId =
        typeof link.target === "object" ? link.target.id : link.target;
      return activeNodes.has(sourceId) && activeNodes.has(targetId);
    });
  }

  // Apply local connections filter
  if (filterType === "local") {
    filteredLinks = networkLinks.filter((link) => {
      const sourceNode =
        typeof link.source === "object"
          ? link.source
          : networkNodes.find((n) => n.id === link.source);
      const targetNode =
        typeof link.target === "object"
          ? link.target
          : networkNodes.find((n) => n.id === link.target);

      const sourceIsLocal = sourceNode?.isLocal ?? false;
      const targetIsLocal = targetNode?.isLocal ?? false;

      return sourceIsLocal || targetIsLocal;
    });
  }

  // Get all nodes that are used in the filtered links
  const usedNodeIds = new Set();
  filteredLinks.forEach((link) => {
    usedNodeIds.add(
      typeof link.source === "object" ? link.source.id : link.source
    );
    usedNodeIds.add(
      typeof link.target === "object" ? link.target.id : link.target
    );
  });

  const filteredNodes = networkNodes.filter((node) => usedNodeIds.has(node.id));

  return { filteredNodes, filteredLinks };
}

// Update the visualization with new data
function updateVisualization(nodes, links) {
  // Limit the number of nodes to prevent performance issues
  const MAX_NODES = 100;
  if (nodes.length > MAX_NODES) {
    // Sort by last seen and take the most recent
    nodes.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    nodes = nodes.slice(0, MAX_NODES);

    // Filter links to only include the nodes we're keeping
    const nodeIds = new Set(nodes.map((n) => n.id));
    links = links.filter((link) => {
      const sourceId =
        typeof link.source === "object" ? link.source.id : link.source;
      const targetId =
        typeof link.target === "object" ? link.target.id : link.target;
      return nodeIds.has(sourceId) && nodeIds.has(targetId);
    });
  }

  // Update links
  const link = svg
    .select(".links")
    .selectAll(".network-link")
    .data(links, (d) => {
      const sourceId = typeof d.source === "object" ? d.source.id : d.source;
      const targetId = typeof d.target === "object" ? d.target.id : d.target;
      return `${sourceId}-${targetId}`;
    });

  // Remove old links
  link.exit().transition().duration(300).attr("opacity", 0).remove();

  // Add new links
  const linkEnter = link
    .enter()
    .append("line")
    .attr("class", "network-link")
    .attr("opacity", 0)
    .attr("stroke-width", (d) => Math.max(1, Math.min(5, Math.log(d.packets))));

  // Set link color based on protocol
  linkEnter
    .merge(link)
    .transition()
    .duration(300)
    .attr("opacity", 1)
    .attr("stroke-width", (d) => Math.max(1, Math.min(5, Math.log(d.packets))))
    .attr("stroke", (d) => {
      if (d.mainProtocol === "TCP") return "#2ecc71";
      if (d.mainProtocol === "UDP") return "#f39c12";
      return "#9b59b6";
    });

  // Add hover effect to links
  linkEnter
    .merge(link)
    .on("mouseover", function (event, d) {
      const sourceId = typeof d.source === "object" ? d.source.id : d.source;
      const targetId = typeof d.target === "object" ? d.target.id : d.target;

      tooltip
        .style("display", "block")
        .html(
          `
          <div>${sourceId} → ${targetId}</div>
          <div>Protocol: ${d.mainProtocol}</div>
          <div>Packets: ${d.packets}</div>
          <div>Data: ${formatBytes(d.bytes)}</div>
        `
        )
        .style(
          "left",
          event.pageX -
            document.getElementById("networkMap").offsetLeft +
            10 +
            "px"
        )
        .style(
          "top",
          event.pageY -
            document.getElementById("networkMap").offsetTop -
            30 +
            "px"
        );
    })
    .on("mouseout", function () {
      tooltip.style("display", "none");
    });

  // Update nodes
  const node = svg
    .select(".nodes")
    .selectAll(".network-node")
    .data(nodes, (d) => d.id);

  // Remove old nodes
  node.exit().transition().duration(300).attr("r", 0).remove();

  // Add new nodes
  const nodeEnter = node
    .enter()
    .append("circle")
    .attr("class", "network-node")
    .attr("r", 0)
    .attr("fill", (d) => (d.isLocal ? "#3498db" : "#e74c3c"))
    .call(
      d3
        .drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended)
    );

  // Animate nodes
  nodeEnter
    .merge(node)
    .transition()
    .duration(300)
    .attr("r", 10)
    .attr("fill", (d) => (d.isLocal ? "#3498db" : "#e74c3c"));

  // Add hover effect to nodes
  nodeEnter
    .merge(node)
    .on("mouseover", function (event, d) {
      tooltip
        .style("display", "block")
        .html(
          `<div>${d.id}</div><div>${
            d.isLocal ? "Local Host" : "Remote Host"
          }</div>`
        )
        .style(
          "left",
          event.pageX -
            document.getElementById("networkMap").offsetLeft +
            10 +
            "px"
        )
        .style(
          "top",
          event.pageY -
            document.getElementById("networkMap").offsetTop -
            30 +
            "px"
        );
    })
    .on("mouseout", function () {
      tooltip.style("display", "none");
    });

  // Update labels
  const label = svg
    .select(".labels")
    .selectAll(".network-label")
    .data(nodes, (d) => d.id);

  // Remove old labels
  label.exit().transition().duration(300).attr("opacity", 0).remove();

  // Add new labels
  const labelEnter = label
    .enter()
    .append("text")
    .attr("class", "network-label")
    .attr("opacity", 0)
    .text((d) => truncateIP(d.id))
    .attr("fill", "#333");

  // Animate labels
  labelEnter
    .merge(label)
    .transition()
    .duration(300)
    .attr("opacity", 1)
    .text((d) => truncateIP(d.id));

  // Update simulation with fewer alpha steps for better performance
  simulation.nodes(nodes);
  simulation.force("link").links(links);
  simulation.alpha(0.3).alphaDecay(0.0228).restart();
}

// Setup event listeners for network map controls
function setupNetworkMapControls() {
  // Reset view button
  document.getElementById("resetViewBtn").addEventListener("click", () => {
    if (simulation) {
      simulation.alpha(1).restart();
    }
  });

  // Filter select
  document.getElementById("filterSelect").addEventListener("change", () => {
    const filterType = document.getElementById("filterSelect").value;
    const { filteredNodes, filteredLinks } = filterNetworkData(filterType);
    updateVisualization(filteredNodes, filteredLinks);
  });

  // Add a performance mode toggle if needed
  if (document.getElementById("performanceMode")) {
    document
      .getElementById("performanceMode")
      .addEventListener("change", (e) => {
        if (e.target.checked) {
          UPDATE_INTERVAL = 2000; // Less frequent updates
        } else {
          UPDATE_INTERVAL = 1000; // More frequent updates
        }
      });
  }
}

// Drag event handlers for nodes
function dragstarted(event, d) {
  if (!event.active) simulation.alphaTarget(0.3).restart();
  d.fx = d.x;
  d.fy = d.y;
}

function dragged(event, d) {
  d.fx = event.x;
  d.fy = event.y;
}

function dragended(event, d) {
  if (!event.active) simulation.alphaTarget(0);
  d.fx = null;
  d.fy = null;
}

// Update local IP addresses from server data
function updateLocalIPs() {
  // Clear the set first
  localIPAddresses.clear();

  // Add IPs from the server's detected local IPs list
  if (
    networkData &&
    networkData.local_ips &&
    networkData.local_ips.length > 0
  ) {
    networkData.local_ips.forEach((ip) => {
      localIPAddresses.add(ip);
    });
  } else {
    // Fallback to common local IP detection
    localIPAddresses.add("127.0.0.1");
    localIPAddresses.add("::1");
    localIPAddresses.add("localhost");

    // Check common private ranges if networkData is available
    if (networkData && networkData.packets) {
      networkData.packets.forEach((packet) => {
        if (packet.src_ip && isLocalIP(packet.src_ip)) {
          localIPAddresses.add(packet.src_ip);
        }
        if (packet.dst_ip && isLocalIP(packet.dst_ip)) {
          localIPAddresses.add(packet.dst_ip);
        }
      });
    }
  }
}

// Helper function to check if an IP is local
function isLocalIP(ip) {
  // Check for loopback addresses
  if (ip === "127.0.0.1" || ip === "::1" || ip === "localhost") return true;

  // Check for private IP ranges
  if (
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)
  ) {
    return true;
  }

  // Check for link-local addresses
  if (ip.startsWith("169.254.")) return true;

  // Check for IPv6 local addresses
  if (ip.startsWith("fe80:") || ip.startsWith("fc00:")) return true;

  return false;
}

// Helper function to format bytes
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  else return (bytes / 1048576).toFixed(1) + " MB";
}

// Helper function to truncate IP addresses for display
function truncateIP(ip) {
  const parts = ip.split(".");
  if (parts.length === 4) {
    // For IPv4, show just the last octet if it's a private address
    if (isLocalIP(ip)) {
      return `...${parts[3]}`;
    }
    // Otherwise show the last two octets
    return `...${parts[2]}.${parts[3]}`;
  }
  // For IPv6, just show the first 8 chars
  return ip.substring(0, 8) + "...";
}

// Safely update network map when new data is available
function updateNetworkMapData() {
  if (networkData && networkData.packets) {
    try {
      updateNetworkMap(networkData.packets);
    } catch (error) {
      console.error("Error updating network map:", error);
    }
  }
}

// Add the network map update to the updateUI function in main.js
let originalUpdateUI = updateUI;
updateUI = function () {
  try {
    originalUpdateUI();
  } catch (error) {
    console.error("Error in original updateUI:", error);
  }

  try {
    updateNetworkMapData();
  } catch (error) {
    console.error("Error in updateNetworkMapData:", error);
  }
};

// Add window resize handler to adjust the visualization
window.addEventListener(
  "resize",
  debounce(function () {
    if (svg) {
      const container = document.getElementById("networkMap");
      width = container.clientWidth;
      height = container.clientHeight;

      svg.attr("width", width).attr("height", height);

      if (simulation) {
        simulation.force("center", d3.forceCenter(width / 2, height / 2));
        simulation.alpha(0.3).restart();
      }
    }
  }, 250)
);

// Debounce function to limit how often an event can fire
function debounce(func, wait) {
  let timeout;
  return function () {
    const context = this,
      args = arguments;
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      func.apply(context, args);
    }, wait);
  };
}
