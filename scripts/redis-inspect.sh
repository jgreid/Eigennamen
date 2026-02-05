#!/bin/bash
# Redis inspection script
# Shows Redis memory usage and key statistics

set -e

REDIS_URL="${REDIS_URL:-redis://localhost:6379}"

echo "=== Redis Inspection ==="
echo "Target: $REDIS_URL"
echo ""

# Check if using Docker
if command -v docker &> /dev/null && docker ps --filter "name=redis" --format "{{.Names}}" | grep -q redis; then
    REDIS_CMD="docker compose exec -T redis redis-cli"
    echo "Using Docker Redis container"
else
    if command -v redis-cli &> /dev/null; then
        REDIS_CMD="redis-cli"
        echo "Using local redis-cli"
    else
        echo "❌ Neither Docker Redis nor local redis-cli found"
        exit 1
    fi
fi

# Memory info
echo ""
echo "📊 Memory Usage:"
$REDIS_CMD INFO memory 2>/dev/null | grep -E "used_memory_human|used_memory_peak_human|maxmemory_human|mem_fragmentation_ratio" | while read line; do
    echo "  $line"
done

# Key counts by prefix
echo ""
echo "📊 Key Counts by Type:"
echo "  Rooms:   $($REDIS_CMD --scan --pattern 'room:*' 2>/dev/null | wc -l | tr -d ' ')"
echo "  Players: $($REDIS_CMD --scan --pattern 'player:*' 2>/dev/null | wc -l | tr -d ' ')"
echo "  Games:   $($REDIS_CMD --scan --pattern 'game:*' 2>/dev/null | wc -l | tr -d ' ')"
echo "  Timers:  $($REDIS_CMD --scan --pattern 'timer:*' 2>/dev/null | wc -l | tr -d ' ')"
echo "  Locks:   $($REDIS_CMD --scan --pattern 'lock:*' 2>/dev/null | wc -l | tr -d ' ')"
echo "  Sessions: $($REDIS_CMD --scan --pattern 'session:*' 2>/dev/null | wc -l | tr -d ' ')"

# Total keys
TOTAL=$($REDIS_CMD DBSIZE 2>/dev/null | grep -oE '[0-9]+' || echo "?")
echo ""
echo "  Total keys: $TOTAL"

# Client connections
echo ""
echo "📊 Connected Clients:"
$REDIS_CMD CLIENT LIST 2>/dev/null | wc -l | xargs echo "  Count:"

# Show any large keys (optional)
echo ""
echo "📊 Sample Keys (first 5 per type):"
echo "  Rooms:"
$REDIS_CMD --scan --pattern 'room:*:info' 2>/dev/null | head -5 | while read key; do
    echo "    - $key"
done

echo "  Active Games:"
$REDIS_CMD --scan --pattern 'game:*' 2>/dev/null | head -5 | while read key; do
    echo "    - $key"
done

echo ""
echo "=== Inspection Complete ==="
