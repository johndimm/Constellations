#!/bin/bash

# Default values
PERSON=${1:-"rickmoy"}
URL="https://www.linkedin.com/in/rickmoy/"

echo $URL

curl "${URL}" 
