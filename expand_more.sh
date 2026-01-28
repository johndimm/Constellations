#!/bin/bash

# Usage: ./expand_more.sh "Node Name" "Exclude1,Exclude2" [PORT]
# Example: ./expand_more.sh "The New Yorker" "Harold Ross,Jane Grant"

QUERY=${1:-"The New Yorker"}
EXCLUDES=${2:-""}
PORT=${3:-4000}
SERVER="http://localhost:$PORT"

# Convert comma-separated excludes to JS array string for JSON
if [ -z "$EXCLUDES" ]; then
  EXCLUDE_JSON="[]"
else
  # "a, b, c" -> "a"," b"," c"
  # This simple replacement assumes no quotes in names. 
  formatted=$(echo "$EXCLUDES" | sed 's/,/","/g')
  EXCLUDE_JSON="[\"$formatted\"]"
fi

echo "📡 Expanding More for: \"$QUERY\""
echo "🚫 Excluding: $EXCLUDE_JSON"
echo "🌐 Server: $SERVER"

# Note: /api/ai/connections expects 'nodeName'
curl -s -X POST "${SERVER}/api/ai/connections" \
  -H "Content-Type: application/json" \
  -d "{
    \"nodeName\": \"$QUERY\",
    \"excludeNodes\": $EXCLUDE_JSON,
    \"context\": \"Magazine\",
    \"compositeType\": \"Magazine\",
    \"atomicType\": \"Person\"
  }" | jq .
