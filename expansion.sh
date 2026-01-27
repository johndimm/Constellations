#!/bin/bash

# Default values
QUERY=${1:-"Perry Neubauer"}
PORT=${2:-4000}
SERVER="http://localhost:$PORT"
# SERVER="https://constellations-beaf.onrender.com"

echo "📡 Expanding: $QUERY user $SERVER ..."

curl -s -X POST "${SERVER}/api/expand" \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"$QUERY\"}" | jq .
