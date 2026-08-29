#!/bin/bash
sleep 180
echo "HEALTH:"
curl -s http://127.0.0.1:3001/api/health
echo ""
echo "OVERVIEW:"
curl -s http://127.0.0.1:3001/api/overview > /tmp/overview.json
node -e "const d=JSON.parse(require('fs').readFileSync('/tmp/overview.json','utf8')); const s=d.summary||{}; console.log(JSON.stringify({auctions:s.totalAuctions,sales:s.recordedSales,flips:s.opportunities,items:s.uniqueItems,scans:d.status?.scanCount,scanning:d.status?.scanning,err:d.status?.lastError}))"
echo ""
echo "RAM:"
echo "1119" | sudo -S docker stats --no-stream donutsmp-tracker 2>&1 | tail -1
