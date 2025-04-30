import os
import time
import json
import threading
import socket
from datetime import datetime
from flask import Flask, render_template, jsonify, request
from scapy.all import sniff, IP, TCP, UDP
import psutil

app = Flask(__name__)
app.config['SECRET_KEY'] = 'networkvisualizersecretkey'

# Network data storage
network_data = {
    'packets': [],
    'port_stats': {},
    'alerts': [],
    'port_alerts': {},  # Stores alert thresholds for specific ports
    'local_ips': []     # Store detected local IP addresses
}

# Lock for thread-safe access to network_data
data_lock = threading.Lock()

# Rate limiting for packet capture
last_packet_time = 0
packet_interval = 0.5  # Minimum time between packets (increased from 0.1 to 0.5 seconds)

# Packet capture control
capture_active = False
capture_thread = None
stop_capture_flag = threading.Event()

# Get local IP addresses
def get_local_ip_addresses():
    local_ips = []
    try:
        # Get all network interfaces
        hostname = socket.gethostname()
        local_ips.append(socket.gethostbyname(hostname))
        
        # Add loopback address
        local_ips.append('127.0.0.1')
        local_ips.append('::1')
        
        # Try to get all addresses
        interfaces = psutil.net_if_addrs()
        for interface, addrs in interfaces.items():
            for addr in addrs:
                if addr.family == socket.AF_INET or addr.family == socket.AF_INET6:
                    local_ips.append(addr.address)
    except Exception as e:
        print(f"Error getting local IP addresses: {e}")
    
    return list(set(local_ips))  # Remove duplicates

def get_packet_info(packet):
    """Extract relevant information from a packet"""
    packet_info = {
        'timestamp': datetime.now().strftime('%H:%M:%S'),
        'size': len(packet),
        'protocol': 'Unknown',
        'src_ip': None,
        'dst_ip': None,
        'src_port': None,
        'dst_port': None
    }
    
    # Source and destination
    if IP in packet:
        packet_info['src_ip'] = packet[IP].src
        packet_info['dst_ip'] = packet[IP].dst
        
        # Determine protocol
        if TCP in packet:
            packet_info['protocol'] = 'TCP'
            packet_info['src_port'] = packet[TCP].sport
            packet_info['dst_port'] = packet[TCP].dport
            # Add TCP flags information
            flags = []
            if packet[TCP].flags.S: flags.append('SYN')
            if packet[TCP].flags.A: flags.append('ACK')
            if packet[TCP].flags.F: flags.append('FIN')
            if packet[TCP].flags.R: flags.append('RST')
            if packet[TCP].flags.P: flags.append('PSH')
            packet_info['flags'] = flags
        elif UDP in packet:
            packet_info['protocol'] = 'UDP'
            packet_info['src_port'] = packet[UDP].sport
            packet_info['dst_port'] = packet[UDP].dport
        else:
            packet_info['protocol'] = 'Other IP'
            packet_info['src_port'] = 0
            packet_info['dst_port'] = 0
    
    return packet_info

def update_port_stats(packet_info):
    """Update port statistics based on packet info"""
    global last_packet_time
    
    # Check if we should stop capturing
    if stop_capture_flag.is_set():
        return
    
    # Apply rate limiting - only process packets at specified interval
    current_time = time.time()
    if current_time - last_packet_time < packet_interval:
        return
    
    last_packet_time = current_time
    
    with data_lock:
        # Add packet to the packets list (limit to last 20 instead of 50)
        network_data['packets'].append(packet_info)
        if len(network_data['packets']) > 20:
            network_data['packets'] = network_data['packets'][-20:]
        
        # Check if we have port information
        if 'src_port' in packet_info and 'dst_port' in packet_info:
            # Update local port statistics (only track local ports)
            for port_type, port in [('src', packet_info.get('src_port')), 
                                   ('dst', packet_info.get('dst_port'))]:
                if port:
                    port_key = f"{port}"
                    if port_key not in network_data['port_stats']:
                        network_data['port_stats'][port_key] = {
                            'port': port,
                            'packets_in': 0,
                            'packets_out': 0,
                            'bytes_in': 0,
                            'bytes_out': 0,
                            'last_updated': time.time()
                        }
                    
                    # Update counters based on direction
                    if port_type == 'dst':  # incoming to this port
                        network_data['port_stats'][port_key]['packets_in'] += 1
                        network_data['port_stats'][port_key]['bytes_in'] += packet_info['size']
                    else:  # outgoing from this port
                        network_data['port_stats'][port_key]['packets_out'] += 1
                        network_data['port_stats'][port_key]['bytes_out'] += packet_info['size']
                    
                    network_data['port_stats'][port_key]['last_updated'] = time.time()
                    
                    # Check for alerts
                    check_port_alerts(port_key)

def check_port_alerts(port_key):
    """Check if port activity exceeds alert thresholds"""
    if port_key in network_data['port_alerts']:
        threshold = network_data['port_alerts'][port_key]
        port_stats = network_data['port_stats'][port_key]
        
        # Check packets per second
        if 'packets_per_second' in threshold:
            elapsed = time.time() - port_stats.get('alert_check_time', port_stats['last_updated'] - 1)
            packets = port_stats['packets_in'] + port_stats['packets_out']
            rate = (packets - port_stats.get('last_packets', 0)) / elapsed
            
            if rate > threshold['packets_per_second']:
                alert_message = f"Port {port_key} exceeded packet rate threshold: {rate:.1f} packets/sec"
                add_alert(alert_message)
            
            # Update for next check
            network_data['port_stats'][port_key]['last_packets'] = packets
            network_data['port_stats'][port_key]['alert_check_time'] = time.time()

def add_alert(message):
    """Add an alert to the alerts list"""
    with data_lock:
        alert = {
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'message': message
        }
        network_data['alerts'].append(alert)
        # Keep only the latest 5 alerts (instead of 10)
        if len(network_data['alerts']) > 5:
            network_data['alerts'] = network_data['alerts'][-5:]

def packet_capture_thread():
    """Background thread for capturing packets"""
    try:
        # Reset the stop flag
        stop_capture_flag.clear()
        # Add filter to reduce packet volume, only capture TCP and UDP
        sniff(filter="tcp or udp", 
              prn=lambda pkt: update_port_stats(get_packet_info(pkt)), 
              store=0,
              stop_filter=lambda _: stop_capture_flag.is_set())
    except Exception as e:
        add_alert(f"Packet capture error: {str(e)}")
    finally:
        global capture_active
        capture_active = False

# Clean up old data to prevent memory buildup
def cleanup_thread():
    """Background thread to periodically clean up old data"""
    while True:
        time.sleep(30)  # Run cleanup every 30 seconds (previously 60)
        with data_lock:
            # Limit number of tracked ports to 20 most recently active
            if len(network_data['port_stats']) > 20:
                # Sort by last updated time
                sorted_ports = sorted(
                    network_data['port_stats'].items(),
                    key=lambda x: x[1]['last_updated'],
                    reverse=True
                )
                
                # Keep only the 20 most recent ports and any with alerts
                kept_ports = {}
                for i, (port_key, stats) in enumerate(sorted_ports):
                    if i < 20 or port_key in network_data['port_alerts']:
                        kept_ports[port_key] = stats
                
                network_data['port_stats'] = kept_ports

# Routes
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/network_data')
def get_network_data():
    with data_lock:
        return jsonify(network_data)

@app.route('/api/start_capture')
def start_capture():
    global capture_active, capture_thread
    
    if capture_active:
        return jsonify({'success': False, 'message': 'Capture already running'})
    
    try:
        # Get local IP addresses and store them
        network_data['local_ips'] = get_local_ip_addresses()
        
        # Start packet capture in a new thread
        capture_thread = threading.Thread(target=packet_capture_thread, daemon=True)
        capture_thread.start()
        capture_active = True
        
        # Add an alert to show capture started
        add_alert("Packet capture started")
        
        return jsonify({'success': True, 'message': 'Capture started'})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error starting capture: {str(e)}'})

@app.route('/api/stop_capture')
def stop_capture():
    global capture_active
    
    if not capture_active:
        return jsonify({'success': False, 'message': 'No capture running'})
    
    try:
        # Signal the capture thread to stop
        stop_capture_flag.set()
        
        # Add an alert to show capture stopped
        add_alert("Packet capture stopped")
        
        return jsonify({'success': True, 'message': 'Capture stopped'})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error stopping capture: {str(e)}'})

@app.route('/api/set_alert', methods=['POST'])
def set_alert():
    data = request.json
    port = data.get('port')
    threshold = data.get('threshold')
    
    if port and threshold:
        with data_lock:
            port_key = str(port)
            if port_key not in network_data['port_alerts']:
                network_data['port_alerts'][port_key] = {}
            
            network_data['port_alerts'][port_key]['packets_per_second'] = float(threshold)
            return jsonify({'success': True, 'message': f'Alert set for port {port}'})
    
    return jsonify({'success': False, 'message': 'Invalid request'})

@app.route('/api/clear_alert', methods=['POST'])
def clear_alert():
    data = request.json
    port = data.get('port')
    
    if port:
        with data_lock:
            port_key = str(port)
            if port_key in network_data['port_alerts']:
                del network_data['port_alerts'][port_key]
                return jsonify({'success': True, 'message': f'Alert cleared for port {port}'})
    
    return jsonify({'success': False, 'message': 'Invalid request'})

if __name__ == '__main__':
    # Get initial local IP address list
    network_data['local_ips'] = get_local_ip_addresses()
    
    # Start cleanup thread
    cleanup_thread = threading.Thread(target=cleanup_thread, daemon=True)
    cleanup_thread.start()
    
    # Run Flask app
    app.run(debug=True, host='0.0.0.0') 