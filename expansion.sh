#!/bin/bash

# Default values
QUERY=${1:-"Perry Neubauer"}
PORT=${2:-4000}

echo "📡 Expanding: $QUERY on port $PORT..."

curl -s -X POST "http://localhost:$PORT/api/expand" \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"$QUERY\"}" | jq .
