#!/bin/bash
# Quick system health check script
# Shows status of all Eigennamen services

set -e

URL="${1:-http://localhost:3000}"

echo "=== Eigennamen Health Check ==="
echo "Target: $URL"
echo ""

# Basic health
echo "📊 Server Status:"
if curl -sf "$URL/health" > /dev/null 2>&1; then
    curl -s "$URL/health" | python3 -m json.tool 2>/dev/null || curl -s "$URL/health"
    echo ""
else
    echo "❌ Server not responding at $URL"
    exit 1
fi

# Readiness check
echo ""
echo "📊 Readiness Status:"
READY_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$URL/health/ready" 2>/dev/null || echo "000")
if [ "$READY_STATUS" = "200" ]; then
    echo "✓ All dependencies ready"
    curl -s "$URL/health/ready" | python3 -m json.tool 2>/dev/null || curl -s "$URL/health/ready"
elif [ "$READY_STATUS" = "503" ]; then
    echo "⚠️  Some dependencies degraded (HTTP 503)"
    curl -s "$URL/health/ready" | python3 -m json.tool 2>/dev/null || curl -s "$URL/health/ready"
else
    echo "❌ Readiness check failed (HTTP $READY_STATUS)"
fi

# Detailed metrics
echo ""
echo "📊 Detailed Metrics:"
if curl -sf "$URL/health/metrics" > /dev/null 2>&1; then
    METRICS=$(curl -s "$URL/health/metrics")

    # Extract key metrics
    echo "  Uptime: $(echo "$METRICS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('uptime',{}).get('seconds','?'))" 2>/dev/null || echo "?")s"
    echo "  Memory (heap): $(echo "$METRICS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('memory',{}).get('heapUsed','?'))" 2>/dev/null || echo "?")"
    echo "  Redis mode: $(echo "$METRICS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('redis',{}).get('mode','?'))" 2>/dev/null || echo "?")"
    echo "  Redis healthy: $(echo "$METRICS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('redis',{}).get('healthy','?'))" 2>/dev/null || echo "?")"

    # Check for Redis memory info
    REDIS_MEM=$(echo "$METRICS" | python3 -c "import sys,json; d=json.load(sys.stdin); m=d.get('redis',{}).get('memory',{}); print(m.get('used_memory_human','N/A'))" 2>/dev/null || echo "N/A")
    REDIS_ALERT=$(echo "$METRICS" | python3 -c "import sys,json; d=json.load(sys.stdin); m=d.get('redis',{}).get('memory',{}); print(m.get('alert') or 'none')" 2>/dev/null || echo "none")
    echo "  Redis memory: $REDIS_MEM (alert: $REDIS_ALERT)"

    # Check for alerts
    ALERTS=$(echo "$METRICS" | python3 -c "import sys,json; d=json.load(sys.stdin); a=d.get('alerts',[]); print(len(a))" 2>/dev/null || echo "0")
    if [ "$ALERTS" != "0" ]; then
        echo ""
        echo "⚠️  ALERTS ($ALERTS):"
        echo "$METRICS" | python3 -c "import sys,json; d=json.load(sys.stdin); [print(f\"  - {a['level']}: {a['message']}\") for a in d.get('alerts',[])]" 2>/dev/null
    fi
else
    echo "❌ Could not fetch detailed metrics"
fi

# Docker status (if available)
if command -v docker &> /dev/null; then
    echo ""
    echo "🐳 Docker Containers:"
    docker ps --filter "name=eigennamen" --format "  {{.Names}}: {{.Status}}" 2>/dev/null || echo "  No Eigennamen containers found"
fi

echo ""
echo "=== Health Check Complete ==="
