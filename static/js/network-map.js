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

  // Get the current filter value
  const filterType = document.getElementById("filterSelect").value;

  // Process packets to create nodes and links
  processNetworkData(packets);

  // Apply filtering based on current selection
  const { filteredNodes, filteredLinks } = filterNetworkData(filterType);

  // Update the visualization with the filtered data
  updateVisualization(filteredNodes, filteredLinks);
}

// Process network data from packets
function processNetworkData(packets) {
  // Get all unique hosts from packets
  const hosts = new Set();
  const connections = new Map();
  const newActiveConnections = new Map();

  // Update local IP addresses from server data
  updateLocalIPs();

  // Process each packet
  packets.forEach((packet) => {
    if (packet.src_ip && packet.dst_ip) {
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
          bytes: packet.size,
        });
      } else {
        const conn = connections.get(linkId);
        conn.protocols.add(packet.protocol);
        conn.packets++;
        conn.bytes += packet.size;
      }
    }
  });

  // Update active connections map (preserve connections seen in the last 30 seconds)
  const thirtySecondsAgo = Date.now() - 30000;
  activeConnections.forEach((conn, id) => {
    if (conn.lastSeen > thirtySecondsAgo && !newActiveConnections.has(id)) {
      newActiveConnections.set(id, conn);
    }
  });
  activeConnections = newActiveConnections;

  // Create or update nodes
  networkNodes = Array.from(hosts).map((host) => {
    // Find existing node or create new one
    const existingNode = networkNodes.find((n) => n.id === host);
    const isLocal = localIPAddresses.has(host);

    if (existingNode) {
      existingNode.isLocal = isLocal;
      return existingNode;
    } else {
      return {
        id: host,
        label: host,
        isLocal: isLocal,
      };
    }
  });

  // Create or update links
  networkLinks = Array.from(connections.values()).map((conn) => {
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
      existingLink.packets = conn.packets;
      existingLink.bytes = conn.bytes;
      return existingLink;
    } else {
      return {
        source: conn.source,
        target: conn.target,
        protocols: protocols,
        mainProtocol: mainProtocol,
        packets: conn.packets,
        bytes: conn.bytes,
      };
    }
  });
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
  link.exit().remove();

  // Add new links
  const linkEnter = link
    .enter()
    .append("line")
    .attr("class", "network-link")
    .attr("stroke-width", (d) => Math.max(1, Math.min(5, Math.log(d.packets))));

  // Set link color based on protocol
  linkEnter
    .merge(link)
    .attr("stroke", (d) => {
      if (d.mainProtocol === "TCP") return "#2ecc71";
      if (d.mainProtocol === "UDP") return "#f39c12";
      return "#9b59b6";
    })
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
  node.exit().remove();

  // Add new nodes
  const nodeEnter = node
    .enter()
    .append("circle")
    .attr("class", "network-node")
    .attr("r", 10)
    .attr("fill", (d) => (d.isLocal ? "#3498db" : "#e74c3c"))
    .call(
      d3
        .drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended)
    )
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
  label.exit().remove();

  // Add new labels
  const labelEnter = label
    .enter()
    .append("text")
    .attr("class", "network-label")
    .text((d) => truncateIP(d.id))
    .attr("fill", "#333");

  // Update simulation
  simulation.nodes(nodes);
  simulation.force("link").links(links);
  simulation.alpha(0.3).restart();
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
  if (networkData.local_ips && networkData.local_ips.length > 0) {
    networkData.local_ips.forEach((ip) => {
      localIPAddresses.add(ip);
    });
  } else {
    // Fallback to common local IP detection
    localIPAddresses.add("127.0.0.1");
    localIPAddresses.add("::1");
    localIPAddresses.add("localhost");

    // Check common private ranges
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

// Update network map when new data is available
function updateNetworkMapData() {
  updateNetworkMap(networkData.packets);
}

// Add the network map update to the updateUI function in main.js
let originalUpdateUI = updateUI;
updateUI = function () {
  originalUpdateUI();
  updateNetworkMapData();
};
